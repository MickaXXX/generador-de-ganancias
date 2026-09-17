// Orquestador. Une fuente -> decodificador -> politica -> ejecutor -> cartera,
// y encima pone los cortacircuitos y el trailing stop propio.

import { EventEmitter } from 'node:events';
import { decodificar } from './decodificador.mjs';
import { decidir, CONFIG_POR_DEFECTO } from './politica.mjs';
import { Cartera } from './cartera.mjs';

const MAX_REGISTRO = 400;

export class Replicador extends EventEmitter {
  constructor({ fuente, ejecutor, mercado, config = {} }) {
    super();
    this.fuente = fuente;
    this.ejecutor = ejecutor;
    this.mercado = mercado ?? fuente;
    this.config = { ...CONFIG_POR_DEFECTO, trailingStop: 0.35, ...config };
    this.cartera = new Cartera({ presupuestoSol: this.config.presupuestoSol });
    this.registro = [];
    this.corriendo = false;
    this.motivoDetencion = null;
    this.contadores = { vistas: 0, decodificadas: 0, copiadas: 0, omitidas: 0, stops: 0 };
    this.timerVigilancia = null;
    // Los precios se consultan a la red, asi que se cachean: estado() se llama
    // muy seguido y tiene que ser sincrono.
    this.preciosActuales = new Map();
  }

  anotar(nivel, texto, extra = {}) {
    const linea = { ts: Date.now(), nivel, texto, ...extra };
    this.registro.push(linea);
    if (this.registro.length > MAX_REGISTRO) this.registro.shift();
    this.emit('registro', linea);
    return linea;
  }

  arrancar() {
    if (this.corriendo) return;
    this.corriendo = true;
    this.motivoDetencion = null;
    this.anotar('info', `Replica iniciada en modo ${this.ejecutor.modo.toUpperCase()}. Trader: ${this.fuente.trader}`);
    this.fuente.arrancar((tx) => this.#alLlegarTx(tx));
    Promise.resolve(this.mercado.precios([])).then((p) => { this.preciosActuales = p; }).catch(() => {});
    // El trailing stop es MIO y corre aunque el trader no haga nada. Es la
    // unica parte donde le puedo ganar: el mueve mucho y tarda en salir, yo
    // muevo poco y salgo en un bloque.
    this.timerVigilancia = setInterval(() => this.#vigilar(), 1000);
    if (this.timerVigilancia.unref) this.timerVigilancia.unref();
    this.emit('estado', this.estado());
  }

  async detener(motivo = 'detenido por el usuario') {
    if (!this.corriendo) return;
    this.corriendo = false;
    this.motivoDetencion = motivo;
    clearInterval(this.timerVigilancia);
    await this.fuente.detener();
    this.anotar('aviso', `Automatizacion detenida: ${motivo}`);
    this.emit('estado', this.estado());
  }

  async #alLlegarTx(tx) {
    if (!this.corriendo) return;
    this.contadores.vistas++;
    const intencion = decodificar(tx, this.fuente.trader);
    if (!intencion) return; // transferencia u operacion que no entendemos
    this.contadores.decodificadas++;

    let infoToken = null;
    try {
      infoToken = await this.mercado.infoToken(intencion.mint);
    } catch (e) {
      this.anotar('error', `No pude consultar datos de ${intencion.mint.slice(0, 6)}: ${e.message}`);
    }

    const orden = decidir({ intencion, cartera: this.cartera, config: this.config, infoToken });

    const corto = intencion.mint.slice(0, 6);
    if (orden.accion === 'omitir') {
      this.contadores.omitidas++;
      this.anotar('omitido', `${intencion.lado} de ${corto} omitida: ${orden.motivo}`, { mint: intencion.mint });
      this.emit('estado', this.estado());
      return;
    }

    try {
      if (orden.lado === 'compra') {
        const fill = await this.ejecutor.comprar({ mint: orden.mint, montoSol: orden.montoSol });
        this.cartera.aplicarCompra({ mint: orden.mint, solGastado: fill.solGastado, tokens: fill.tokens, feeSol: fill.feeSol });
        this.contadores.copiadas++;
        this.anotar('compra', `Compra ${corto} por ${fill.solGastado.toFixed(4)} SOL (el movio ${(intencion.fraccion * 100).toFixed(1)}% de su saldo)`, { mint: orden.mint, solSpent: fill.solGastado });
      } else {
        const fill = await this.ejecutor.vender({ mint: orden.mint, tokens: orden.tokens });
        const ganancia = this.cartera.aplicarVenta({ mint: orden.mint, tokens: fill.tokens, solRecibido: fill.solRecibido, feeSol: fill.feeSol });
        this.contadores.copiadas++;
        const signo = ganancia >= 0 ? '+' : '';
        this.anotar(ganancia >= 0 ? 'venta' : 'perdida', `Venta ${corto} por ${fill.solRecibido.toFixed(4)} SOL (${signo}${ganancia.toFixed(4)} SOL)`, { mint: orden.mint, ganancia });
      }
    } catch (e) {
      this.anotar('error', `Fallo al ejecutar ${orden.lado} de ${corto}: ${e.message}`);
    }

    this.#revisarCortacircuitos();
    this.emit('estado', this.estado());
  }

  /** Trailing stop propio: salgo sin esperar a que el trader venda. */
  async #vigilar() {
    if (!this.corriendo) return;
    let precios;
    try {
      precios = await this.mercado.precios([...this.cartera.posiciones.keys()]);
    } catch { return; }
    this.preciosActuales = precios;
    let hubo = false;

    for (const [mint, p] of [...this.cartera.posiciones]) {
      const precio = precios.get(mint);
      if (precio == null || p.tokens <= 0) continue;
      const valor = p.tokens * precio;
      p.maxValorSol = Math.max(p.maxValorSol ?? valor, valor);
      if (p.maxValorSol <= 0) continue;

      const caida = 1 - valor / p.maxValorSol;
      if (caida >= this.config.trailingStop) {
        try {
          const fill = await this.ejecutor.vender({ mint, tokens: p.tokens });
          const ganancia = this.cartera.aplicarVenta({ mint, tokens: fill.tokens, solRecibido: fill.solRecibido, feeSol: fill.feeSol });
          this.contadores.stops++;
          hubo = true;
          this.anotar('stop', `Trailing stop en ${mint.slice(0, 6)}: cayo ${(caida * 100).toFixed(0)}% desde el maximo. Salida con ${ganancia >= 0 ? '+' : ''}${ganancia.toFixed(4)} SOL`, { mint });
        } catch (e) {
          this.anotar('error', `No se pudo ejecutar el stop de ${mint.slice(0, 6)}: ${e.message}`);
        }
      }
    }

    if (this.#revisarCortacircuitos() || hubo) this.emit('estado', this.estado());
  }

  #revisarCortacircuitos() {
    const dd = this.cartera.drawdown(this.preciosActuales);
    if (dd >= this.config.maxDrawdownDiario) {
      this.anotar('alarma', `Cortacircuitos: drawdown de ${(dd * 100).toFixed(1)}% supera el limite de ${(this.config.maxDrawdownDiario * 100).toFixed(0)}%`);
      this.detener('cortacircuitos por drawdown');
      return true;
    }
    return false;
  }

  estado() {
    const precios = this.preciosActuales;
    const inst = this.cartera.instantanea(precios);
    return {
      corriendo: this.corriendo,
      modo: this.ejecutor.modo,
      // Se expone por separado de donde salen los datos y donde va el dinero.
      // Presentar una cadena simulada como si fuera la real seria mentirle al
      // usuario justo en el dato que mas le importa.
      cadenaSimulada: this.fuente.simulada === true,
      trader: this.fuente.trader,
      motivoDetencion: this.motivoDetencion,
      contadores: { ...this.contadores },
      cartera: inst,
      rendimiento: inst.presupuestoSol > 0 ? inst.valorTotalSol / inst.presupuestoSol - 1 : 0,
      drawdown: this.cartera.drawdown(precios),
      config: this.config,
    };
  }
}
