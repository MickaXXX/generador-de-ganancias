// Estado en un solo archivo JSON, escrito de forma atomica (tmp + rename) para que
// un corte de luz a mitad de escritura no deje el archivo a medias.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { parametrosIniciales } from './config.js';
import { log } from './log.js';

const VACIO = () => ({
  version: 1,
  parametros: parametrosIniciales(),
  lideres: {},      // direccion -> { alias, activo, desde, ultimaFirma, posiciones: { mint: cantidad } }
  posiciones: {},   // mint -> posicion abierta nuestra
  historial: [],    // ultimos 400 eventos
  vistos: {},       // firma -> epoch ms (anti duplicados)
  dia: { fecha: '', compras: 0, pnlUsd: 0 },
});

export class Almacen {
  constructor(ruta) {
    this.ruta = ruta;
    this.datos = VACIO();
    this.pendiente = null;
    this.cargar();
  }

  cargar() {
    try {
      if (existsSync(this.ruta)) {
        const leido = JSON.parse(readFileSync(this.ruta, 'utf8'));
        this.datos = { ...VACIO(), ...leido };
        // Los parametros nuevos de una version posterior se rellenan con sus valores por defecto.
        this.datos.parametros = { ...parametrosIniciales(), ...(leido.parametros || {}) };
        log.info(`Estado cargado desde ${this.ruta}`);
      }
    } catch (e) {
      log.error('No se pudo leer el estado, se empieza de cero:', e);
      this.datos = VACIO();
    }
  }

  guardar() {
    // Agrupa escrituras seguidas en una sola para no castigar el disco.
    if (this.pendiente) return;
    this.pendiente = setTimeout(() => {
      this.pendiente = null;
      this.guardarYa();
    }, 300);
    if (this.pendiente.unref) this.pendiente.unref();
  }

  guardarYa() {
    try {
      mkdirSync(dirname(this.ruta), { recursive: true });
      const tmp = `${this.ruta}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.datos, null, 2));
      renameSync(tmp, this.ruta);
    } catch (e) {
      log.error('No se pudo guardar el estado:', e);
    }
  }

  get p() { return this.datos.parametros; }

  fijarParametro(clave, valor) {
    this.datos.parametros[clave] = valor;
    this.guardar();
  }

  // --- lideres ---
  agregarLider(direccion, alias) {
    this.datos.lideres[direccion] = this.datos.lideres[direccion] || { posiciones: {} };
    Object.assign(this.datos.lideres[direccion], {
      alias: alias || this.datos.lideres[direccion].alias || `${direccion.slice(0, 4)}…${direccion.slice(-4)}`,
      activo: true,
      desde: this.datos.lideres[direccion].desde || Date.now(),
    });
    this.guardar();
    return this.datos.lideres[direccion];
  }

  quitarLider(clave) {
    for (const [dir, l] of Object.entries(this.datos.lideres)) {
      if (dir === clave || l.alias === clave) {
        delete this.datos.lideres[dir];
        this.guardar();
        return dir;
      }
    }
    return null;
  }

  lideresActivos() {
    return Object.entries(this.datos.lideres).filter(([, l]) => l.activo).map(([dir, l]) => ({ direccion: dir, ...l }));
  }

  // Cantidad que creemos que el lider tiene de un token, para calcular que fraccion vendio.
  posicionLider(direccion, mint) {
    return this.datos.lideres[direccion]?.posiciones?.[mint] ?? 0;
  }

  anotarLider(direccion, mint, delta) {
    const l = this.datos.lideres[direccion];
    if (!l) return;
    l.posiciones = l.posiciones || {};
    const nuevo = (l.posiciones[mint] ?? 0) + delta;
    if (nuevo <= 1e-12) delete l.posiciones[mint];
    else l.posiciones[mint] = nuevo;
    this.guardar();
  }

  // --- anti duplicados ---
  yaVisto(firma) { return this.datos.vistos[firma] !== undefined; }

  marcarVisto(firma) {
    this.datos.vistos[firma] = Date.now();
    const limite = Date.now() - 6 * 3600 * 1000;
    if (Object.keys(this.datos.vistos).length > 4000) {
      for (const [f, t] of Object.entries(this.datos.vistos)) if (t < limite) delete this.datos.vistos[f];
    }
    this.guardar();
  }

  // --- contadores del dia ---
  hoy() {
    const fecha = new Date().toISOString().slice(0, 10);
    if (this.datos.dia.fecha !== fecha) {
      this.datos.dia = { fecha, compras: 0, pnlUsd: 0 };
      this.guardar();
    }
    return this.datos.dia;
  }

  anotarEvento(evento) {
    this.datos.historial.unshift({ ts: Date.now(), ...evento });
    if (this.datos.historial.length > 400) this.datos.historial.length = 400;
    this.guardar();
  }
}
