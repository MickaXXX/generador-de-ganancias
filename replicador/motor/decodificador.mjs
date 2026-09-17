// Decodifica un swap mirando SOLO los deltas de balance del trader.
//
// Por que asi y no parseando instrucciones: escribir un parser por cada DEX
// (Raydium, Orca, Meteora, Pump.fun, Jupiter, y el que salga el mes que viene)
// es trabajo infinito y se rompe solo. Los deltas de balance ya vienen en la
// respuesta de Solana y significan lo mismo en todos los DEX: si el trader
// termino con mas del token X y menos SOL, compro X. Punto.

export const MINT_SOL = 'So11111111111111111111111111111111111111112'; // WSOL
const LAMPORTS = 1e9;
const EPSILON = 1e-9;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Suma, por mint, los balances de token que pertenecen al duenio. */
function porMint(balances, duenio) {
  const mapa = new Map();
  for (const b of balances ?? []) {
    if (b?.owner !== duenio) continue;
    const cantidad = num(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount);
    mapa.set(b.mint, (mapa.get(b.mint) ?? 0) + cantidad);
  }
  return mapa;
}

function indiceDe(claves, duenio) {
  return (claves ?? []).findIndex((k) => (typeof k === 'string' ? k : k?.pubkey) === duenio);
}

/**
 * @returns {null | {
 *   lado:'compra'|'venta', mint:string, solTrader:number, tokensTrader:number,
 *   fraccion:number, base:'sol-disponible'|'posicion', firma:string, ts:number
 * }}
 * `fraccion` es la parte del recurso relevante que el trader movio:
 *   - compra: SOL gastado / SOL que tenia disponible antes
 *   - venta:  tokens vendidos / tokens que tenia antes
 * Esto evita necesitar un oraculo de precios para escalar la operacion, y hace
 * que las ventas calcen exactamente en porcentaje sin dejar polvo.
 */
export function decodificar(tx, duenio) {
  const meta = tx?.meta;
  if (!meta || meta.err) return null;

  const claves = tx?.transaction?.message?.accountKeys;
  const i = indiceDe(claves, duenio);
  if (i < 0) return null;

  // SOL nativo. La comision la paga la cuenta 0; se la devolvemos al delta
  // para no confundir un fee con parte del tamanio de la operacion.
  const feeDelDuenio = i === 0 ? num(meta.fee) : 0;
  let solPre = num(meta.preBalances?.[i]) / LAMPORTS;
  let solPost = (num(meta.postBalances?.[i]) + feeDelDuenio) / LAMPORTS;

  const pre = porMint(meta.preTokenBalances, duenio);
  const post = porMint(meta.postTokenBalances, duenio);

  // WSOL es SOL envuelto: cuenta como SOL, no como un token mas.
  solPre += pre.get(MINT_SOL) ?? 0;
  solPost += post.get(MINT_SOL) ?? 0;
  pre.delete(MINT_SOL);
  post.delete(MINT_SOL);

  const deltaSol = solPost - solPre;

  const comprados = [];
  const vendidos = [];
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    const antes = pre.get(mint) ?? 0;
    const despues = post.get(mint) ?? 0;
    const delta = despues - antes;
    if (delta > EPSILON) comprados.push({ mint, delta, antes });
    else if (delta < -EPSILON) vendidos.push({ mint, delta, antes });
  }

  const comun = {
    firma: tx?.transaction?.signatures?.[0] ?? '',
    ts: num(tx?.blockTime) * 1000 || Date.now(),
  };

  // Compra: salio SOL, entro exactamente un token.
  if (deltaSol < -EPSILON && comprados.length === 1 && vendidos.length === 0) {
    const { mint, delta } = comprados[0];
    const solGastado = -deltaSol;
    if (solPre <= EPSILON) return null;
    return {
      ...comun,
      lado: 'compra',
      mint,
      solTrader: solGastado,
      tokensTrader: delta,
      fraccion: Math.min(1, solGastado / solPre),
      base: 'sol-disponible',
    };
  }

  // Venta: entro SOL, salio exactamente un token.
  if (deltaSol > EPSILON && vendidos.length === 1 && comprados.length === 0) {
    const { mint, delta, antes } = vendidos[0];
    if (antes <= EPSILON) return null;
    return {
      ...comun,
      lado: 'venta',
      mint,
      solTrader: deltaSol,
      tokensTrader: -delta,
      fraccion: Math.min(1, -delta / antes),
      base: 'posicion',
    };
  }

  // Todo lo demas (transferencias, aportes de liquidez, swaps token a token,
  // NFT, staking) se ignora a proposito. Copiar lo que no entendemos es peor
  // que no copiar nada.
  return null;
}
