// La interfaz. Solo responde al dueno: cualquier otro chat se ignora en silencio.
import { Bot, InlineKeyboard } from 'grammy';
import bs58 from 'bs58';
import { PARAMETROS, validarParametro } from '../config.js';
import { log } from '../log.js';

// Los simbolos vienen de la cadena y pueden traer caracteres que rompen el formato.
const limpiar = (t) => String(t ?? '').replace(/[_*`[\]()]/g, '');
const usd = (n) => (n == null ? '—' : `${n >= 0 ? '' : '-'}$${Math.abs(n).toFixed(2)}`);
const pct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

export function esDireccionSolana(texto) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(texto)) return false;
  try { return bs58.decode(texto).length === 32; } catch { return false; }
}

export function crearBot({ token, ownerId, almacen, motor, estado }) {
  const bot = new Bot(token);

  // Portero: un bot de trading abierto al publico es una billetera abierta al publico.
  bot.use(async (ctx, next) => {
    const id = String(ctx.from?.id ?? '');
    if (!ownerId || id !== String(ownerId)) {
      log.aviso(`Mensaje ignorado de un chat no autorizado (${id}).`);
      return;
    }
    await next();
  });

  bot.catch((err) => log.error('Error en Telegram:', err.error ?? err));

  const responder = (ctx, texto, extra = {}) =>
    ctx.reply(texto, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true }, ...extra });

  // ----------------------------------------------------------------- ayuda
  const AYUDA = [
    '*Copiabot* — copia compras y ventas de las wallets que tu elijas.',
    '',
    '*Wallets que sigo*',
    '`/seguir <direccion> [alias]` — empezar a copiar a alguien',
    '`/dejar <direccion|alias>` — dejar de copiarlo',
    '`/lideres` — a quienes sigo',
    '',
    '*Dinero*',
    '`/estado` — saldo, posiciones y resultado del dia',
    '`/posiciones` — lo que tengo abierto, con boton de venta',
    '`/vender <mint> [%]` — vender a mano (por defecto 100%)',
    '`/vendertodo` — cerrar todo',
    '`/comprar <mint> <usd>` — comprar a mano',
    '',
    '*Control*',
    '`/modo simulacion` o `/modo real`',
    '`/pausa` y `/reanudar`',
    '`/config` — ver todos los parametros',
    '`/set <parametro> <valor>` — cambiar uno',
    '`/wallet` — mi direccion para depositar',
    '`/historial` — ultimas operaciones',
  ].join('\n');

  bot.command(['start', 'ayuda', 'help'], (ctx) => responder(ctx, AYUDA));

  // ----------------------------------------------------------------- estado
  bot.command('estado', async (ctx) => {
    const p = almacen.p;
    const dia = almacen.hoy();
    const sol = await motor.saldoSol();
    const precio = await motor.jupiter.precioSolUsd().catch(() => 0);
    const posiciones = Object.values(almacen.datos.posiciones);
    const lideres = almacen.lideresActivos();

    const lineas = [
      `*Modo:* ${p.modo === 'real' ? '🔴 REAL (dinero de verdad)' : '🧪 simulacion'}${p.pausado ? ' · ⏸ en pausa' : ''}`,
      `*Billetera:* \`${motor.publica ?? 'sin billetera'}\``,
      `*Saldo:* ${sol.toFixed(4)} SOL${precio ? ` (${usd(sol * precio)})` : ''}`,
      `*Siguiendo:* ${lideres.length} wallet(s)`,
      `*Posiciones abiertas:* ${posiciones.length} / ${p.maxPosiciones}`,
      `*Hoy:* ${dia.compras} compras · resultado ${usd(dia.pnlUsd)}`,
      '',
      `*Por copia:* ${p.sizing === 'fijo' ? `${usd(p.compraUsd)} fijos`
        : p.sizing === 'proporcional' ? `${(p.proporcion * 100).toFixed(2)}% de lo que ponga el lider`
        : `${p.patrimonioPct}% de mi saldo`} (entre ${usd(p.compraMinUsd)} y ${usd(p.compraMaxUsd)})`,
      `*Salidas:* TP ${p.takeProfitPct}% · SL ${p.stopLossPct}% · trailing ${p.trailingActivaPct}%/${p.trailingCaidaPct}%`,
      estado.vigilante?.ultimoError ? `\n⚠️ Vigilancia: ${estado.vigilante.ultimoError}` : '',
    ];
    await responder(ctx, lineas.filter(Boolean).join('\n'));
  });

  // ---------------------------------------------------------------- lideres
  bot.command('seguir', async (ctx) => {
    const [direccion, ...resto] = (ctx.match || '').trim().split(/\s+/);
    if (!direccion) return responder(ctx, 'Uso: `/seguir <direccion> [alias]`');
    if (!esDireccionSolana(direccion)) {
      return responder(ctx, '❌ Eso no parece una direccion de Solana.\nSi tienes el usuario de fomo y no la direccion, resuelvela primero en FomoScan y pega aqui la direccion completa.');
    }
    if (direccion === motor.publica) return responder(ctx, '❌ Esa es tu propia billetera.');
    const l = almacen.agregarLider(direccion, resto.join(' ') || null);
    await responder(ctx, `✅ Siguiendo a *${limpiar(l.alias)}*\n\`${direccion}\`\n\nCopiare lo que haga *desde ahora*. Lo anterior no se toca.`);
  });

  bot.command('dejar', async (ctx) => {
    const clave = (ctx.match || '').trim();
    if (!clave) return responder(ctx, 'Uso: `/dejar <direccion|alias>`');
    const quitado = almacen.quitarLider(clave);
    await responder(ctx, quitado ? `✅ Ya no sigo a \`${quitado}\`` : '❌ No encontre esa wallet en la lista.');
  });

  bot.command('lideres', async (ctx) => {
    const lista = almacen.lideresActivos();
    if (!lista.length) return responder(ctx, 'No sigues a nadie todavia. Usa `/seguir <direccion>`.');
    const texto = lista.map((l) => {
      const abiertas = Object.keys(l.posiciones ?? {}).length;
      return `• *${limpiar(l.alias)}*\n  \`${l.direccion}\`\n  le veo ${abiertas} token(s) en mano`;
    }).join('\n');
    await responder(ctx, texto);
  });

  // ------------------------------------------------------------- posiciones
  function tecladoPosiciones(posiciones) {
    const t = new InlineKeyboard();
    for (const p of posiciones) {
      t.text(`Vender 50% ${limpiar(p.simbolo)}`, `v:50:${p.mint}`)
       .text(`Vender 100% ${limpiar(p.simbolo)}`, `v:100:${p.mint}`).row();
    }
    return t;
  }

  bot.command('posiciones', async (ctx) => {
    const espera = await ctx.reply('Consultando precios…');
    const posiciones = await motor.posicionesConValor();
    await ctx.api.deleteMessage(espera.chat.id, espera.message_id).catch(() => {});
    if (!posiciones.length) return responder(ctx, 'No tienes posiciones abiertas.');

    const total = posiciones.reduce((a, p) => a + (p.valorUsd ?? 0), 0);
    const costo = posiciones.reduce((a, p) => a + p.costoUsd, 0);
    const texto = posiciones.map((p) => (
      `*${limpiar(p.simbolo)}* ${p.simulada ? '🧪' : ''}\n` +
      `  costo ${usd(p.costoUsd)} · ahora ${usd(p.valorUsd)} · ${pct(p.pnlPct)}\n` +
      `  copiado de ${limpiar(p.lider)}\n  \`${p.mint}\``
    )).join('\n\n');
    await responder(ctx, `${texto}\n\n*Total:* ${usd(total)} sobre ${usd(costo)} (${pct(costo ? ((total - costo) / costo) * 100 : null)})`,
      { reply_markup: tecladoPosiciones(posiciones) });
  });

  bot.callbackQuery(/^v:(\d+):(.+)$/, async (ctx) => {
    const [, porcentaje, mint] = ctx.match;
    await ctx.answerCallbackQuery({ text: `Vendiendo ${porcentaje}%…` });
    const r = await motor.enFila(() => motor.vender({ mint, fraccion: Number(porcentaje) / 100, razon: 'venta manual desde Telegram' }));
    if (r && !r.ok) await responder(ctx, `❌ ${r.error}`);
  });

  bot.command('vender', async (ctx) => {
    const [mint, porcentaje] = (ctx.match || '').trim().split(/\s+/);
    if (!mint) return responder(ctx, 'Uso: `/vender <mint> [porcentaje]`');
    const objetivo = almacen.datos.posiciones[mint]
      ? mint
      : Object.values(almacen.datos.posiciones).find((p) => p.simbolo?.toLowerCase() === mint.toLowerCase())?.mint;
    if (!objetivo) return responder(ctx, '❌ No tengo posicion abierta en ese token.');
    const fraccion = porcentaje ? Math.min(Math.max(Number(porcentaje) / 100, 0), 1) : 1;
    const r = await motor.enFila(() => motor.vender({ mint: objetivo, fraccion, razon: 'venta manual desde Telegram' }));
    if (r && !r.ok) await responder(ctx, `❌ ${r.error}`);
  });

  bot.command('vendertodo', async (ctx) => {
    const mints = Object.keys(almacen.datos.posiciones);
    if (!mints.length) return responder(ctx, 'No hay nada que vender.');
    await responder(ctx, `Cerrando ${mints.length} posicion(es)…`);
    for (const mint of mints) {
      await motor.enFila(() => motor.vender({ mint, fraccion: 1, razon: 'cierre total pedido por Telegram' }));
    }
  });

  bot.command('comprar', async (ctx) => {
    const [mint, montoTexto] = (ctx.match || '').trim().split(/\s+/);
    if (!mint || !montoTexto) return responder(ctx, 'Uso: `/comprar <mint> <usd>`');
    if (!esDireccionSolana(mint)) return responder(ctx, '❌ Ese mint no es valido.');
    const monto = Number(montoTexto);
    if (!Number.isFinite(monto) || monto <= 0) return responder(ctx, '❌ Monto invalido.');
    await responder(ctx, `Comprando ${usd(monto)} de \`${mint.slice(0, 8)}…\``);
    await motor.enFila(() => motor.comprar({ mint, usd: monto, lider: 'manual' }));
  });

  // ---------------------------------------------------------------- control
  bot.command('modo', async (ctx) => {
    const valor = (ctx.match || '').trim().toLowerCase();
    if (!['simulacion', 'real'].includes(valor)) {
      return responder(ctx, `Modo actual: *${almacen.p.modo}*\nUso: \`/modo simulacion\` o \`/modo real\``);
    }
    if (valor === 'real') {
      if (!motor.par) return responder(ctx, '❌ No hay billetera cargada. Crea una con `npm run wallet:nueva` y reinicia.');
      const sol = await motor.saldoSol();
      if (sol <= almacen.p.reservaSol) {
        return responder(ctx, `❌ La billetera tiene ${sol.toFixed(4)} SOL. Deposita antes de pasar a real.\n\`${motor.publica}\``);
      }
    }
    almacen.fijarParametro('modo', valor);
    await responder(ctx, valor === 'real'
      ? '🔴 *Modo REAL.* Desde ahora cada copia gasta dinero de verdad.'
      : '🧪 *Modo simulacion.* No se gasta nada.');
  });

  bot.command('pausa', async (ctx) => {
    almacen.fijarParametro('pausado', true);
    await responder(ctx, '⏸ En pausa. No abro posiciones nuevas; las salidas automaticas siguen activas.');
  });

  bot.command('reanudar', async (ctx) => {
    almacen.fijarParametro('pausado', false);
    await responder(ctx, '▶️ Reanudado.');
  });

  bot.command('config', async (ctx) => {
    const p = almacen.p;
    const texto = Object.entries(PARAMETROS)
      .map(([clave, def]) => `\`${clave}\` = *${p[clave]}*\n  ${def.desc}`)
      .join('\n');
    await responder(ctx, `${texto}\n\nCambia uno con: \`/set takeProfitPct 80\``);
  });

  bot.command('set', async (ctx) => {
    const [clave, ...resto] = (ctx.match || '').trim().split(/\s+/);
    const crudo = resto.join(' ');
    if (!clave || !crudo) return responder(ctx, 'Uso: `/set <parametro> <valor>`\nVer `/config`.');
    const r = validarParametro(clave, crudo);
    if (!r.ok) return responder(ctx, `❌ ${r.error}`);
    if (clave === 'modo' && r.valor === 'real' && !motor.par) {
      return responder(ctx, '❌ No hay billetera cargada; no puedo pasar a real.');
    }
    almacen.fijarParametro(clave, r.valor);
    await responder(ctx, `✅ \`${clave}\` = *${r.valor}*`);
  });

  bot.command('wallet', async (ctx) => {
    if (!motor.publica) return responder(ctx, 'No hay billetera cargada. Crea una con `npm run wallet:nueva`.');
    const sol = await motor.saldoSol();
    await responder(ctx,
      `*Tu billetera del bot*\n\`${motor.publica}\`\n\nSaldo: ${sol.toFixed(4)} SOL\n\n` +
      'Deposita aqui solo lo que estes dispuesto a perder. ' +
      'La clave privada nunca se manda por Telegram.');
  });

  bot.command('historial', async (ctx) => {
    const eventos = almacen.datos.historial.slice(0, 15);
    if (!eventos.length) return responder(ctx, 'Todavia no hay operaciones.');
    const texto = eventos.map((e) => {
      const hora = new Date(e.ts).toLocaleString('es');
      const icono = { compra: '🟢', venta: '🔴', 'compra-fallida': '⚠️', 'venta-fallida': '❗️', cierre: '⚪️' }[e.tipo] ?? '·';
      const resultado = e.pnlUsd != null ? ` (${usd(e.pnlUsd)})` : '';
      return `${icono} ${hora} · ${limpiar(e.simbolo ?? e.mint?.slice(0, 6))} · ${usd(e.usd)}${resultado}`;
    }).join('\n');
    await responder(ctx, texto);
  });

  bot.on('message:text', (ctx) => {
    if (!ctx.message.text.startsWith('/')) return responder(ctx, 'No entendi. Escribe /ayuda.');
  });

  return bot;
}
