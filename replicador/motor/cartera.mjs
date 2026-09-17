// Estado de MI billetera de replicacion. Todo en SOL.

export class Cartera {
  constructor({ presupuestoSol }) {
    this.presupuestoSol = presupuestoSol;
    this.solDisponible = presupuestoSol;
    this.posiciones = new Map(); // mint -> {tokens, costoSol, maxValorSol, abierta}
    this.realizadoSol = 0;
    this.feesSol = 0;
    this.picoValorSol = presupuestoSol;
  }

  posicion(mint) {
    return this.posiciones.get(mint) ?? null;
  }

  get abiertas() {
    return [...this.posiciones.values()].filter((p) => p.tokens > 0).length;
  }

  /** Costo invertido y aun no realizado en un mint. */
  expuestoEn(mint) {
    return this.posicion(mint)?.costoSol ?? 0;
  }

  aplicarCompra({ mint, solGastado, tokens, feeSol = 0 }) {
    this.solDisponible -= solGastado + feeSol;
    this.feesSol += feeSol;
    const p = this.posiciones.get(mint) ?? { tokens: 0, costoSol: 0, maxValorSol: 0 };
    p.tokens += tokens;
    p.costoSol += solGastado;
    p.maxValorSol = Math.max(p.maxValorSol, p.costoSol);
    this.posiciones.set(mint, p);
  }

  aplicarVenta({ mint, tokens, solRecibido, feeSol = 0 }) {
    const p = this.posiciones.get(mint);
    if (!p || p.tokens <= 0) return 0;
    const vendidos = Math.min(tokens, p.tokens);
    const proporcion = vendidos / p.tokens;
    const costoLiberado = p.costoSol * proporcion;

    p.tokens -= vendidos;
    p.costoSol -= costoLiberado;
    if (p.tokens <= 1e-12) this.posiciones.delete(mint);

    this.solDisponible += solRecibido - feeSol;
    this.feesSol += feeSol;
    const ganancia = solRecibido - costoLiberado;
    this.realizadoSol += ganancia;
    return ganancia;
  }

  /** Valor total: SOL libre + valor de mercado de las posiciones. */
  valorTotalSol(precios = new Map()) {
    let total = this.solDisponible;
    for (const [mint, p] of this.posiciones) {
      const precio = precios.get(mint);
      total += precio != null ? p.tokens * precio : p.costoSol;
    }
    return total;
  }

  /** Drawdown desde el pico historico, entre 0 y 1. */
  drawdown(precios) {
    const valor = this.valorTotalSol(precios);
    this.picoValorSol = Math.max(this.picoValorSol, valor);
    if (this.picoValorSol <= 0) return 0;
    return Math.max(0, 1 - valor / this.picoValorSol);
  }

  instantanea(precios = new Map()) {
    return {
      presupuestoSol: this.presupuestoSol,
      solDisponible: this.solDisponible,
      realizadoSol: this.realizadoSol,
      feesSol: this.feesSol,
      valorTotalSol: this.valorTotalSol(precios),
      posiciones: [...this.posiciones.entries()].map(([mint, p]) => ({
        mint,
        tokens: p.tokens,
        costoSol: p.costoSol,
        valorSol: precios.has(mint) ? p.tokens * precios.get(mint) : p.costoSol,
      })),
    };
  }
}
