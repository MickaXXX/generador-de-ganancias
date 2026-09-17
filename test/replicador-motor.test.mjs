import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodificar, MINT_SOL } from '../replicador/motor/decodificador.mjs';
import { decidir, CONFIG_POR_DEFECTO } from '../replicador/motor/politica.mjs';
import { Cartera } from '../replicador/motor/cartera.mjs';

const TRADER = 'Trader1111111111111111111111111111111111111';
const TOKEN = 'Token11111111111111111111111111111111111111';
const L = 1e9;

/** Arma una transaccion con la forma que devuelve getTransaction. */
function tx({ solPre, solPost, tokPre = null, tokPost = null, fee = 5000, err = null, mint = TOKEN, duenio = TRADER }) {
  const bal = (c) => ({
    accountIndex: 3, mint, owner: duenio,
    uiTokenAmount: { amount: String(Math.round(c * 1e6)), decimals: 6, uiAmount: c, uiAmountString: String(c) },
  });
  return {
    blockTime: 1_700_000_000,
    transaction: { signatures: ['sig'], message: { accountKeys: [TRADER, 'otra', MINT_SOL, mint] } },
    meta: {
      err, fee,
      preBalances: [Math.round(solPre * L), 0, 0, 0],
      postBalances: [Math.round(solPost * L), 0, 0, 0],
      preTokenBalances: tokPre == null ? [] : [bal(tokPre)],
      postTokenBalances: tokPost == null ? [] : [bal(tokPost)],
    },
  };
}

// ---------------------------------------------------------------- decodificador

test('detecta una compra y calcula la fraccion del saldo gastada', () => {
  // Tenia 10 SOL, gasto 2 y recibio 1000 tokens.
  const d = decodificar(tx({ solPre: 10, solPost: 8 - 5000 / L, tokPost: 1000 }), TRADER);
  assert.equal(d.lado, 'compra');
  assert.equal(d.mint, TOKEN);
  assert.ok(Math.abs(d.solTrader - 2) < 1e-6, `solTrader=${d.solTrader}`);
  assert.ok(Math.abs(d.fraccion - 0.2) < 1e-6, `fraccion=${d.fraccion}`);
  assert.equal(d.base, 'sol-disponible');
});

test('detecta una venta y calcula la fraccion de la posicion vendida', () => {
  // Tenia 1000 tokens, vendio 750 y recibio 3 SOL.
  const d = decodificar(tx({ solPre: 5, solPost: 8 - 5000 / L, tokPre: 1000, tokPost: 250 }), TRADER);
  assert.equal(d.lado, 'venta');
  assert.ok(Math.abs(d.solTrader - 3) < 1e-6);
  assert.ok(Math.abs(d.tokensTrader - 750) < 1e-6);
  assert.ok(Math.abs(d.fraccion - 0.75) < 1e-9, `fraccion=${d.fraccion}`);
  assert.equal(d.base, 'posicion');
});

test('la comision no se confunde con el tamanio de la operacion', () => {
  const fee = 45_000;
  const d = decodificar(tx({ solPre: 10, solPost: 8 - fee / L, tokPost: 1000, fee }), TRADER);
  assert.ok(Math.abs(d.solTrader - 2) < 1e-9, `un fee de ${fee} lamports se colo en el tamanio: ${d.solTrader}`);
});

test('ignora una transferencia simple, sin token de por medio', () => {
  assert.equal(decodificar(tx({ solPre: 10, solPost: 9.5 }), TRADER), null);
});

test('ignora transacciones fallidas', () => {
  assert.equal(decodificar(tx({ solPre: 10, solPost: 8, tokPost: 1000, err: { InstructionError: [0, 'X'] } }), TRADER), null);
});

test('ignora la actividad de una wallet que no es la vigilada', () => {
  assert.equal(decodificar(tx({ solPre: 10, solPost: 8, tokPost: 1000 }), 'OtraWallet111111111111111111111111111111111'), null);
});

test('trata WSOL como SOL y no como una posicion mas', () => {
  // Envolver SOL mueve saldo entre SOL nativo y WSOL: no es un swap.
  const t = tx({ solPre: 10, solPost: 8 - 5000 / L });
  const wsol = (c) => ({
    accountIndex: 2, mint: MINT_SOL, owner: TRADER,
    uiTokenAmount: { amount: String(c * L), decimals: 9, uiAmount: c, uiAmountString: String(c) },
  });
  t.meta.preTokenBalances = [wsol(0)];
  t.meta.postTokenBalances = [wsol(2)];
  assert.equal(decodificar(t, TRADER), null, 'envolver SOL se copio como si fuera una compra');
});

// --------------------------------------------------------------------- politica

const tokenSano = { liquidezUsd: 200_000, edadMinutos: 600, mintAuthority: null, freezeAuthority: null };
const compra = (f = 0.2) => ({ lado: 'compra', mint: TOKEN, fraccion: f });
const nueva = () => new Cartera({ presupuestoSol: 1 });

test('rechaza un token cuyo creador puede imprimir mas unidades', () => {
  const r = decidir({ intencion: compra(), cartera: nueva(), config: {}, infoToken: { ...tokenSano, mintAuthority: 'X' } });
  assert.equal(r.accion, 'omitir');
  assert.match(r.motivo, /imprimir/);
});

test('rechaza un token que puede congelar la billetera', () => {
  const r = decidir({ intencion: compra(), cartera: nueva(), config: {}, infoToken: { ...tokenSano, freezeAuthority: 'X' } });
  assert.equal(r.accion, 'omitir');
  assert.match(r.motivo, /congelar/);
});

test('rechaza pools sin liquidez y pools recien creados', () => {
  assert.match(decidir({ intencion: compra(), cartera: nueva(), config: {}, infoToken: { ...tokenSano, liquidezUsd: 500 } }).motivo, /liquidez/);
  assert.match(decidir({ intencion: compra(), cartera: nueva(), config: {}, infoToken: { ...tokenSano, edadMinutos: 2 } }).motivo, /nuevo/);
});

test('nunca compra a ciegas cuando no hay datos del token', () => {
  assert.equal(decidir({ intencion: compra(), cartera: nueva(), config: {}, infoToken: null }).accion, 'omitir');
});

test('respeta el tope de exposicion por token', () => {
  const c = nueva(); // presupuesto 1 SOL, tope por token 25%
  const r = decidir({ intencion: compra(0.9), cartera: c, config: {}, infoToken: tokenSano });
  assert.equal(r.accion, 'ejecutar');
  assert.ok(Math.abs(r.montoSol - 0.25) < 1e-9, `montoSol=${r.montoSol}, deberia toparse en 0.25`);
});

test('el tope por token cuenta lo que ya esta invertido ahi', () => {
  const c = nueva();
  c.aplicarCompra({ mint: TOKEN, solGastado: 0.25, tokens: 100 });
  const r = decidir({ intencion: compra(0.5), cartera: c, config: {}, infoToken: tokenSano });
  assert.equal(r.accion, 'omitir');
  assert.match(r.motivo, /tope de exposicion/);
});

test('rechaza ordenes tan chicas que los fees se las comen', () => {
  const r = decidir({ intencion: compra(0.001), cartera: nueva(), config: { minOrdenSol: 0.02 }, infoToken: tokenSano });
  assert.equal(r.accion, 'omitir');
  assert.match(r.motivo, /minimo/);
});

test('con el maximo de posiciones abiertas no abre una nueva pero si refuerza una existente', () => {
  const c = new Cartera({ presupuestoSol: 10 });
  for (let i = 0; i < CONFIG_POR_DEFECTO.maxPosiciones; i++) {
    c.aplicarCompra({ mint: `M${i}`, solGastado: 0.1, tokens: 10 });
  }
  assert.equal(decidir({ intencion: compra(0.1), cartera: c, config: {}, infoToken: tokenSano }).accion, 'omitir');
  const refuerzo = decidir({ intencion: { lado: 'compra', mint: 'M0', fraccion: 0.1 }, cartera: c, config: {}, infoToken: tokenSano });
  assert.equal(refuerzo.accion, 'ejecutar');
});

test('no intenta vender un token que no tengo', () => {
  const r = decidir({ intencion: { lado: 'venta', mint: TOKEN, fraccion: 0.5 }, cartera: nueva(), config: {}, infoToken: tokenSano });
  assert.equal(r.accion, 'omitir');
});

test('una venta casi total se convierte en venta total para no dejar polvo', () => {
  const c = nueva();
  c.aplicarCompra({ mint: TOKEN, solGastado: 0.1, tokens: 1000 });
  const r = decidir({ intencion: { lado: 'venta', mint: TOKEN, fraccion: 0.97 }, cartera: c, config: {}, infoToken: tokenSano });
  assert.equal(r.tokens, 1000, 'deberia haber vendido la posicion completa');
});

// ---------------------------------------------------------------------- cartera

test('una venta parcial libera costo en proporcion y realiza la ganancia correcta', () => {
  const c = nueva();
  c.aplicarCompra({ mint: TOKEN, solGastado: 1, tokens: 1000 });
  const ganancia = c.aplicarVenta({ mint: TOKEN, tokens: 500, solRecibido: 0.8 });
  assert.ok(Math.abs(ganancia - 0.3) < 1e-9, `ganancia=${ganancia}`);   // 0.8 recibido - 0.5 de costo
  assert.ok(Math.abs(c.posicion(TOKEN).costoSol - 0.5) < 1e-9);
  assert.ok(Math.abs(c.posicion(TOKEN).tokens - 500) < 1e-9);
});

test('vender la posicion completa la elimina del mapa', () => {
  const c = nueva();
  c.aplicarCompra({ mint: TOKEN, solGastado: 1, tokens: 1000 });
  c.aplicarVenta({ mint: TOKEN, tokens: 1000, solRecibido: 1.5 });
  assert.equal(c.posicion(TOKEN), null);
  assert.equal(c.abiertas, 0);
});

test('el drawdown se mide contra el pico historico', () => {
  const c = new Cartera({ presupuestoSol: 1 });
  c.aplicarCompra({ mint: TOKEN, solGastado: 0.5, tokens: 1000 });
  c.drawdown(new Map([[TOKEN, 0.002]]));                 // valor 0.5 + 2.0 = 2.5, nuevo pico
  const dd = c.drawdown(new Map([[TOKEN, 0.001]]));      // valor 0.5 + 1.0 = 1.5
  assert.ok(Math.abs(dd - 0.4) < 1e-9, `drawdown=${dd}`);
});
