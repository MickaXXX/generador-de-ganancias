/**
 * Licencias verificables sin servidor.
 *
 * Se firma un payload con una clave privada ECDSA P-256 que solo tiene el
 * vendedor; el sitio lleva incrustada solo la clave publica. Cualquiera puede
 * comprobar una licencia, nadie puede fabricarla. Cero backend, cero costo,
 * cero mantencion. Funciona igual en Node y en el navegador (WebCrypto).
 */

const ALGORITMO = { name: "ECDSA", namedCurve: "P-256" };
const FIRMA = { name: "ECDSA", hash: "SHA-256" };

// --- base64url portable (sin Buffer ni atob dependientes del entorno) -------

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function b64urlCodificar(bytes) {
  let salida = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    salida += ALFABETO[b0 >> 2];
    salida += ALFABETO[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    salida += ALFABETO[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    salida += ALFABETO[b2 & 63];
  }
  return salida;
}

export function b64urlDecodificar(texto) {
  const limpio = texto.replace(/[^A-Za-z0-9\-_]/g, "");
  const bytes = [];
  let acumulador = 0;
  let bits = 0;
  for (const caracter of limpio) {
    const valor = ALFABETO.indexOf(caracter);
    if (valor < 0) continue;
    acumulador = (acumulador << 6) | valor;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acumulador >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

const aTexto = (bytes) => new TextDecoder().decode(bytes);
const aBytes = (texto) => new TextEncoder().encode(texto);

// --- verificacion -----------------------------------------------------------

/**
 * @param {string} clave licencia con formato "<payload>.<firma>" en base64url
 * @param {JsonWebKey} jwkPublica clave publica del vendedor
 * @param {{ahora?: Date, producto?: string}} opciones
 * @returns {Promise<{valida:boolean, motivo?:string, cliente?:string, expira?:string, id?:string}>}
 */
export async function verificarLicencia(clave, jwkPublica, opciones = {}) {
  const { ahora = new Date(), producto } = opciones;
  const cru = String(clave || "").trim().replace(/\s+/g, "");
  if (!cru) return { valida: false, motivo: "Ingresa una clave de licencia." };

  const partes = cru.split(".");
  if (partes.length !== 2) return { valida: false, motivo: "Formato de licencia inválido." };

  let datos;
  try {
    datos = JSON.parse(aTexto(b64urlDecodificar(partes[0])));
  } catch {
    return { valida: false, motivo: "La licencia está corrupta." };
  }

  let ok = false;
  try {
    const llave = await crypto.subtle.importKey("jwk", jwkPublica, ALGORITMO, false, ["verify"]);
    ok = await crypto.subtle.verify(FIRMA, llave, b64urlDecodificar(partes[1]), aBytes(partes[0]));
  } catch {
    return { valida: false, motivo: "No se pudo verificar la firma." };
  }
  if (!ok) return { valida: false, motivo: "Licencia no válida o alterada." };

  if (producto && datos.p && datos.p !== producto) {
    return { valida: false, motivo: "La licencia es de otro producto." };
  }
  if (datos.exp) {
    // Se compara por fecha: la licencia vale todo el dia de su vencimiento.
    const vence = new Date(`${datos.exp}T23:59:59Z`);
    if (Number.isNaN(vence.getTime())) return { valida: false, motivo: "Fecha de licencia inválida." };
    if (ahora > vence) return { valida: false, motivo: `Licencia vencida el ${datos.exp}.` };
  }

  return { valida: true, cliente: datos.c || "Cliente", expira: datos.exp || null, id: datos.id || null };
}

/**
 * Verificacion contra Gumroad (venta 100% automatica: el comprador paga y
 * Gumroad emite la clave sin intervencion humana).
 */
export async function verificarGumroad(clave, productId, fetchImpl = globalThis.fetch) {
  const cuerpo = new URLSearchParams({
    product_id: productId,
    license_key: String(clave || "").trim(),
    increment_uses_count: "false",
  });
  const respuesta = await fetchImpl("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: cuerpo.toString(),
  });
  const json = await respuesta.json().catch(() => ({}));
  if (!json.success) return { valida: false, motivo: json.message || "Licencia no encontrada." };
  if (json.purchase?.refunded || json.purchase?.chargebacked) {
    return { valida: false, motivo: "Compra reembolsada." };
  }
  if (json.purchase?.subscription_cancelled_at || json.purchase?.subscription_failed_at) {
    return { valida: false, motivo: "Suscripción cancelada." };
  }
  return { valida: true, cliente: json.purchase?.email || "Cliente Gumroad", expira: null };
}
