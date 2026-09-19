#!/usr/bin/env node
// Revision previa: comprueba una por una las cosas que pueden estar mal antes de
// poner dinero. Correlo siempre despues de tocar el .env.
import { config, SOL, USDC } from '../config.js';
import { Rpc } from '../solana/rpc.js';
import { Jupiter } from '../solana/jupiter.js';
import { leerKeystore, cargarBilletera } from '../solana/wallet.js';

let fallos = 0;
const ok = (t) => console.log(`✅ ${t}`);
const mal = (t) => { fallos++; console.log(`✖  ${t}`); };
const aviso = (t) => console.log(`•  ${t}`);

console.log('\n— Revision de Copiabot —\n');

// 1. Telegram
if (!config.telegramToken) mal('Falta TELEGRAM_BOT_TOKEN');
else {
  try {
    const r = await fetch(`https://api.telegram.org/bot${config.telegramToken}/getMe`).then((x) => x.json());
    if (r.ok) ok(`Telegram responde: @${r.result.username}`);
    else mal(`Telegram rechaza el token: ${r.description}`);
  } catch (e) { mal(`No pude hablar con Telegram: ${e.message}`); }
}
if (!config.telegramOwnerId) mal('Falta TELEGRAM_OWNER_ID (pregunta tu id a @userinfobot)');
else ok(`Dueno autorizado: ${config.telegramOwnerId}`);

// 2. RPC
const rpc = new Rpc(config.rpc);
try {
  const altura = await rpc.alturaBloque();
  ok(`RPC ${new URL(rpc.url).host} en el bloque ${altura}`);
  if (rpc.url.includes('api.mainnet-beta.solana.com')) {
    aviso('Estas usando la RPC publica de Solana: es lenta y tiene limite. Para copiar en serio, consigue una RPC propia (Helius, QuickNode, Triton).');
  }
} catch (e) { mal(`La RPC no responde: ${e.message}`); }

// 3. Jupiter
const jupiter = new Jupiter({ base: config.jupiterBase, tokensBase: config.jupiterTokensBase, apiKey: config.jupiterApiKey, rpc });
try {
  const cot = await jupiter.cotizar({ entrada: SOL, salida: USDC, cantidad: 1e9, slippageBps: 50 });
  ok(`Jupiter cotiza: 1 SOL = ${(Number(cot.outAmount) / 1e6).toFixed(2)} USDC`);
  if (!config.jupiterApiKey) aviso('Sin JUPITER_API_KEY vas por el nivel gratis, con pocas consultas por segundo. Con varias wallets seguidas te va a quedar corto.');
} catch (e) { mal(`Jupiter no responde: ${e.message}`); }

// 4. Billetera
if (!leerKeystore(config.rutaKeystore)) {
  aviso('No hay billetera creada: el bot solo podra simular. Usa: npm run wallet:nueva');
} else if (!config.passphrase) {
  aviso('Hay billetera pero falta WALLET_PASSPHRASE en el .env: el bot no podra abrirla sola.');
} else {
  try {
    const par = cargarBilletera(config);
    const saldo = await rpc.saldoSol(par.publicKey.toBase58());
    ok(`Billetera ${par.publicKey.toBase58()} con ${saldo.toFixed(4)} SOL`);
    if (saldo < 0.02) aviso('Con menos de 0.02 SOL no alcanza ni para comisiones.');
  } catch (e) { mal(e.message); }
}

console.log(fallos === 0 ? '\nTodo en orden.\n' : `\n${fallos} problema(s) que arreglar antes de arrancar.\n`);
process.exit(fallos === 0 ? 0 : 1);
