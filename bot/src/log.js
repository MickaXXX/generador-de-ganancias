// Registro con censura: nada que parezca una clave privada o un token sale por consola.
const NIVELES = { debug: 10, info: 20, aviso: 30, error: 40 };
const nivelActivo = NIVELES[(process.env.LOG_NIVEL || 'info').trim()] ?? NIVELES.info;

// Una clave privada de Solana en base58 mide 87-88 caracteres; una direccion, 32-44.
const CLAVE_BASE58 = /\b[1-9A-HJ-NP-Za-km-z]{85,90}\b/g;
const ARREGLO_BYTES = /\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/g;

export function censurar(texto) {
  let salida = String(texto).replace(CLAVE_BASE58, '«clave-censurada»').replace(ARREGLO_BYTES, '«clave-censurada»');
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (token.length > 10) salida = salida.split(token).join('«token-censurado»');
  const frase = (process.env.WALLET_PASSPHRASE || '').trim();
  if (frase.length > 3) salida = salida.split(frase).join('«frase-censurada»');
  const jup = (process.env.JUPITER_API_KEY || '').trim();
  if (jup.length > 6) salida = salida.split(jup).join('«api-key-censurada»');
  return salida;
}

function emitir(nivel, etiqueta, args) {
  if (NIVELES[nivel] < nivelActivo) return;
  const partes = args.map((a) => {
    if (a instanceof Error) return censurar(a.stack || a.message);
    if (typeof a === 'object' && a !== null) {
      try { return censurar(JSON.stringify(a)); } catch { return '[objeto]'; }
    }
    return censurar(a);
  });
  const linea = `${new Date().toISOString()} ${etiqueta} ${partes.join(' ')}`;
  if (nivel === 'error') console.error(linea); else console.log(linea);
}

export const log = {
  debug: (...a) => emitir('debug', '·', a),
  info:  (...a) => emitir('info',  'i', a),
  aviso: (...a) => emitir('aviso', '!', a),
  error: (...a) => emitir('error', 'x', a),
};
