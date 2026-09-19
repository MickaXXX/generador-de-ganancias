// Carga y valida la configuracion. Todo lo que el bot puede cambiar en caliente
// vive en PARAMETROS; el resto (tokens, claves, RPC) solo se toca en el .env.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Mints de referencia. Son las monedas contra las que se mide una compra o una venta.
export const SOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const MONEDAS_BASE = new Set([SOL, USDC, USDT]);

function cargarEnv(ruta) {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte < 1) continue;
    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}
cargarEnv(join(RAIZ, '.env'));

const txt = (clave, def = '') => (process.env[clave] ?? def).trim();
const num = (clave, def) => {
  const crudo = process.env[clave];
  if (crudo === undefined || String(crudo).trim() === '') return def;
  const n = Number(String(crudo).trim());
  if (!Number.isFinite(n)) throw new Error(`La variable ${clave} deberia ser un numero y vale "${crudo}".`);
  return n;
};
const bool = (clave, def) => {
  const crudo = (process.env[clave] ?? '').trim().toLowerCase();
  if (!crudo) return def;
  return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(crudo);
};

// Parametros ajustables en caliente desde Telegram con /set.
// tipo: numero | booleano | texto ; min/max acotan lo que el usuario puede poner.
export const PARAMETROS = {
  modo:            { tipo: 'texto',    opciones: ['simulacion', 'real'], desc: 'simulacion = no gasta dinero real' },
  sizing:          { tipo: 'texto',    opciones: ['fijo', 'proporcional', 'patrimonio'], desc: 'como se calcula cuanto copiar' },
  compraUsd:       { tipo: 'numero',   min: 0.5,  max: 10000, desc: 'USD por copia en modo fijo' },
  proporcion:      { tipo: 'numero',   min: 0,    max: 1,     desc: 'fraccion del tamano del lider en modo proporcional' },
  patrimonioPct:   { tipo: 'numero',   min: 0.1,  max: 100,   desc: '% de tu saldo por copia en modo patrimonio' },
  compraMinUsd:    { tipo: 'numero',   min: 0.5,  max: 10000, desc: 'piso de cada copia' },
  compraMaxUsd:    { tipo: 'numero',   min: 0.5,  max: 10000, desc: 'techo de cada copia' },
  slippageBps:     { tipo: 'numero',   min: 10,   max: 5000,  desc: 'slippage de compra en puntos base (100 = 1%)' },
  slippageVentaBps:{ tipo: 'numero',   min: 10,   max: 5000,  desc: 'slippage de venta en puntos base' },
  impactoMaxPct:   { tipo: 'numero',   min: 0.1,  max: 100,   desc: 'impacto de precio maximo tolerado al comprar' },
  prioridadMaxLamports: { tipo: 'numero', min: 0, max: 50_000_000, desc: 'tope de propina de prioridad por transaccion' },
  maxPosiciones:   { tipo: 'numero',   min: 1,    max: 100,   desc: 'posiciones abiertas simultaneas' },
  maxComprasDia:   { tipo: 'numero',   min: 1,    max: 500,   desc: 'compras por dia' },
  perdidaDiaMaxUsd:{ tipo: 'numero',   min: 1,    max: 100000,desc: 'perdida diaria que apaga las compras' },
  reservaSol:      { tipo: 'numero',   min: 0,    max: 10,    desc: 'SOL que nunca se gasta (comisiones)' },
  cooldownMintMin: { tipo: 'numero',   min: 0,    max: 10080, desc: 'minutos antes de volver a comprar el mismo token' },
  promediar:       { tipo: 'booleano', desc: 'permitir comprar un token que ya tienes' },
  takeProfitPct:   { tipo: 'numero',   min: 0,    max: 10000, desc: '% de ganancia que dispara la venta (0 = apagado)' },
  stopLossPct:     { tipo: 'numero',   min: 0,    max: 100,   desc: '% de perdida que dispara la venta (0 = apagado)' },
  trailingActivaPct:{ tipo: 'numero',  min: 0,    max: 10000, desc: '% de ganancia desde el que se activa el trailing' },
  trailingCaidaPct:{ tipo: 'numero',   min: 0,    max: 100,   desc: '% de caida desde el pico que vende' },
  venderSiVendeLider: { tipo: 'booleano', desc: 'replicar las ventas del lider' },
  fraccionVentaDesconocida: { tipo: 'numero', min: 0, max: 1, desc: 'que fraccion vender si no viste la compra del lider' },
  maxEdadSenalS:   { tipo: 'numero',   min: 5,    max: 3600,  desc: 'segundos: mas vieja que esto, la senal se descarta' },
  pausado:         { tipo: 'booleano', desc: 'true = no abre posiciones nuevas' },
};

// Valores iniciales de esos parametros, tomados del .env.
export const parametrosIniciales = () => ({
  modo:            txt('MODO', 'simulacion') === 'real' ? 'real' : 'simulacion',
  sizing:          txt('SIZING_MODO', 'fijo'),
  compraUsd:       num('COMPRA_USD', 4),
  proporcion:      num('PROPORCION', 0.004),
  patrimonioPct:   num('PATRIMONIO_PCT', 2),
  compraMinUsd:    num('COMPRA_MIN_USD', 1),
  compraMaxUsd:    num('COMPRA_MAX_USD', 25),
  slippageBps:     num('SLIPPAGE_BPS', 150),
  slippageVentaBps:num('SLIPPAGE_VENTA_BPS', 300),
  impactoMaxPct:   num('IMPACTO_MAX_PCT', 8),
  prioridadMaxLamports: num('PRIORITY_FEE_MAX_LAMPORTS', 2_000_000),
  maxPosiciones:   num('MAX_POSICIONES', 8),
  maxComprasDia:   num('MAX_COMPRAS_DIA', 25),
  perdidaDiaMaxUsd:num('PERDIDA_DIA_MAX_USD', 25),
  reservaSol:      num('RESERVA_SOL', 0.02),
  cooldownMintMin: num('COOLDOWN_MINT_MIN', 30),
  promediar:       bool('PROMEDIAR', false),
  takeProfitPct:   num('TAKE_PROFIT_PCT', 60),
  stopLossPct:     num('STOP_LOSS_PCT', 35),
  trailingActivaPct: num('TRAILING_ACTIVA_PCT', 40),
  trailingCaidaPct:num('TRAILING_CAIDA_PCT', 15),
  venderSiVendeLider: bool('VENDER_SI_VENDE_LIDER', true),
  fraccionVentaDesconocida: num('FRACCION_VENTA_DESCONOCIDA', 1),
  maxEdadSenalS:   num('MAX_EDAD_SENAL_S', 90),
  pausado:         false,
});

export const config = {
  telegramToken: txt('TELEGRAM_BOT_TOKEN'),
  telegramOwnerId: txt('TELEGRAM_OWNER_ID'),
  rpc: [txt('RPC_URL', 'https://api.mainnet-beta.solana.com'), txt('RPC_URL_BACKUP')].filter(Boolean),
  jupiterBase: txt('JUPITER_BASE', 'https://api.jup.ag/swap/v1').replace(/\/$/, ''),
  jupiterTokensBase: txt('JUPITER_TOKENS_BASE', 'https://api.jup.ag/tokens/v2').replace(/\/$/, ''),
  jupiterApiKey: txt('JUPITER_API_KEY'),
  passphrase: process.env.WALLET_PASSPHRASE ?? '',
  rutaKeystore: txt('WALLET_KEYSTORE', join(RAIZ, 'wallet.enc.json')),
  rutaDatos: txt('RUTA_DATOS', join(RAIZ, 'datos', 'estado.json')),
  vigilanciaModo: txt('VIGILANCIA_MODO', 'poll'),
  pollMs: num('POLL_MS', 2500),
  monitorMs: num('MONITOR_MS', 20000),
  nivelLog: txt('LOG_NIVEL', 'info'),
};

// Valida un valor contra la definicion del parametro. Devuelve {ok, valor} o {ok:false, error}.
export function validarParametro(clave, crudo) {
  const def = PARAMETROS[clave];
  if (!def) return { ok: false, error: `No existe el parametro "${clave}".` };
  if (def.tipo === 'numero') {
    const n = Number(String(crudo).replace(',', '.'));
    if (!Number.isFinite(n)) return { ok: false, error: `"${crudo}" no es un numero.` };
    if (def.min !== undefined && n < def.min) return { ok: false, error: `El minimo de ${clave} es ${def.min}.` };
    if (def.max !== undefined && n > def.max) return { ok: false, error: `El maximo de ${clave} es ${def.max}.` };
    return { ok: true, valor: n };
  }
  if (def.tipo === 'booleano') {
    const v = String(crudo).trim().toLowerCase();
    if (['1', 'true', 'si', 'sí', 'on'].includes(v)) return { ok: true, valor: true };
    if (['0', 'false', 'no', 'off'].includes(v)) return { ok: true, valor: false };
    return { ok: false, error: `"${crudo}" no es si/no.` };
  }
  const v = String(crudo).trim().toLowerCase();
  if (def.opciones && !def.opciones.includes(v)) {
    return { ok: false, error: `${clave} solo acepta: ${def.opciones.join(', ')}.` };
  }
  return { ok: true, valor: v };
}
