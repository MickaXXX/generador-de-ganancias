// La clave privada vive cifrada en disco (AES-256-GCM con clave derivada por scrypt)
// y solo se descifra en memoria al arrancar. Nunca se escribe en el log, nunca se
// manda por Telegram y nunca sale del proceso.
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };
// OpenSSL necesita 128*N*r bytes mas un margen propio; sin holgura tira
// "memory limit exceeded" y la billetera no se podria ni crear ni abrir.
const memoria = ({ N, r }) => 128 * N * r * 2;

function derivar(frase, sal) {
  if (!frase || frase.length < 8) {
    throw new Error('WALLET_PASSPHRASE debe tener al menos 8 caracteres.');
  }
  return scryptSync(frase, sal, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: memoria(SCRYPT) });
}

export function cifrarClave(secreta, frase) {
  const sal = randomBytes(16);
  const iv = randomBytes(12);
  const clave = derivar(frase, sal);
  const cifrador = createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([cifrador.update(Buffer.from(secreta)), cifrador.final()]);
  return {
    version: 1,
    algoritmo: 'aes-256-gcm',
    kdf: 'scrypt',
    parametros: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    sal: sal.toString('base64'),
    iv: iv.toString('base64'),
    tag: cifrador.getAuthTag().toString('base64'),
    datos: cifrado.toString('base64'),
    publica: Keypair.fromSecretKey(Uint8Array.from(secreta)).publicKey.toBase58(),
  };
}

export function descifrarClave(keystore, frase) {
  const sal = Buffer.from(keystore.sal, 'base64');
  const p = keystore.parametros ?? SCRYPT;
  const clave = scryptSync(frase, sal, 32, { N: p.N, r: p.r, p: p.p, maxmem: memoria(p) });
  const descifrador = createDecifrador(keystore, clave);
  try {
    return Uint8Array.from(Buffer.concat([
      descifrador.update(Buffer.from(keystore.datos, 'base64')),
      descifrador.final(),
    ]));
  } catch {
    throw new Error('La frase de paso no abre el archivo de la billetera.');
  }
}

function createDecifrador(keystore, clave) {
  const d = createDecipheriv('aes-256-gcm', clave, Buffer.from(keystore.iv, 'base64'));
  d.setAuthTag(Buffer.from(keystore.tag, 'base64'));
  return d;
}

/** Acepta el formato que exporta Phantom (base58) o un arreglo JSON de 64 bytes. */
export function clavePrivadaDesdeTexto(texto) {
  const limpio = texto.trim();
  let bytes;
  try {
    bytes = limpio.startsWith('[') ? Uint8Array.from(JSON.parse(limpio)) : bs58.decode(limpio);
  } catch {
    throw new Error('Eso no parece una clave privada. Pega la que exporta Phantom (texto largo) o el arreglo JSON de 64 numeros.');
  }
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return Keypair.fromSeed(bytes).secretKey;
  throw new Error(`La clave privada deberia tener 64 bytes y tiene ${bytes.length}.`);
}

export function guardarKeystore(ruta, keystore) {
  writeFileSync(ruta, JSON.stringify(keystore, null, 2), { mode: 0o600 });
  try { chmodSync(ruta, 0o600); } catch { /* sistemas sin permisos POSIX */ }
}

export function leerKeystore(ruta) {
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

/** Carga la billetera lista para firmar. Lanza un error claro si falta algo. */
export function cargarBilletera({ rutaKeystore, passphrase }) {
  const keystore = leerKeystore(rutaKeystore);
  if (!keystore) {
    throw new Error(`No existe ${rutaKeystore}. Crea la billetera con: npm run wallet:nueva`);
  }
  const secreta = descifrarClave(keystore, passphrase);
  const par = Keypair.fromSecretKey(secreta);
  if (keystore.publica && keystore.publica !== par.publicKey.toBase58()) {
    throw new Error('El archivo de billetera esta inconsistente.');
  }
  return par;
}

/** Comparacion en tiempo constante, para chequear identificadores sin filtrar por tiempo. */
export function igualSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
