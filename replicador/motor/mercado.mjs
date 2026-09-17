// Datos de mercado reales: precio en SOL, liquidez, edad del pool y si el
// token puede imprimir unidades o congelar tu billetera.
//
// La politica rechaza cualquier token del que no tenga datos, asi que este
// modulo es lo que decide si una compra se puede evaluar o no.

const SOL = 'So11111111111111111111111111111111111111112';
const TTL_PRECIO = 15_000;
const TTL_INFO = 10 * 60_000;

/** Lee autoridades de mint/freeze de la respuesta jsonParsed de un mint. */
export function leerAutoridades(cuenta) {
  const info = cuenta?.value?.data?.parsed?.info;
  if (!info) return null;
  return {
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    decimales: info.decimals ?? 6,
  };
}

/** Se queda con el par mas liquido y saca liquidez, edad y precio en SOL. */
export function leerParesDex(respuesta, ahora = Date.now()) {
  const pares = respuesta?.pairs;
  if (!Array.isArray(pares) || pares.length === 0) return null;

  const mejor = pares.reduce((a, b) => ((b?.liquidity?.usd ?? 0) > (a?.liquidity?.usd ?? 0) ? b : a));
  const liquidezUsd = Number(mejor?.liquidity?.usd ?? 0);
  const creado = Number(mejor?.pairCreatedAt ?? 0);

  return {
    liquidezUsd,
    edadMinutos: creado > 0 ? (ahora - creado) / 60_000 : 0,
    precioUsd: Number(mejor?.priceUsd ?? 0),
    // priceNative viene en la moneda base del par: solo sirve si el par es contra SOL.
    precioSol: /^(SOL|WSOL)$/i.test(mejor?.quoteToken?.symbol ?? '') ? Number(mejor?.priceNative ?? 0) : 0,
  };
}

export class MercadoReal {
  /** @param obtener  inyectable para poder probar el parseo sin red. */
  constructor({ conexion, obtener = fetch, ahora = () => Date.now() } = {}) {
    this.conexion = conexion;
    this.obtener = obtener;
    this.ahora = ahora;
    this.cachePrecio = new Map(); // mint -> {sol, ts}
    this.cacheInfo = new Map();   // mint -> {info, ts}
  }

  async #json(url) {
    try {
      const r = await this.obtener(url);
      return r?.ok ? await r.json() : null;
    } catch { return null; }
  }

  async infoToken(mint) {
    if (mint === SOL) return null;
    const guardado = this.cacheInfo.get(mint);
    if (guardado && this.ahora() - guardado.ts < TTL_INFO) return guardado.info;

    const dex = leerParesDex(await this.#json(`https://api.dexscreener.com/latest/dex/tokens/${mint}`), this.ahora());
    if (!dex) return null;

    // Las autoridades son el filtro anti-trampa y no se pueden dar por buenas
    // si la consulta falla: sin dato, no se compra.
    let autoridades = null;
    try {
      const { PublicKey } = await import('@solana/web3.js');
      autoridades = leerAutoridades(await this.conexion.getParsedAccountInfo(new PublicKey(mint)));
    } catch { autoridades = null; }
    if (!autoridades) return null;

    const info = { ...dex, ...autoridades };
    this.cacheInfo.set(mint, { info, ts: this.ahora() });
    if (dex.precioSol > 0) this.cachePrecio.set(mint, { sol: dex.precioSol, ts: this.ahora() });
    return info;
  }

  async precio(mint) {
    const guardado = this.cachePrecio.get(mint);
    if (guardado && this.ahora() - guardado.ts < TTL_PRECIO) return guardado.sol;

    // Jupiter cotiza contra USD; se pasa a SOL con el precio de SOL.
    const datos = await this.#json(`https://lite-api.jup.ag/price/v3?ids=${mint},${SOL}`);
    const usdToken = Number(datos?.[mint]?.usdPrice ?? datos?.data?.[mint]?.price ?? 0);
    const usdSol = Number(datos?.[SOL]?.usdPrice ?? datos?.data?.[SOL]?.price ?? 0);
    if (usdToken > 0 && usdSol > 0) {
      const sol = usdToken / usdSol;
      this.cachePrecio.set(mint, { sol, ts: this.ahora() });
      return sol;
    }
    return guardado?.sol ?? 0;
  }

  /** Refresca en paralelo los mints que importan y devuelve el mapa de precios. */
  async precios(mints = [...this.cachePrecio.keys()]) {
    await Promise.all(mints.map((m) => this.precio(m).catch(() => 0)));
    return new Map([...this.cachePrecio].map(([m, v]) => [m, v.sol]));
  }
}
