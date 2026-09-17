// Resuelve un perfil de FOMO a su direccion de Solana.
//
// Se intenta en orden y se cae con gracia: si ninguna fuente responde, la app
// pide pegar la direccion a mano, que siempre funciona. En FOMO la direccion
// esta visible en el perfil del trader.

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const esDireccion = (s) => typeof s === 'string' && BASE58.test(s.trim());

/** Saca el nombre de usuario de una URL de perfil de FOMO. */
export function usuarioDesdeUrl(entrada) {
  const t = String(entrada ?? '').trim();
  if (esDireccion(t)) return null;
  const m = t.match(/fomo\.family\/profile\/([^/?#\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  return t.replace(/^@/, '') || null;
}

async function json(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

function buscarDireccion(obj, profundidad = 0) {
  if (profundidad > 6 || obj == null) return null;
  if (typeof obj === 'string') return esDireccion(obj) ? obj : null;
  if (Array.isArray(obj)) {
    for (const v of obj) { const d = buscarDireccion(v, profundidad + 1); if (d) return d; }
    return null;
  }
  if (typeof obj !== 'object') return null;
  // Las claves con nombre explicito mandan sobre cualquier otra cadena base58.
  for (const k of ['wallet', 'walletAddress', 'address', 'pubkey', 'publicKey', 'solanaAddress', 'owner']) {
    if (esDireccion(obj[k])) return obj[k];
  }
  for (const v of Object.values(obj)) { const d = buscarDireccion(v, profundidad + 1); if (d) return d; }
  return null;
}

/**
 * @returns {Promise<{direccion:string, via:string} | {error:string}>}
 */
export async function resolver(entrada) {
  const texto = String(entrada ?? '').trim();
  if (esDireccion(texto)) return { direccion: texto, via: 'direccion pegada directamente' };

  const usuario = usuarioDesdeUrl(texto);
  if (!usuario) return { error: 'No reconoci ni una direccion ni un perfil de FOMO.' };

  const intentos = [
    { url: `https://www.fomoscan.sh/api/wallet/${encodeURIComponent(usuario)}`, via: 'FomoScan' },
    { url: `https://api.fomoscan.sh/v1/user/${encodeURIComponent(usuario)}`, via: 'FomoScan v1' },
    { url: `https://fomo.family/api/profile/${encodeURIComponent(usuario)}`, via: 'API publica de FOMO' },
  ];

  for (const { url, via } of intentos) {
    const d = buscarDireccion(await json(url));
    if (d) return { direccion: d, via };
  }

  return {
    error: `No pude resolver "${usuario}" automaticamente. Abri su perfil en la app de FOMO, ` +
           `copia la direccion de su billetera y pegala aca. Es un texto de ~44 caracteres.`,
    usuario,
  };
}
