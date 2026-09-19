// Prueba del recorrido completo sin tocar la red: senal del lider -> decision ->
// posicion -> venta proporcional. Es la prueba que responde la pregunta del negocio:
// "si el compra 1000, yo compro 4; si el vende, yo vendo lo mio".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Almacen } from '../src/store.js';
import { Motor } from '../src/core/engine.js';
import { SOL } from '../src/config.js';

const carpeta = mkdtempSync(join(tmpdir(), 'copiabot-motor-'));
process.on('exit', () => rmSync(carpeta, { recursive: true, force: true }));

const LIDER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const TOKEN = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PRECIO_SOL = 200;

// Un mercado de mentira: 1 token = 0.001 USD, sin impacto de precio.
function jupiterFalso({ hayRutaDeVenta = true, precioTokenUsd = 0.001 } = {}) {
  return {
    async precioSolUsd() { return PRECIO_SOL; },
    async simboloDe() { return 'FAKE'; },
    async cotizar({ entrada, cantidad }) {
      if (entrada === SOL) {
        const usd = (Number(cantidad) / 1e9) * PRECIO_SOL;
        return { outAmount: String(Math.round((usd / precioTokenUsd) * 1e6)), priceImpactPct: '0.01' };
      }
      const usd = (Number(cantidad) / 1e6) * precioTokenUsd;
      return { outAmount: String(Math.round((usd / PRECIO_SOL) * 1e9)), priceImpactPct: '0.01' };
    },
    async cotizarSuave(args) {
      if (args.entrada !== SOL && !hayRutaDeVenta) return null;
      return this.cotizar(args);
    },
    async valorUsd({ cantidadCruda }) { return (Number(cantidadCruda) / 1e6) * precioTokenUsd; },
  };
}

const rpcFalso = { async decimalesDe() { return 6; }, async tokensDe() { return []; }, async saldoSol() { return 0; } };

function armar(parametros = {}, jupiter = jupiterFalso()) {
  const almacen = new Almacen(join(carpeta, `${Math.random().toString(36).slice(2)}.json`));
  Object.assign(almacen.datos.parametros, { modo: 'simulacion', cooldownMintMin: 0, ...parametros });
  almacen.agregarLider(LIDER, 'ballena');
  const avisos = [];
  const motor = new Motor({ rpc: rpcFalso, jupiter, almacen, par: null, avisar: async (t) => avisos.push(t) });
  return { almacen, motor, avisos };
}

const compraDe = (cantidad, solGastado) => ({
  tipo: 'compra', lider: LIDER, alias: 'ballena', mint: TOKEN, cantidad, decimales: 6,
  base: { mint: SOL, cantidad: solGastado }, firma: 'f1', tiempo: Date.now(),
});
const ventaDe = (cantidad) => ({
  tipo: 'venta', lider: LIDER, alias: 'ballena', mint: TOKEN, cantidad, decimales: 6,
  base: { mint: SOL, cantidad: 1 }, firma: 'f2', tiempo: Date.now(),
});

test('si el lider pone 1000 dolares y la proporcion es 0.4%, yo pongo 4', async () => {
  const { almacen, motor } = armar({ sizing: 'proporcional', proporcion: 0.004 });
  // 5 SOL a 200 USD = 1000 USD.
  await motor.procesarSenal(compraDe(1_000_000, 5));

  const posicion = almacen.datos.posiciones[TOKEN];
  assert.ok(posicion, 'deberia haberse abierto la posicion');
  assert.equal(posicion.costoUsd, 4);
  assert.equal(posicion.simulada, true);
  // 4 USD a 0.001 por token = 4000 tokens.
  assert.equal(Number(posicion.cruda) / 1e6, 4000);
});

test('en modo fijo el tamano no depende de lo que mueva el lider', async () => {
  const { almacen, motor } = armar({ sizing: 'fijo', compraUsd: 4 });
  await motor.procesarSenal(compraDe(1_000_000, 50)); // el lider puso 10.000 USD
  assert.equal(almacen.datos.posiciones[TOKEN].costoUsd, 4);
});

test('cuando el lider vende el 40% de lo suyo, yo vendo el 40% de lo mio', async () => {
  const { almacen, motor } = armar({ sizing: 'proporcional', proporcion: 0.004 });
  await motor.procesarSenal(compraDe(1_000_000, 5));
  const antes = Number(almacen.datos.posiciones[TOKEN].cruda);

  await motor.procesarSenal(ventaDe(400_000)); // 400k de los 1M que tenia
  const despues = Number(almacen.datos.posiciones[TOKEN].cruda);

  assert.ok(Math.abs(despues / antes - 0.6) < 0.001, `quedo ${despues / antes} en vez de 0.6`);
  assert.ok(Math.abs(almacen.datos.posiciones[TOKEN].costoUsd - 2.4) < 0.01);
});

test('cuando el lider vende todo, mi posicion se cierra', async () => {
  const { almacen, motor } = armar();
  await motor.procesarSenal(compraDe(1_000_000, 5));
  await motor.procesarSenal(ventaDe(1_000_000));
  assert.equal(almacen.datos.posiciones[TOKEN], undefined);
  assert.equal(almacen.datos.historial[0].tipo, 'venta');
});

test('no copio la venta de un token que no tengo', async () => {
  const { almacen, motor } = armar();
  await motor.procesarSenal(ventaDe(1_000_000));
  assert.equal(almacen.datos.historial.length, 0);
});

test('un token del que no se puede salir no se compra', async () => {
  const { almacen, motor, avisos } = armar({}, jupiterFalso({ hayRutaDeVenta: false }));
  await motor.procesarSenal(compraDe(1_000_000, 5));
  assert.equal(almacen.datos.posiciones[TOKEN], undefined);
  assert.match(avisos.join(' '), /honeypot/);
});

test('en pausa no se abren posiciones nuevas', async () => {
  const { almacen, motor } = armar({ pausado: true });
  await motor.procesarSenal(compraDe(1_000_000, 5));
  assert.equal(almacen.datos.posiciones[TOKEN], undefined);
});

test('el tope de posiciones abiertas se respeta', async () => {
  const { almacen, motor } = armar({ maxPosiciones: 1 });
  await motor.procesarSenal(compraDe(1_000_000, 5));
  await motor.procesarSenal({ ...compraDe(1_000_000, 5), mint: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' });
  assert.equal(Object.keys(almacen.datos.posiciones).length, 1);
});

test('el stop loss cierra la posicion sola cuando el precio se derrumba', async () => {
  const jupiter = jupiterFalso();
  const { almacen, motor } = armar({ stopLossPct: 35, takeProfitPct: 0, trailingActivaPct: 0 }, jupiter);
  await motor.procesarSenal(compraDe(1_000_000, 5));
  assert.ok(almacen.datos.posiciones[TOKEN]);

  // El token cae a la mitad.
  jupiter.valorUsd = async ({ cantidadCruda }) => (Number(cantidadCruda) / 1e6) * 0.0005;
  jupiter.cotizar = async () => ({ outAmount: '1', priceImpactPct: '0.01' });
  await motor.revisarSalidas();

  assert.equal(almacen.datos.posiciones[TOKEN], undefined);
  assert.match(almacen.datos.historial[0].razon, /stop loss/);
});

test('las senales no se pisan entre si: se atienden de a una', async () => {
  const { almacen, motor } = armar({ sizing: 'fijo', compraUsd: 4, maxPosiciones: 2, promediar: false });
  // Dos senales del mismo token a la vez: la segunda debe encontrar la posicion ya abierta.
  await Promise.all([
    motor.procesarSenal(compraDe(1_000_000, 5)),
    motor.procesarSenal(compraDe(1_000_000, 5)),
  ]);
  assert.equal(Object.keys(almacen.datos.posiciones).length, 1);
  assert.equal(almacen.datos.posiciones[TOKEN].costoUsd, 4);
});
