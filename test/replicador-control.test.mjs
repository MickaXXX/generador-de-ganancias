// Pruebas de los controles: boton de arranque, boton de detencion,
// trailing stop propio y cortacircuitos por drawdown.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Replicador } from '../replicador/motor/replicador.mjs';
import { MINT_SOL } from '../replicador/motor/decodificador.mjs';

const TRADER = 'Trader1111111111111111111111111111111111111';
const TOKEN = 'Token11111111111111111111111111111111111111';
const L = 1e9;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fuente que solo emite lo que la prueba le inyecta a mano. */
class FuenteManual {
  constructor(precios) { this.trader = TRADER; this.precio_ = precios; this.activa = false; }
  arrancar(cb) { this.cb = cb; this.activa = true; }
  detener() { this.activa = false; }
  emitir(tx) { this.cb?.(tx); }
  precio(m) { return this.precio_.get(m) ?? 0; }
  precios() { return this.precio_; }
  infoToken() { return { liquidezUsd: 500_000, edadMinutos: 999, mintAuthority: null, freezeAuthority: null }; }
}

class EjecutorPrueba {
  constructor(fuente) { this.fuente = fuente; this.modo = 'prueba'; }
  async comprar({ mint, montoSol }) {
    const precio = this.fuente.precio(mint);
    return { mint, tokens: montoSol / precio, solGastado: montoSol, feeSol: 0, precio };
  }
  async vender({ mint, tokens }) {
    const precio = this.fuente.precio(mint);
    return { mint, tokens, solRecibido: tokens * precio, feeSol: 0, precio };
  }
}

function txCompra({ solPre, solGastado, tokens }) {
  return {
    blockTime: 1_700_000_000,
    transaction: { signatures: ['s'], message: { accountKeys: [TRADER, 'o', MINT_SOL, TOKEN] } },
    meta: {
      err: null, fee: 0,
      preBalances: [Math.round(solPre * L), 0, 0, 0],
      postBalances: [Math.round((solPre - solGastado) * L), 0, 0, 0],
      preTokenBalances: [],
      postTokenBalances: [{
        accountIndex: 3, mint: TOKEN, owner: TRADER,
        uiTokenAmount: { amount: String(tokens * 1e6), decimals: 6, uiAmount: tokens, uiAmountString: String(tokens) },
      }],
    },
  };
}

function armar(precioInicial, config = {}) {
  const precios = new Map([[TOKEN, precioInicial]]);
  const fuente = new FuenteManual(precios);
  const rep = new Replicador({
    fuente,
    ejecutor: new EjecutorPrueba(fuente),
    config: { presupuestoSol: 1, minOrdenSol: 0.001, maxDrawdownDiario: 0.99, trailingStop: 0.35, ...config },
  });
  return { rep, fuente, precios };
}

test('el trailing stop vende sin esperar a que el trader venda', async () => {
  const { rep, fuente, precios } = armar(0.001);
  rep.arrancar();
  fuente.emitir(txCompra({ solPre: 10, solGastado: 2, tokens: 200 })); // 20% del saldo del trader
  await esperar(30);
  assert.equal(rep.cartera.abiertas, 1, 'no se abrio la posicion');

  precios.set(TOKEN, 0.002);   // sube: el maximo queda mas alto
  await esperar(1100);
  precios.set(TOKEN, 0.0011);  // cae 45% desde el maximo, sobre el stop de 35%
  await esperar(1100);

  assert.equal(rep.contadores.stops, 1, 'el trailing stop no se disparo');
  assert.equal(rep.cartera.abiertas, 0, 'la posicion quedo abierta despues del stop');
  await rep.detener();
});

test('el cortacircuitos detiene la automatizacion sola cuando el drawdown se pasa', async () => {
  const { rep, fuente, precios } = armar(0.001, { maxDrawdownDiario: 0.20, trailingStop: 0.99 });
  rep.arrancar();
  fuente.emitir(txCompra({ solPre: 10, solGastado: 8, tokens: 800 })); // se topa en 25% del presupuesto
  await esperar(30);
  assert.ok(rep.corriendo);

  precios.set(TOKEN, 0.0001); // la posicion pierde el 90%
  await esperar(1200);

  assert.equal(rep.corriendo, false, 'el cortacircuitos no detuvo el replicador');
  assert.match(rep.motivoDetencion, /drawdown/);
  assert.ok(rep.registro.some((l) => l.nivel === 'alarma'), 'no quedo registrada la alarma');
});

test('despues de detener, las operaciones nuevas del trader se ignoran', async () => {
  const { rep, fuente } = armar(0.001);
  rep.arrancar();
  fuente.emitir(txCompra({ solPre: 10, solGastado: 1, tokens: 100 }));
  await esperar(30);
  const copiadasAntes = rep.contadores.copiadas;
  assert.equal(copiadasAntes, 1);

  await rep.detener();
  fuente.emitir(txCompra({ solPre: 9, solGastado: 1, tokens: 100 }));
  await esperar(30);

  assert.equal(rep.contadores.copiadas, copiadasAntes, 'se copio una operacion con la automatizacion detenida');
  assert.equal(rep.estado().corriendo, false);
});

test('arrancar dos veces no duplica la suscripcion ni las copias', async () => {
  const { rep, fuente } = armar(0.001);
  rep.arrancar();
  rep.arrancar();
  fuente.emitir(txCompra({ solPre: 10, solGastado: 1, tokens: 100 }));
  await esperar(30);
  assert.equal(rep.contadores.copiadas, 1, 'la operacion se copio dos veces');
  await rep.detener();
});
