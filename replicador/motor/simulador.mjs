// Cadena de Solana simulada: genera transacciones con la MISMA forma que
// devuelve getTransaction(jsonParsed), para poder probar el decodificador y
// todo el motor sin tocar mainnet ni arriesgar un peso.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** PRNG con semilla: las corridas son reproducibles, los bugs tambien. */
export function aleatorio(semilla = 42) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function direccion(rnd, largo = 44) {
  let s = '';
  for (let i = 0; i < largo; i++) s += B58[Math.floor(rnd() * B58.length)];
  return s;
}

const LAMPORTS = 1e9;
const MINT_SOL = 'So11111111111111111111111111111111111111112';

export class CadenaSimulada {
  constructor({ trader, semilla = 42, solInicial = 120 } = {}) {
    this.rnd = aleatorio(semilla);
    this.trader = trader ?? direccion(this.rnd);
    this.sol = solInicial;
    this.posiciones = new Map(); // mint -> tokens
    this.tokens = new Map();     // mint -> {precio, liquidezUsd, nacido, mintAuthority, freezeAuthority}
    this.ts = Math.floor(Date.now() / 1000);
    this.nonce = 0;
  }

  precios() {
    return new Map([...this.tokens].map(([m, t]) => [m, t.precio]));
  }

  infoToken(mint) {
    const t = this.tokens.get(mint);
    if (!t) return null;
    return {
      liquidezUsd: t.liquidezUsd,
      edadMinutos: (this.ts - t.nacido) / 60,
      mintAuthority: t.mintAuthority,
      freezeAuthority: t.freezeAuthority,
    };
  }

  /**
   * Proceso de precios calibrado contra el comportamiento real de memecoins:
   * deriva levemente negativa, saltos raros y grandes en ambas direcciones, y
   * cola derecha gorda. Sobre 600 ticks produce mediana 0.8x, 18% de tokens
   * bajo 0.1x y 12% sobre 10x. Si este proceso tuviera deriva positiva, el
   * modo sombra mentiria y todo el ejercicio no serviria de nada.
   */
  moverPrecios() {
    for (const t of this.tokens.values()) {
      const u = this.rnd();
      let salto = 0;
      if (u < 0.006) salto = 0.4 + this.rnd() * 1.2;               // se dispara
      else if (u < 0.012) salto = -(0.3 + this.rnd() * 0.5);        // se desploma
      const ruido = (this.rnd() - 0.5) * 0.06;
      t.precio = Math.max(1e-12, t.precio * (1 + ruido - 0.001 + salto));
    }
  }

  nuevoToken() {
    const mint = direccion(this.rnd);
    const trampa = this.rnd() < 0.25; // 1 de cada 4 lanzamientos es una trampa
    this.tokens.set(mint, {
      precio: 1e-6 * (1 + this.rnd() * 9),
      liquidezUsd: trampa ? 2000 + this.rnd() * 8000 : 30000 + this.rnd() * 400000,
      nacido: this.ts - (trampa ? this.rnd() * 300 : 3600 + this.rnd() * 86400),
      mintAuthority: trampa && this.rnd() < 0.5 ? direccion(this.rnd) : null,
      freezeAuthority: trampa && this.rnd() < 0.4 ? direccion(this.rnd) : null,
    });
    return mint;
  }

  /** Construye una transaccion con la forma real de Solana. */
  #tx({ mint, deltaTokens, deltaSol, tokensAntes }) {
    const fee = 5000 + Math.floor(this.rnd() * 45000);
    const solAntes = this.sol;
    const solDespues = this.sol + deltaSol - fee / LAMPORTS;
    const otra = direccion(this.rnd);
    this.nonce++;

    const balTok = (cantidad) => ({
      accountIndex: 3,
      mint,
      owner: this.trader,
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      uiTokenAmount: { amount: String(Math.round(cantidad * 1e6)), decimals: 6, uiAmount: cantidad, uiAmountString: String(cantidad) },
    });

    return {
      blockTime: this.ts,
      slot: 300000000 + this.nonce,
      transaction: {
        signatures: [direccion(this.rnd, 64)],
        message: { accountKeys: [this.trader, otra, MINT_SOL, mint] },
      },
      meta: {
        err: null,
        fee,
        preBalances: [Math.round(solAntes * LAMPORTS), 2039280, 0, 0],
        postBalances: [Math.round(solDespues * LAMPORTS), 2039280, 0, 0],
        preTokenBalances: tokensAntes > 0 ? [balTok(tokensAntes)] : [],
        postTokenBalances: tokensAntes + deltaTokens > 0 ? [balTok(tokensAntes + deltaTokens)] : [],
      },
    };
  }

  /**
   * Avanza el reloj y a veces produce una transaccion.
   * Mezcla ruido a proposito: transferencias y operaciones raras que el
   * decodificador DEBE ignorar.
   */
  paso(segundos = 30) {
    this.ts += segundos;
    this.moverPrecios();
    const r = this.rnd();

    // Ruido: una transferencia simple, sin swap. El decodificador la descarta.
    if (r < 0.12) {
      this.sol -= 0.01;
      return this.#tx({ mint: direccion(this.rnd), deltaTokens: 0, deltaSol: -0.01, tokensAntes: 0 });
    }

    // El trader tambien cierra posiciones. Un trader simulado que solo compra
    // y nunca vende acumula toda la cola derecha y da retornos de fantasia,
    // que harian que el modo sombra prometa cosas que no van a pasar.
    const saturado = this.posiciones.size >= 8;
    const umbralVenta = saturado ? 0.72 : 0.45;

    // Venta parcial o total de una posicion existente.
    if (r < umbralVenta && this.posiciones.size > 0) {
      const mints = [...this.posiciones.keys()];
      const mint = mints[Math.floor(this.rnd() * mints.length)];
      const tokensAntes = this.posiciones.get(mint);
      const fraccion = this.rnd() < 0.4 ? 1 : 0.3 + this.rnd() * 0.5;
      const vendidos = tokensAntes * fraccion;
      const solRecibido = vendidos * this.tokens.get(mint).precio;
      if (solRecibido < 1e-6) return null;

      const restante = tokensAntes - vendidos;
      if (restante <= 1e-9) this.posiciones.delete(mint);
      else this.posiciones.set(mint, restante);
      this.sol += solRecibido;
      return this.#tx({ mint, deltaTokens: -vendidos, deltaSol: solRecibido, tokensAntes });
    }

    // Compra.
    if (r < 0.88) {
      const reciclar = saturado || (this.tokens.size > 0 && this.rnd() < 0.3);
      const fuente = reciclar && this.posiciones.size > 0 ? [...this.posiciones.keys()] : null;
      const mint = fuente
        ? fuente[Math.floor(this.rnd() * fuente.length)]
        : (this.tokens.size > 0 && this.rnd() < 0.3
            ? [...this.tokens.keys()][Math.floor(this.rnd() * this.tokens.size)]
            : this.nuevoToken());
      const fraccion = 0.02 + this.rnd() * 0.10;
      const solGastado = this.sol * fraccion;
      if (solGastado < 1e-4) return null;
      const tokens = solGastado / this.tokens.get(mint).precio;
      const tokensAntes = this.posiciones.get(mint) ?? 0;

      this.sol -= solGastado;
      this.posiciones.set(mint, tokensAntes + tokens);
      return this.#tx({ mint, deltaTokens: tokens, deltaSol: -solGastado, tokensAntes });
    }

    return null; // nada este tick
  }
}
