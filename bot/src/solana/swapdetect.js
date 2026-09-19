// Detecta compras y ventas mirando como cambiaron los saldos del lider dentro de la
// transaccion, en vez de intentar entender cada programa (Raydium, Pump.fun, Meteora,
// Jupiter, Photon...). Si al lider le entra un token y le sale SOL, compro. Punto.
// Esto funciona con cualquier DEX presente y futuro, que es justo lo que hace que el
// bot no se rompa cada vez que sale un lanzador nuevo.
import { SOL, MONEDAS_BASE } from '../config.js';

// Piso de ruido en SOL. Por debajo de esto un movimiento de SOL no es una operacion:
// es la comision (~0.000005), la renta de una cuenta de token (~0.00204) o la
// devolucion de esa renta al cerrarla. Sin este piso, una simple transferencia de
// tokens se leeria como una venta, porque al cerrar la cuenta vuelve la renta.
const POLVO_SOL = 0.003;

function clavesDeCuenta(tx) {
  const claves = tx?.transaction?.message?.accountKeys ?? [];
  return claves.map((k) => (typeof k === 'string' ? k : k.pubkey));
}

function sumar(mapa, mint, delta, decimales) {
  const previo = mapa.get(mint);
  if (previo) previo.delta += delta;
  else mapa.set(mint, { mint, delta, decimales });
}

function ui(saldo) {
  const t = saldo.uiTokenAmount;
  if (t.uiAmountString !== undefined && t.uiAmountString !== null) return Number(t.uiAmountString);
  if (typeof t.uiAmount === 'number') return t.uiAmount;
  return Number(t.amount) / 10 ** t.decimals;
}

/**
 * Calcula cuanto vario cada activo del lider en una transaccion.
 * Devuelve un Map mint -> { mint, delta, decimales }, con el SOL envuelto (wSOL)
 * ya sumado al SOL nativo para que no aparezcan como dos cosas distintas.
 */
export function deltasDelDueno(tx, dueno) {
  const meta = tx?.meta;
  const mapa = new Map();
  if (!meta) return mapa;

  const claves = clavesDeCuenta(tx);
  const indice = claves.indexOf(dueno);
  let deltaSol = 0;
  if (indice >= 0 && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
    deltaSol = (meta.postBalances[indice] - meta.preBalances[indice]) / 1e9;
    // La comision la paga el primer firmante: se la devolvemos para medir la intencion,
    // no el costo de la red.
    if (indice === 0) deltaSol += (meta.fee ?? 0) / 1e9;
  }

  for (const saldo of meta.preTokenBalances ?? []) {
    if (saldo.owner !== dueno) continue;
    sumar(mapa, saldo.mint, -ui(saldo), saldo.uiTokenAmount.decimals);
  }
  for (const saldo of meta.postTokenBalances ?? []) {
    if (saldo.owner !== dueno) continue;
    sumar(mapa, saldo.mint, ui(saldo), saldo.uiTokenAmount.decimals);
  }

  // wSOL y SOL son la misma cosa para efectos de un swap.
  const envuelto = mapa.get(SOL);
  if (envuelto) {
    deltaSol += envuelto.delta;
    mapa.delete(SOL);
  }
  if (Math.abs(deltaSol) > POLVO_SOL) sumar(mapa, SOL, deltaSol, 9);

  for (const [mint, v] of mapa) if (v.delta === 0) mapa.delete(mint);
  return mapa;
}

/**
 * Convierte una transaccion en cero, una o dos senales.
 * Senal: { tipo:'compra'|'venta', mint, cantidad, decimales, base:{mint,cantidad}|null }
 * - compra: al lider le entro un token que no es moneda base.
 * - venta:  al lider le salio un token que no es moneda base.
 * Una transferencia simple (solo entra o solo sale) no es un swap y se descarta.
 */
export function detectarSwaps(tx, lider) {
  if (!tx || tx.meta?.err) return [];

  const deltas = [...deltasDelDueno(tx, lider).values()];
  if (deltas.length < 2) return [];

  const entran = deltas.filter((d) => d.delta > 0);
  const salen = deltas.filter((d) => d.delta < 0);
  if (entran.length === 0 || salen.length === 0) return [];

  const mayor = (lista) => lista.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const basesQueSalen = salen.filter((d) => MONEDAS_BASE.has(d.mint));
  const basesQueEntran = entran.filter((d) => MONEDAS_BASE.has(d.mint));
  const tokensQueEntran = entran.filter((d) => !MONEDAS_BASE.has(d.mint));
  const tokensQueSalen = salen.filter((d) => !MONEDAS_BASE.has(d.mint));

  const senales = [];
  const firma = tx.transaction?.signatures?.[0] ?? null;
  const tiempo = tx.blockTime ? tx.blockTime * 1000 : Date.now();

  for (const t of tokensQueEntran) {
    const base = basesQueSalen.length ? mayor(basesQueSalen) : null;
    senales.push({
      tipo: 'compra', firma, tiempo, lider,
      mint: t.mint, cantidad: t.delta, decimales: t.decimales,
      base: base ? { mint: base.mint, cantidad: Math.abs(base.delta) } : null,
    });
  }
  for (const t of tokensQueSalen) {
    const base = basesQueEntran.length ? mayor(basesQueEntran) : null;
    senales.push({
      tipo: 'venta', firma, tiempo, lider,
      mint: t.mint, cantidad: Math.abs(t.delta), decimales: t.decimales,
      base: base ? { mint: base.mint, cantidad: base.delta } : null,
    });
  }

  // Si solo se movieron monedas base entre si (por ejemplo SOL -> USDC), no nos interesa.
  return senales;
}

/** Valor en dolares de la pata base de una senal. null si no se puede saber. */
export function valorBaseUsd(base, precioSolUsd) {
  if (!base) return null;
  if (base.mint === SOL) return precioSolUsd ? base.cantidad * precioSolUsd : null;
  return base.cantidad; // USDC y USDT valen 1
}
