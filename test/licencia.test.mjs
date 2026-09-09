import test from "node:test";
import assert from "node:assert/strict";
import {
  verificarLicencia, verificarGumroad, b64urlCodificar, b64urlDecodificar,
} from "../docs/core/licencia.js";

const ALGORITMO = { name: "ECDSA", namedCurve: "P-256" };
const PRODUCTO = "critispare-pro";

async function nuevoVendedor() {
  const par = await crypto.subtle.generateKey(ALGORITMO, true, ["sign", "verify"]);
  const publica = await crypto.subtle.exportKey("jwk", par.publicKey);
  const firmar = async (payload) => {
    const codificado = b64urlCodificar(new TextEncoder().encode(JSON.stringify(payload)));
    const firma = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, par.privateKey, new TextEncoder().encode(codificado)
    );
    return `${codificado}.${b64urlCodificar(new Uint8Array(firma))}`;
  };
  return { publica: { kty: publica.kty, crv: publica.crv, x: publica.x, y: publica.y }, firmar };
}

const enDias = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

test("base64url ida y vuelta con longitudes que requieren relleno", () => {
  for (const largo of [0, 1, 2, 3, 4, 5, 17, 64, 100]) {
    const bytes = new Uint8Array(largo).map((_, i) => (i * 37 + 11) % 256);
    assert.deepEqual([...b64urlDecodificar(b64urlCodificar(bytes))], [...bytes], `largo ${largo}`);
  }
});

test("base64url no usa caracteres que rompan una URL", () => {
  const texto = b64urlCodificar(new Uint8Array(256).map((_, i) => i));
  assert.ok(!/[+/=]/.test(texto), `caracteres no seguros en ${texto}`);
});

test("una licencia recien emitida es valida", async () => {
  const v = await nuevoVendedor();
  const clave = await v.firmar({ c: "Minera Escondida", exp: enDias(365), p: PRODUCTO });
  const r = await verificarLicencia(clave, v.publica, { producto: PRODUCTO });
  assert.equal(r.valida, true, r.motivo);
  assert.equal(r.cliente, "Minera Escondida");
});

test("una licencia alterada se rechaza (no se puede cambiar el nombre)", async () => {
  const v = await nuevoVendedor();
  const clave = await v.firmar({ c: "Cliente Pagado", exp: enDias(365), p: PRODUCTO });
  const [, firma] = clave.split(".");
  const falsificado = b64urlCodificar(
    new TextEncoder().encode(JSON.stringify({ c: "Pirata", exp: enDias(9999), p: PRODUCTO }))
  );
  const r = await verificarLicencia(`${falsificado}.${firma}`, v.publica);
  assert.equal(r.valida, false);
  assert.match(r.motivo, /no valida|alterada/i);
});

test("la firma de otro vendedor no sirve", async () => {
  const a = await nuevoVendedor();
  const b = await nuevoVendedor();
  const clave = await b.firmar({ c: "X", exp: enDias(30), p: PRODUCTO });
  assert.equal((await verificarLicencia(clave, a.publica)).valida, false);
});

test("una licencia vencida se rechaza, y el ultimo dia todavia vale", async () => {
  const v = await nuevoVendedor();
  const vencida = await v.firmar({ c: "X", exp: enDias(-1), p: PRODUCTO });
  const r = await verificarLicencia(vencida, v.publica);
  assert.equal(r.valida, false);
  assert.match(r.motivo, /vencida/i);

  const hoy = await v.firmar({ c: "X", exp: enDias(0), p: PRODUCTO });
  assert.equal((await verificarLicencia(hoy, v.publica)).valida, true);
});

test("una licencia sin vencimiento es perpetua", async () => {
  const v = await nuevoVendedor();
  const clave = await v.firmar({ c: "Perpetua", p: PRODUCTO });
  const r = await verificarLicencia(clave, v.publica, { ahora: new Date("2099-01-01") });
  assert.equal(r.valida, true);
});

test("una licencia de otro producto se rechaza", async () => {
  const v = await nuevoVendedor();
  const clave = await v.firmar({ c: "X", exp: enDias(30), p: "otro-producto" });
  const r = await verificarLicencia(clave, v.publica, { producto: PRODUCTO });
  assert.equal(r.valida, false);
  assert.match(r.motivo, /otro producto/i);
});

test("entradas basura no lanzan excepcion, devuelven motivo legible", async () => {
  const v = await nuevoVendedor();
  for (const basura of ["", "   ", "sin-punto", "a.b", "....", "%%%.%%%", null, undefined]) {
    const r = await verificarLicencia(basura, v.publica);
    assert.equal(r.valida, false, `deberia rechazar: ${JSON.stringify(basura)}`);
    assert.equal(typeof r.motivo, "string");
    assert.ok(r.motivo.length > 0);
  }
});

test("los espacios al pegar la clave no la invalidan", async () => {
  const v = await nuevoVendedor();
  const clave = await v.firmar({ c: "X", exp: enDias(30), p: PRODUCTO });
  const conEspacios = `  ${clave.slice(0, 20)} \n ${clave.slice(20)}  `;
  assert.equal((await verificarLicencia(conEspacios, v.publica)).valida, true);
});

// --- Gumroad (con fetch simulado) ------------------------------------------

const fetchFalso = (json) => async () => ({ json: async () => json });

test("Gumroad: compra valida desbloquea", async () => {
  const r = await verificarGumroad("ABC", "prod", fetchFalso({
    success: true, purchase: { email: "cliente@minera.cl", refunded: false },
  }));
  assert.equal(r.valida, true);
  assert.equal(r.cliente, "cliente@minera.cl");
});

test("Gumroad: reembolso, chargeback y suscripcion cancelada bloquean", async () => {
  const casos = [
    { success: true, purchase: { refunded: true } },
    { success: true, purchase: { chargebacked: true } },
    { success: true, purchase: { subscription_cancelled_at: "2026-01-01" } },
    { success: false, message: "That license does not exist" },
  ];
  for (const caso of casos) {
    const r = await verificarGumroad("ABC", "prod", fetchFalso(caso));
    assert.equal(r.valida, false, JSON.stringify(caso));
  }
});

test("Gumroad: respuesta no-JSON no rompe la app", async () => {
  const r = await verificarGumroad("ABC", "prod", async () => ({
    json: async () => { throw new Error("no es json"); },
  }));
  assert.equal(r.valida, false);
});
