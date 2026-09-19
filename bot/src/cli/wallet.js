#!/usr/bin/env node
// Manejo de la billetera desde la terminal. La clave privada nunca pasa por Telegram.
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config.js';
import { cifrarClave, guardarKeystore, leerKeystore, descifrarClave, clavePrivadaDesdeTexto } from '../solana/wallet.js';

function preguntar(texto, oculto = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolver) => {
    if (oculto) {
      const escribir = rl.output.write.bind(rl.output);
      let primera = true;
      rl.output.write = (s) => { if (primera) { escribir(s); primera = false; } };
      rl._writeToOutput = () => {};
    }
    rl.question(texto, (respuesta) => {
      if (oculto) process.stdout.write('\n');
      rl.close();
      resolver(respuesta.trim());
    });
  });
}

async function frase() {
  if (config.passphrase) return config.passphrase;
  const f = await preguntar('Frase de paso para cifrar la billetera (min 8 caracteres): ', true);
  if (f.length < 8) throw new Error('La frase debe tener al menos 8 caracteres.');
  return f;
}

const comando = process.argv[2];

async function ejecutar() {
if (comando === 'nueva') {
  if (existsSync(config.rutaKeystore)) {
    console.error(`✖ Ya existe ${config.rutaKeystore}. Borralo a mano si de verdad quieres reemplazarlo.`);
    process.exit(1);
  }
  const f = await frase();
  const par = Keypair.generate();
  guardarKeystore(config.rutaKeystore, cifrarClave(par.secretKey, f));
  console.log(`\n✅ Billetera creada.\n\nDireccion (esta es la que depositas):\n  ${par.publicKey.toBase58()}\n`);
  console.log(`Archivo cifrado: ${config.rutaKeystore}`);
  console.log('\nGuarda tu frase de paso. Sin ella el archivo no se abre y pierdes el acceso.');
  console.log('Copia de seguridad de la clave privada (guardala fuera de este servidor):');
  console.log(`  ${bs58.encode(par.secretKey)}\n`);
} else if (comando === 'importar') {
  if (existsSync(config.rutaKeystore)) {
    console.error(`✖ Ya existe ${config.rutaKeystore}. Borralo a mano si quieres reemplazarlo.`);
    process.exit(1);
  }
  console.log('Pega la clave privada de la billetera QUEMABLE (la que exportas de Phantom).');
  console.log('No uses tu billetera principal.\n');
  const texto = await preguntar('Clave privada: ', true);
  const secreta = clavePrivadaDesdeTexto(texto);
  const f = await frase();
  const par = Keypair.fromSecretKey(secreta);
  guardarKeystore(config.rutaKeystore, cifrarClave(secreta, f));
  console.log(`\n✅ Billetera importada: ${par.publicKey.toBase58()}`);
} else if (comando === 'ver') {
  const ks = leerKeystore(config.rutaKeystore);
  if (!ks) { console.error('✖ No hay billetera todavia.'); process.exit(1); }
  const f = await frase();
  const par = Keypair.fromSecretKey(descifrarClave(ks, f));
  console.log(`\nDireccion: ${par.publicKey.toBase58()}`);
  console.log('(la clave privada no se imprime a proposito)\n');
} else {
  console.log('Uso: npm run wallet:nueva | wallet:importar | wallet:ver');
  process.exit(1);
}
}

// Sin esto, una frase equivocada saldria como un volcado de Node en vez de una frase
// que se entienda.
try {
  await ejecutar();
} catch (e) {
  console.error(`\n✖ ${e.message}\n`);
  process.exit(1);
}
