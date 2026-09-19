import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarSwaps, deltasDelDueno, valorBaseUsd } from '../src/solana/swapdetect.js';
import { SOL, USDC } from '../src/config.js';

const LIDER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const OTRO = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TOKEN = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function tx({ pre = [2_000_000_000], post = [2_000_000_000], preT = [], postT = [], fee = 5000, err = null, claves = [LIDER] } = {}) {
  return {
    blockTime: Math.floor(Date.now() / 1000),
    transaction: { signatures: ['firma1'], message: { accountKeys: claves.map((pubkey) => ({ pubkey })) } },
    meta: { err, fee, preBalances: pre, postBalances: post, preTokenBalances: preT, postTokenBalances: postT },
  };
}

const saldo = (mint, owner, cantidad, decimales = 6) => ({
  accountIndex: 3, mint, owner,
  uiTokenAmount: { amount: String(Math.round(cantidad * 10 ** decimales)), decimals: decimales, uiAmountString: String(cantidad) },
});

test('una compra con SOL se detecta como compra', () => {
  const senales = detectarSwaps(tx({
    pre: [2_000_000_000], post: [1_000_000_000],
    postT: [saldo(TOKEN, LIDER, 1500)],
  }), LIDER);

  assert.equal(senales.length, 1);
  assert.equal(senales[0].tipo, 'compra');
  assert.equal(senales[0].mint, TOKEN);
  assert.equal(senales[0].cantidad, 1500);
  assert.equal(senales[0].base.mint, SOL);
  // 1 SOL gastado, devolviendole la comision que pago como firmante.
  assert.ok(Math.abs(senales[0].base.cantidad - 0.999995) < 1e-9);
});

test('una venta a SOL se detecta como venta', () => {
  const senales = detectarSwaps(tx({
    pre: [1_000_000_000], post: [1_500_000_000],
    preT: [saldo(TOKEN, LIDER, 1500)],
    postT: [saldo(TOKEN, LIDER, 0)],
  }), LIDER);

  assert.equal(senales.length, 1);
  assert.equal(senales[0].tipo, 'venta');
  assert.equal(senales[0].cantidad, 1500);
  assert.equal(senales[0].base.mint, SOL);
});

test('una venta parcial informa solo lo vendido', () => {
  const senales = detectarSwaps(tx({
    pre: [1_000_000_000], post: [1_200_000_000],
    preT: [saldo(TOKEN, LIDER, 1000)],
    postT: [saldo(TOKEN, LIDER, 400)],
  }), LIDER);
  assert.equal(senales[0].tipo, 'venta');
  assert.equal(senales[0].cantidad, 600);
});

test('una transferencia simple no es un swap', () => {
  const senales = detectarSwaps(tx({
    preT: [saldo(TOKEN, LIDER, 100)],
    postT: [saldo(TOKEN, LIDER, 0)],
  }), LIDER);
  assert.deepEqual(senales, []);
});

test('una transaccion fallida se ignora', () => {
  const senales = detectarSwaps(tx({
    pre: [2_000_000_000], post: [1_000_000_000],
    postT: [saldo(TOKEN, LIDER, 1500)],
    err: { InstructionError: [2, 'Custom'] },
  }), LIDER);
  assert.deepEqual(senales, []);
});

test('los movimientos de otra wallet en la misma transaccion no cuentan', () => {
  const senales = detectarSwaps(tx({
    claves: [OTRO, LIDER],
    pre: [2_000_000_000, 1_000_000_000], post: [1_000_000_000, 1_000_000_000],
    postT: [saldo(TOKEN, OTRO, 1500)],
  }), LIDER);
  assert.deepEqual(senales, []);
});

test('el SOL envuelto se suma al SOL nativo en vez de contarse aparte', () => {
  const deltas = deltasDelDueno(tx({
    pre: [2_000_000_000], post: [1_000_000_000],
    preT: [saldo(SOL, LIDER, 0, 9)],
    postT: [saldo(SOL, LIDER, 0.5, 9)],
  }), LIDER);
  assert.equal(deltas.size, 1);
  assert.ok(Math.abs(deltas.get(SOL).delta - (-0.499995)) < 1e-9);
});

test('una compra pagada en USDC se mide en dolares directamente', () => {
  const senales = detectarSwaps(tx({
    preT: [saldo(USDC, LIDER, 1000)],
    postT: [saldo(USDC, LIDER, 0), saldo(TOKEN, LIDER, 42)],
  }), LIDER);
  const compra = senales.find((s) => s.tipo === 'compra');
  assert.equal(compra.base.mint, USDC);
  assert.equal(valorBaseUsd(compra.base, 200), 1000);
});

test('un swap de token a token deja una venta y una compra', () => {
  const OTRO_TOKEN = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
  const senales = detectarSwaps(tx({
    preT: [saldo(TOKEN, LIDER, 100)],
    postT: [saldo(TOKEN, LIDER, 0), saldo(OTRO_TOKEN, LIDER, 77)],
  }), LIDER);
  assert.equal(senales.length, 2);
  assert.equal(senales.find((s) => s.tipo === 'compra').mint, OTRO_TOKEN);
  assert.equal(senales.find((s) => s.tipo === 'venta').mint, TOKEN);
  // Sin pata base no se puede saber cuanto valia en dolares.
  assert.equal(valorBaseUsd(senales[0].base, 200), null);
});

test('un cambio de SOL a USDC no genera senales de token', () => {
  const senales = detectarSwaps(tx({
    pre: [2_000_000_000], post: [1_000_000_000],
    postT: [saldo(USDC, LIDER, 200)],
  }), LIDER);
  assert.deepEqual(senales, []);
});

test('la renta devuelta al cerrar una cuenta no se confunde con una venta', () => {
  // Transferir todo un token y cerrar la cuenta devuelve ~0.00204 SOL de renta.
  const senales = detectarSwaps(tx({
    pre: [1_000_000_000], post: [1_002_039_280],
    preT: [saldo(TOKEN, LIDER, 100)],
    postT: [saldo(TOKEN, LIDER, 0)],
  }), LIDER);
  assert.deepEqual(senales, []);
});

test('una compra chica de verdad si se detecta', () => {
  // 0.02 SOL, muy por encima del ruido de comisiones y renta.
  const senales = detectarSwaps(tx({
    pre: [1_000_000_000], post: [980_000_000],
    postT: [saldo(TOKEN, LIDER, 5000)],
  }), LIDER);
  assert.equal(senales.length, 1);
  assert.equal(senales[0].tipo, 'compra');
  assert.ok(Math.abs(senales[0].base.cantidad - 0.019995) < 1e-9);
});
