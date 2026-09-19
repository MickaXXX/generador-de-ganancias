// Arranque: arma las piezas, las conecta y las deja corriendo.
import { config } from './config.js';
import { log } from './log.js';
import { Almacen } from './store.js';
import { Rpc } from './solana/rpc.js';
import { Jupiter } from './solana/jupiter.js';
import { Vigilante } from './solana/watcher.js';
import { cargarBilletera, leerKeystore } from './solana/wallet.js';
import { Motor } from './core/engine.js';
import { crearBot } from './telegram/bot.js';

function exigir(valor, mensaje) {
  if (!valor) {
    console.error(`\n✖ ${mensaje}\n`);
    process.exit(1);
  }
}

async function principal() {
  exigir(config.telegramToken, 'Falta TELEGRAM_BOT_TOKEN en el archivo .env (te lo da @BotFather).');
  exigir(config.telegramOwnerId, 'Falta TELEGRAM_OWNER_ID en el archivo .env (te lo da @userinfobot).');

  const almacen = new Almacen(config.rutaDatos);
  const rpc = new Rpc(config.rpc);
  const jupiter = new Jupiter({
    base: config.jupiterBase,
    tokensBase: config.jupiterTokensBase,
    apiKey: config.jupiterApiKey,
    rpc,
  });

  // La billetera es opcional: sin ella el bot funciona igual, pero solo en simulacion.
  let par = null;
  if (leerKeystore(config.rutaKeystore)) {
    try {
      par = cargarBilletera(config);
      log.info(`Billetera cargada: ${par.publicKey.toBase58()}`);
    } catch (e) {
      console.error(`\n✖ ${e.message}\n`);
      process.exit(1);
    }
  } else {
    log.aviso('No hay billetera. El bot corre solo en simulacion. Crea una con: npm run wallet:nueva');
    almacen.fijarParametro('modo', 'simulacion');
  }
  if (!par && almacen.p.modo === 'real') almacen.fijarParametro('modo', 'simulacion');

  const buzon = { enviar: async (texto) => log.info(`(aviso sin Telegram) ${texto}`) };
  const motor = new Motor({ rpc, jupiter, almacen, par, avisar: (t) => buzon.enviar(t) });

  const estado = {};
  const bot = crearBot({
    token: config.telegramToken,
    ownerId: config.telegramOwnerId,
    almacen, motor, estado,
  });

  buzon.enviar = async (texto) => {
    try {
      await bot.api.sendMessage(config.telegramOwnerId, texto, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
    } catch (e) {
      log.error('No pude avisar por Telegram:', e.message);
    }
  };

  const vigilante = new Vigilante({
    rpc, almacen, pollMs: config.pollMs,
    alDetectar: (senal) => motor.procesarSenal(senal),
  });
  estado.vigilante = vigilante;

  // Revision periodica de take profit / stop loss / trailing.
  const reloj = setInterval(() => {
    motor.revisarSalidas().catch((e) => log.error('Revision de salidas fallida:', e));
  }, config.monitorMs);

  const apagar = (senal) => {
    log.info(`Apagando (${senal})…`);
    clearInterval(reloj);
    vigilante.detener();
    almacen.guardarYa();
    bot.stop().catch(() => {});
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error('Promesa sin capturar:', e));
  process.on('uncaughtException', (e) => log.error('Excepcion sin capturar:', e));

  vigilante.iniciar();
  log.info(`Vigilancia activa sobre ${almacen.lideresActivos().length} wallet(s).`);

  bot.start({
    onStart: async () => {
      log.info('Bot de Telegram en linea.');
      await buzon.enviar(
        `🤖 *Copiabot encendido*\n` +
        `Modo: ${almacen.p.modo === 'real' ? '🔴 REAL' : '🧪 simulacion'}\n` +
        `Siguiendo ${almacen.lideresActivos().length} wallet(s)\n` +
        `Escribe /ayuda para ver que puedo hacer.`
      );
    },
  });
}

principal().catch((e) => {
  log.error('El bot no pudo arrancar:', e);
  process.exit(1);
});
