#!/usr/bin/env node
/**
 * CLI de licencias.
 *
 *   node scripts/licencia.mjs generar-par
 *       Crea el par de claves. La privada queda en .claves/privada.jwk (NUNCA
 *       se sube al repo). La publica se imprime para pegarla en docs/config.js.
 *
 *   node scripts/licencia.mjs emitir --cliente "Minera X" --dias 365
 *       Emite una licencia firmada. Se la envias al comprador y listo.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { b64urlCodificar } from "../docs/core/licencia.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR_CLAVES = resolve(RAIZ, ".claves");
const RUTA_PRIVADA = resolve(DIR_CLAVES, "privada.jwk");
const ALGORITMO = { name: "ECDSA", namedCurve: "P-256" };
const PRODUCTO = "critispare-pro";

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

async function generarPar() {
  if (existsSync(RUTA_PRIVADA) && !process.argv.includes("--forzar")) {
    console.error(`Ya existe ${RUTA_PRIVADA}. Usa --forzar para reemplazarla (invalida TODAS las licencias emitidas).`);
    process.exit(1);
  }
  const par = await crypto.subtle.generateKey(ALGORITMO, true, ["sign", "verify"]);
  const privada = await crypto.subtle.exportKey("jwk", par.privateKey);
  const publica = await crypto.subtle.exportKey("jwk", par.publicKey);
  mkdirSync(DIR_CLAVES, { recursive: true });
  writeFileSync(RUTA_PRIVADA, JSON.stringify(privada, null, 2), { mode: 0o600 });
  console.log(`Clave privada guardada en ${RUTA_PRIVADA} (guardala, sin ella no puedes emitir licencias).\n`);
  console.log("Pega esto en docs/config.js -> CLAVE_PUBLICA:\n");
  console.log(JSON.stringify({ kty: publica.kty, crv: publica.crv, x: publica.x, y: publica.y }, null, 2));
}

async function emitir() {
  if (!existsSync(RUTA_PRIVADA)) {
    console.error("No hay clave privada. Corre primero: node scripts/licencia.mjs generar-par");
    process.exit(1);
  }
  const cliente = argumento("cliente", "Cliente");
  const dias = Number(argumento("dias", "365"));
  const vence = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

  const jwk = JSON.parse(readFileSync(RUTA_PRIVADA, "utf8"));
  const privada = await crypto.subtle.importKey("jwk", jwk, ALGORITMO, false, ["sign"]);

  const payload = {
    c: cliente,
    exp: vence,
    p: PRODUCTO,
    id: b64urlCodificar(crypto.getRandomValues(new Uint8Array(6))),
  };
  const codificado = b64urlCodificar(new TextEncoder().encode(JSON.stringify(payload)));
  const firma = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privada, new TextEncoder().encode(codificado)
  );
  console.log(`\nLicencia para: ${cliente}\nVence: ${vence}\n\n${codificado}.${b64urlCodificar(new Uint8Array(firma))}\n`);
}

const comando = process.argv[2];
if (comando === "generar-par") await generarPar();
else if (comando === "emitir") await emitir();
else {
  console.log("Uso:\n  node scripts/licencia.mjs generar-par\n  node scripts/licencia.mjs emitir --cliente \"Nombre\" --dias 365");
  process.exit(1);
}
