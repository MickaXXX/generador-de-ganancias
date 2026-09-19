// Todo lo que toca a Jupiter: cotizar, armar el swap, firmarlo, mandarlo y
// esperar la confirmacion reenviando mientras el blockhash siga vivo.
import { VersionedTransaction } from '@solana/web3.js';
import { SOL, USDC } from '../config.js';
import { log } from '../log.js';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export class Jupiter {
  constructor({ base, tokensBase, apiKey, rpc }) {
    this.base = base;
    this.tokensBase = tokensBase;
    this.apiKey = apiKey;
    this.rpc = rpc;
    this.cachePrecioSol = { valor: 0, ts: 0 };
    this.cacheSimbolos = new Map();
  }

  get cabeceras() {
    const h = { 'content-type': 'application/json' };
    if (this.apiKey) h['x-api-key'] = this.apiKey;
    return h;
  }

  async pedir(url, opciones = {}, intentos = 3) {
    let ultimo;
    for (let i = 0; i < intentos; i++) {
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), 15000);
      try {
        const res = await fetch(url, { ...opciones, headers: this.cabeceras, signal: control.signal });
        if (res.status === 429 || res.status >= 500) {
          ultimo = new Error(`Jupiter HTTP ${res.status}`);
          await dormir(500 * 2 ** i);
          continue;
        }
        const cuerpo = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new Error(cuerpo?.error || cuerpo?.message || `Jupiter HTTP ${res.status}`);
          err.definitivo = true;
          throw err;
        }
        return cuerpo;
      } catch (e) {
        if (e.definitivo) throw e;
        ultimo = e;
        await dormir(500 * 2 ** i);
      } finally {
        clearTimeout(reloj);
      }
    }
    throw ultimo ?? new Error('Jupiter no respondio');
  }

  /** amount va en unidades crudas del token de entrada (sin decimales). */
  async cotizar({ entrada, salida, cantidad, slippageBps, soloDirecto = false }) {
    const q = new URLSearchParams({
      inputMint: entrada,
      outputMint: salida,
      amount: String(cantidad),
      slippageBps: String(Math.round(slippageBps)),
      restrictIntermediateTokens: 'true',
      swapMode: 'ExactIn',
    });
    if (soloDirecto) q.set('onlyDirectRoutes', 'true');
    const cot = await this.pedir(`${this.base}/quote?${q}`);
    if (!cot?.outAmount) throw new Error('Jupiter no encontro ruta para este token.');
    return cot;
  }

  /** Cotiza sin romperse: devuelve null si no hay ruta. Sirve para medir valor y liquidez. */
  async cotizarSuave(args) {
    try { return await this.cotizar(args); } catch { return null; }
  }

  async construirSwap({ cotizacion, publica, prioridadMaxLamports }) {
    const cuerpo = {
      quoteResponse: cotizacion,
      userPublicKey: publica,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: Math.round(prioridadMaxLamports),
          priorityLevel: 'high',
          global: false,
        },
      },
    };
    const r = await this.pedir(`${this.base}/swap`, { method: 'POST', body: JSON.stringify(cuerpo) }, 2);
    if (!r?.swapTransaction) throw new Error('Jupiter no devolvio la transaccion.');
    return r;
  }

  /**
   * Firma, envia y espera. Reenvia la misma transaccion cada pocos segundos porque en
   * Solana perder el paquete es normal; el reenvio no duplica la operacion (misma firma).
   */
  async ejecutar({ cotizacion, par, prioridadMaxLamports }) {
    const { swapTransaction, lastValidBlockHeight } = await this.construirSwap({
      cotizacion,
      publica: par.publicKey.toBase58(),
      prioridadMaxLamports,
    });

    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([par]);
    const crudo = Buffer.from(tx.serialize()).toString('base64');

    const firma = await this.rpc.enviarTransaccion(crudo);
    log.info(`Transaccion enviada: ${firma}`);

    const limite = Date.now() + 75000;
    let ultimoReenvio = Date.now();
    while (Date.now() < limite) {
      await dormir(1500);
      const estado = await this.rpc.estadoFirma(firma).catch(() => null);
      if (estado) {
        if (estado.err) {
          const detalle = JSON.stringify(estado.err);
          return { firma, ok: false, error: `La red rechazo la operacion: ${detalle}` };
        }
        if (estado.confirmationStatus === 'confirmed' || estado.confirmationStatus === 'finalized') {
          return { firma, ok: true };
        }
      }
      if (Date.now() - ultimoReenvio > 3000) {
        ultimoReenvio = Date.now();
        this.rpc.enviarTransaccion(crudo).catch(() => {});
      }
      if (lastValidBlockHeight) {
        const altura = await this.rpc.alturaBloque().catch(() => 0);
        if (altura && altura > lastValidBlockHeight) {
          return { firma, ok: false, error: 'La transaccion expiro sin entrar (blockhash vencido).' };
        }
      }
    }
    return { firma, ok: false, error: 'Se acabo el tiempo de espera de la confirmacion.' };
  }

  /** Precio de SOL en dolares, cotizando 1 SOL contra USDC. Cacheado 30 segundos. */
  async precioSolUsd() {
    if (Date.now() - this.cachePrecioSol.ts < 30000 && this.cachePrecioSol.valor) {
      return this.cachePrecioSol.valor;
    }
    const cot = await this.cotizarSuave({ entrada: SOL, salida: USDC, cantidad: 1e9, slippageBps: 50 });
    if (!cot) return this.cachePrecioSol.valor || 0;
    const valor = Number(cot.outAmount) / 1e6;
    this.cachePrecioSol = { valor, ts: Date.now() };
    return valor;
  }

  /** Cuantos dolares vale ahora mismo esa cantidad cruda de token, si se vendiera. */
  async valorUsd({ mint, cantidadCruda, slippageBps = 300 }) {
    if (mint === USDC) return Number(cantidadCruda) / 1e6;
    const cot = await this.cotizarSuave({ entrada: mint, salida: USDC, cantidad: cantidadCruda, slippageBps });
    if (!cot) return null;
    return Number(cot.outAmount) / 1e6;
  }

  async simboloDe(mint) {
    if (this.cacheSimbolos.has(mint)) return this.cacheSimbolos.get(mint);
    let simbolo = null;
    try {
      const r = await this.pedir(`${this.tokensBase}/search?query=${mint}`, {}, 1);
      const lista = Array.isArray(r) ? r : (r?.tokens ?? r?.data ?? []);
      const encontrado = lista.find?.((t) => t?.id === mint || t?.address === mint) ?? lista[0];
      simbolo = encontrado?.symbol ?? null;
    } catch { simbolo = null; }
    this.cacheSimbolos.set(mint, simbolo);
    return simbolo;
  }
}
