import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularTamanoUsd, fraccionVenta, filtrarCompra, evaluarSalida } from '../src/core/reglas.js';

const base = {
  sizing: 'fijo', compraUsd: 4, proporcion: 0.004, patrimonioPct: 2,
  compraMinUsd: 1, compraMaxUsd: 25,
  maxPosiciones: 8, maxComprasDia: 25, perdidaDiaMaxUsd: 25,
  cooldownMintMin: 30, promediar: false, impactoMaxPct: 8, pausado: false,
  takeProfitPct: 60, stopLossPct: 35, trailingActivaPct: 40, trailingCaidaPct: 15,
};
const estadoLimpio = {
  posicionesAbiertas: 0, comprasHoy: 0, pnlHoyUsd: 0, yaTengoEsteToken: false,
  minutosDesdeUltimaCompra: null, impactoPct: 1, hayRutaDeVenta: true, listaNegra: false,
};

test('modo fijo pone siempre lo mismo, mire lo que mire el lider', () => {
  const p = { ...base, sizing: 'fijo' };
  assert.equal(calcularTamanoUsd({ p, montoLiderUsd: 1000, saldoUsd: 500 }).usd, 4);
  assert.equal(calcularTamanoUsd({ p, montoLiderUsd: 20, saldoUsd: 500 }).usd, 4);
});

test('modo proporcional: si el lider pone 1000 y la proporcion es 0.004, pongo 4', () => {
  const p = { ...base, sizing: 'proporcional' };
  assert.equal(calcularTamanoUsd({ p, montoLiderUsd: 1000, saldoUsd: 500 }).usd, 4);
});

test('el techo y el piso acotan el modo proporcional', () => {
  const p = { ...base, sizing: 'proporcional' };
  // Un lider que mueve 100k no me arrastra a poner 400.
  assert.equal(calcularTamanoUsd({ p, montoLiderUsd: 100000, saldoUsd: 5000 }).usd, 25);
  // Y uno que mueve 50 no me hace poner 20 centavos.
  assert.equal(calcularTamanoUsd({ p, montoLiderUsd: 50, saldoUsd: 500 }).usd, 1);
});

test('sin monto del lider, el modo proporcional cae al monto fijo', () => {
  const p = { ...base, sizing: 'proporcional' };
  assert.equal(calcularTamanoUsd({ p, montoLiderUsd: null, saldoUsd: 500 }).usd, 4);
});

test('modo patrimonio usa un porcentaje de mi saldo', () => {
  const p = { ...base, sizing: 'patrimonio', patrimonioPct: 2, compraMaxUsd: 100 };
  assert.equal(calcularTamanoUsd({ p, montoLiderUsd: 1000, saldoUsd: 1000 }).usd, 20);
});

test('sin saldo no se compra', () => {
  const r = calcularTamanoUsd({ p: base, montoLiderUsd: 1000, saldoUsd: 2 });
  assert.equal(r.usd, 0);
  assert.match(r.razon, /saldo insuficiente/);
});

test('la fraccion de venta copia el gesto del lider, no el monto', () => {
  // Vendio 400 de los 1000 que tenia: yo suelto el 40% de lo mio, valga lo que valga.
  assert.equal(fraccionVenta({ cantidadVendida: 400, cantidadPreviaLider: 1000 }).fraccion, 0.4);
});

test('una venta casi total cuenta como venta total', () => {
  assert.equal(fraccionVenta({ cantidadVendida: 999, cantidadPreviaLider: 1000 }).fraccion, 1);
});

test('si no vi la compra del lider, uso la fraccion por defecto y lo marco', () => {
  const r = fraccionVenta({ cantidadVendida: 400, cantidadPreviaLider: 0, porDefecto: 1 });
  assert.equal(r.fraccion, 1);
  assert.equal(r.estimada, true);
});

test('los filtros frenan la compra cuando corresponde', () => {
  const caso = (cambios, patron) => {
    const r = filtrarCompra({ p: { ...base, ...cambios.p }, estado: { ...estadoLimpio, ...cambios.estado } });
    assert.equal(r.ok, false);
    assert.match(r.razon, patron);
  };
  caso({ p: { pausado: true } }, /pausa/);
  caso({ estado: { posicionesAbiertas: 8 } }, /posiciones abiertas/);
  caso({ estado: { comprasHoy: 25 } }, /compras hoy/);
  caso({ estado: { pnlHoyUsd: -25 } }, /perdida diaria/);
  caso({ estado: { yaTengoEsteToken: true } }, /ya tienes este token/);
  caso({ estado: { minutosDesdeUltimaCompra: 5 } }, /espera 30/);
  caso({ estado: { impactoPct: 20 } }, /impacto de precio/);
  caso({ estado: { hayRutaDeVenta: false } }, /honeypot/);
});

test('una compra normal pasa los filtros', () => {
  assert.equal(filtrarCompra({ p: base, estado: estadoLimpio }).ok, true);
});

test('con promediar encendido si se permite repetir token', () => {
  const r = filtrarCompra({ p: { ...base, promediar: true, cooldownMintMin: 0 }, estado: { ...estadoLimpio, yaTengoEsteToken: true, minutosDesdeUltimaCompra: 1 } });
  assert.equal(r.ok, true);
});

test('el stop loss corta la perdida', () => {
  const r = evaluarSalida({ p: base, posicion: { costoUsd: 100, picoUsd: 100 }, valorUsd: 60 });
  assert.equal(r.vender, true);
  assert.match(r.razon, /stop loss/);
});

test('el take profit cierra en la ganancia pedida', () => {
  const r = evaluarSalida({ p: base, posicion: { costoUsd: 100, picoUsd: 100 }, valorUsd: 170 });
  assert.equal(r.vender, true);
  assert.match(r.razon, /take profit/);
});

test('el trailing deja correr la subida y vende en la caida desde el pico', () => {
  const p = { ...base, takeProfitPct: 300, trailingActivaPct: 40, trailingCaidaPct: 15 };
  // Sube a +150%: el trailing esta armado pero todavia no hay caida.
  const subiendo = evaluarSalida({ p, posicion: { costoUsd: 100, picoUsd: 100 }, valorUsd: 250 });
  assert.equal(subiendo.vender, false);
  assert.equal(subiendo.trailingArmado, true);
  assert.equal(subiendo.nuevoPico, 250);

  // Cae 16% desde el pico de 250: se vende sin haber tocado el take profit.
  const cayendo = evaluarSalida({ p, posicion: { costoUsd: 100, picoUsd: 250 }, valorUsd: 209 });
  assert.equal(cayendo.vender, true);
  assert.match(cayendo.razon, /trailing/);
});

test('el take profit sigue siendo un techo aunque el trailing este armado', () => {
  // Con TP 60 y trailing desde 40, un salto directo a +70% cierra por take profit.
  const r = evaluarSalida({ p: base, posicion: { costoUsd: 100, picoUsd: 100 }, valorUsd: 170 });
  assert.equal(r.vender, true);
  assert.match(r.razon, /take profit/);
});

test('con las salidas en cero, nada se vende solo', () => {
  const p = { ...base, takeProfitPct: 0, stopLossPct: 0, trailingActivaPct: 0 };
  assert.equal(evaluarSalida({ p, posicion: { costoUsd: 100, picoUsd: 100 }, valorUsd: 1 }).vender, false);
  assert.equal(evaluarSalida({ p, posicion: { costoUsd: 100, picoUsd: 100 }, valorUsd: 9999 }).vender, false);
});
