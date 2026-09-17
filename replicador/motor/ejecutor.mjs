// Dos ejecutores con la misma interfaz. El modo sombra es el que corre por
// defecto: hace TODO el trabajo menos gastar plata.

const LAMPORTS = 1e9;

/** Slippage estimado: crece con el tamanio de la orden frente a la liquidez. */
function slippage(montoSol, liquidezUsd, precioSolUsd = 150) {
  const montoUsd = montoSol * precioSolUsd;
  const impacto = liquidezUsd > 0 ? montoUsd / liquidezUsd : 1;
  return Math.min(0.5, 0.004 + impacto * 1.5); // 0.4% base + impacto de precio
}

/**
 * MODO SOMBRA. Registra lo que HABRIA hecho, con precio real, slippage
 * estimado y fees. Es el mismo codigo que el real menos la firma, asi que lo
 * que mide es representativo. Correr esto dos semanas antes de poner un peso.
 */
export class EjecutorSombra {
  constructor({ mercado, feeSol = 0.00015, retrasoMs = 1200 }) {
    this.mercado = mercado;
    this.feeSol = feeSol;      // fee de red + propina de prioridad
    this.retrasoMs = retrasoMs; // cuanto llego tarde respecto al trader
    this.modo = 'sombra';
  }

  #precioConRetraso(mint) {
    // Llego tarde, asi que compro peor de lo que compro el. Esa penalizacion
    // es justamente lo que el modo sombra tiene que medir.
    const base = this.mercado.precio(mint);
    const deriva = (this.retrasoMs / 1000) * 0.002; // ~0.2% por segundo de atraso
    return { compra: base * (1 + deriva), venta: base * (1 - deriva) };
  }

  async comprar({ mint, montoSol }) {
    const info = this.mercado.infoToken(mint);
    const s = slippage(montoSol, info?.liquidezUsd ?? 0);
    const precio = this.#precioConRetraso(mint).compra * (1 + s);
    return { mint, tokens: montoSol / precio, solGastado: montoSol, feeSol: this.feeSol, precio, slippage: s, simulado: true };
  }

  async vender({ mint, tokens }) {
    const info = this.mercado.infoToken(mint);
    const bruto = tokens * this.mercado.precio(mint);
    const s = slippage(bruto, info?.liquidezUsd ?? 0);
    const precio = this.#precioConRetraso(mint).venta * (1 - s);
    return { mint, tokens, solRecibido: tokens * precio, feeSol: this.feeSol, precio, slippage: s, simulado: true };
  }
}

/**
 * MODO REAL, contra Jupiter. Rutea solo por el mejor camino entre todos los
 * DEX de Solana, asi que no hay que integrar ninguno a mano.
 *
 * NO PROBADO CONTRA MAINNET desde este repositorio: la politica de red del
 * entorno donde se escribio bloquea los endpoints de Solana y de Jupiter.
 * Antes de usarlo con dinero, correrlo con presupuesto minimo y verificar la
 * primera operacion a mano en un explorador de bloques.
 */
export class EjecutorJupiter {
  constructor({ conexion, billetera, apiJupiter = 'https://lite-api.jup.ag', slippageBps = 150, propinaSol = 0.0005 }) {
    this.conexion = conexion;
    this.billetera = billetera; // Keypair. Nunca sale de este proceso.
    this.api = apiJupiter;
    this.slippageBps = slippageBps;
    this.propinaSol = propinaSol;
    this.modo = 'real';
  }

  async #swap(entrada, salida, cantidadBruta) {
    const url = `${this.api}/swap/v1/quote?inputMint=${entrada}&outputMint=${salida}` +
      `&amount=${cantidadBruta}&slippageBps=${this.slippageBps}&restrictIntermediateTokens=true`;
    const cotizacion = await (await fetch(url)).json();
    if (!cotizacion?.outAmount) throw new Error(`sin ruta para ${entrada} -> ${salida}`);

    const resp = await fetch(`${this.api}/swap/v1/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: cotizacion,
        userPublicKey: this.billetera.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: Math.round(this.propinaSol * LAMPORTS),
      }),
    });
    const { swapTransaction } = await resp.json();
    if (!swapTransaction) throw new Error('Jupiter no devolvio transaccion');

    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([this.billetera]);
    const firma = await this.conexion.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: true });
    await this.conexion.confirmTransaction(firma, 'confirmed');
    return { firma, cotizacion };
  }

  async comprar({ mint, montoSol }) {
    const SOL = 'So11111111111111111111111111111111111111112';
    const { firma, cotizacion } = await this.#swap(SOL, mint, Math.round(montoSol * LAMPORTS));
    const decimales = cotizacion.outputDecimals ?? 6;
    const tokens = Number(cotizacion.outAmount) / 10 ** decimales;
    return { mint, tokens, solGastado: montoSol, feeSol: this.propinaSol, precio: montoSol / tokens, firma, simulado: false };
  }

  async vender({ mint, tokens, decimales = 6 }) {
    const SOL = 'So11111111111111111111111111111111111111112';
    const { firma, cotizacion } = await this.#swap(mint, SOL, Math.round(tokens * 10 ** decimales));
    const solRecibido = Number(cotizacion.outAmount) / LAMPORTS;
    return { mint, tokens, solRecibido, feeSol: this.propinaSol, precio: solRecibido / tokens, firma, simulado: false };
  }
}
