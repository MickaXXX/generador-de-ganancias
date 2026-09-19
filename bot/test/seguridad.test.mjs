import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { cifrarClave, descifrarClave, clavePrivadaDesdeTexto, guardarKeystore, leerKeystore, igualSeguro } from '../src/solana/wallet.js';
import { censurar } from '../src/log.js';
import { esDireccionSolana } from '../src/telegram/bot.js';

const carpeta = mkdtempSync(join(tmpdir(), 'copiabot-'));
process.on('exit', () => rmSync(carpeta, { recursive: true, force: true }));

test('la clave se cifra y se recupera igual', () => {
  const par = Keypair.generate();
  const ks = cifrarClave(par.secretKey, 'frase-larga-de-prueba');
  const recuperada = descifrarClave(ks, 'frase-larga-de-prueba');
  assert.deepEqual(Array.from(recuperada), Array.from(par.secretKey));
  assert.equal(ks.publica, par.publicKey.toBase58());
});

test('una frase equivocada no abre el archivo', () => {
  const ks = cifrarClave(Keypair.generate().secretKey, 'frase-correcta-1');
  assert.throws(() => descifrarClave(ks, 'frase-incorrecta'), /no abre/);
});

test('el archivo cifrado no contiene la clave en claro', () => {
  const par = Keypair.generate();
  const ruta = join(carpeta, 'wallet.enc.json');
  guardarKeystore(ruta, cifrarClave(par.secretKey, 'frase-larga-de-prueba'));
  const crudo = readFileSync(ruta, 'utf8');
  assert.ok(!crudo.includes(bs58.encode(par.secretKey)));
  assert.equal(leerKeystore(ruta).publica, par.publicKey.toBase58());
  // Solo el dueno del archivo puede leerlo.
  assert.equal(statSync(ruta).mode & 0o077, 0);
});

test('una frase corta se rechaza', () => {
  assert.throws(() => cifrarClave(Keypair.generate().secretKey, 'corta'), /al menos 8/);
});

test('acepta la clave privada en base58 (Phantom) y en arreglo JSON', () => {
  const par = Keypair.generate();
  assert.deepEqual(Array.from(clavePrivadaDesdeTexto(bs58.encode(par.secretKey))), Array.from(par.secretKey));
  assert.deepEqual(Array.from(clavePrivadaDesdeTexto(JSON.stringify(Array.from(par.secretKey)))), Array.from(par.secretKey));
});

test('una clave con largo raro se rechaza con un mensaje claro', () => {
  assert.throws(() => clavePrivadaDesdeTexto(bs58.encode(Buffer.alloc(10))), /64 bytes/);
});

test('el log censura claves privadas, tokens y frases', () => {
  const par = Keypair.generate();
  const clave = bs58.encode(par.secretKey);
  assert.ok(!censurar(`fallo con la clave ${clave}`).includes(clave));
  assert.ok(censurar(`clave ${JSON.stringify(Array.from(par.secretKey))}`).includes('censurada'));
  // La direccion publica no es secreta y debe seguir viendose.
  assert.ok(censurar(`wallet ${par.publicKey.toBase58()}`).includes(par.publicKey.toBase58()));
});

test('solo se aceptan direcciones de Solana validas', () => {
  assert.equal(esDireccionSolana(Keypair.generate().publicKey.toBase58()), true);
  assert.equal(esDireccionSolana('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7'), false);
  assert.equal(esDireccionSolana('no-es-una-direccion'), false);
  assert.equal(esDireccionSolana(''), false);
});

test('la comparacion segura no se rompe con largos distintos', () => {
  assert.equal(igualSeguro('12345', '12345'), true);
  assert.equal(igualSeguro('12345', '123456'), false);
});
