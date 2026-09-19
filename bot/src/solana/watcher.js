// Vigila las wallets seguidas. Pregunta a la RPC por firmas nuevas, baja solo esas
// transacciones y las convierte en senales. Arranca desde "ahora": nunca copia
// operaciones viejas al encender el bot.
import { detectarSwaps } from './swapdetect.js';
import { log } from '../log.js';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export class Vigilante {
  constructor({ rpc, almacen, alDetectar, pollMs = 2500 }) {
    this.rpc = rpc;
    this.almacen = almacen;
    this.alDetectar = alDetectar;
    this.pollMs = pollMs;
    this.corriendo = false;
    this.ultimoError = null;
    this.ciclos = 0;
  }

  iniciar() {
    if (this.corriendo) return;
    this.corriendo = true;
    this.bucle();
  }

  detener() { this.corriendo = false; }

  async bucle() {
    while (this.corriendo) {
      try {
        await this.unaVuelta();
        this.ultimoError = null;
      } catch (e) {
        this.ultimoError = e.message;
        log.error('Vuelta de vigilancia fallida:', e);
      }
      this.ciclos++;
      await dormir(this.pollMs);
    }
  }

  async unaVuelta() {
    const lideres = this.almacen.lideresActivos();
    for (const lider of lideres) {
      if (!this.corriendo) return;
      try {
        await this.revisarLider(lider);
      } catch (e) {
        log.error(`No se pudo revisar a ${lider.alias}:`, e.message);
      }
      await dormir(120); // respiro entre wallets para no reventar el limite de la RPC
    }
  }

  async revisarLider(lider) {
    const guardado = this.almacen.datos.lideres[lider.direccion];
    if (!guardado) return;

    // Primera vez: solo marcamos por donde vamos. No se copia el pasado.
    if (!guardado.ultimaFirma) {
      const ultimas = await this.rpc.firmasDe(lider.direccion, { limit: 1 });
      guardado.ultimaFirma = ultimas?.[0]?.signature ?? 'inicio';
      this.almacen.guardar();
      log.info(`Vigilando a ${guardado.alias} desde ahora.`);
      return;
    }

    const opciones = guardado.ultimaFirma === 'inicio'
      ? { limit: 5 }
      : { limit: 40, until: guardado.ultimaFirma };
    const firmas = await this.rpc.firmasDe(lider.direccion, opciones);
    if (!firmas?.length) return;

    guardado.ultimaFirma = firmas[0].signature; // la RPC devuelve de mas nueva a mas vieja
    this.almacen.guardar();

    const maxEdadMs = (this.almacen.p.maxEdadSenalS ?? 90) * 1000;
    for (const f of firmas.slice().reverse()) {
      if (f.err) continue;
      if (this.almacen.yaVisto(f.signature)) continue;
      const edad = f.blockTime ? Date.now() - f.blockTime * 1000 : 0;
      if (edad > maxEdadMs) {
        this.almacen.marcarVisto(f.signature);
        log.debug(`Senal descartada por vieja (${Math.round(edad / 1000)}s): ${f.signature.slice(0, 8)}`);
        continue;
      }
      this.almacen.marcarVisto(f.signature);
      let tx;
      try {
        tx = await this.rpc.transaccion(f.signature);
      } catch (e) {
        log.aviso(`No se pudo bajar ${f.signature.slice(0, 8)}: ${e.message}`);
        continue;
      }
      const senales = detectarSwaps(tx, lider.direccion);
      for (const senal of senales) {
        log.info(`Senal de ${guardado.alias}: ${senal.tipo} ${senal.cantidad} de ${senal.mint.slice(0, 6)}`);
        try {
          await this.alDetectar({ ...senal, alias: guardado.alias });
        } catch (e) {
          log.error('El motor fallo con una senal:', e);
        }
      }
    }
  }
}
