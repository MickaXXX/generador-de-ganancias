import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Almacen } from '../src/store.js';

const carpeta = mkdtempSync(join(tmpdir(), 'copiabot-estado-'));
process.on('exit', () => rmSync(carpeta, { recursive: true, force: true }));
const nuevo = (nombre) => new Almacen(join(carpeta, `${nombre}.json`));

test('el estado sobrevive a un reinicio', () => {
  const a = nuevo('uno');
  a.agregarLider('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'ballena');
  a.fijarParametro('compraUsd', 7);
  a.guardarYa();
  assert.ok(existsSync(join(carpeta, 'uno.json')));

  const b = nuevo('uno');
  assert.equal(b.p.compraUsd, 7);
  assert.equal(b.lideresActivos()[0].alias, 'ballena');
});

test('la posicion del lider se acumula y se descuenta', () => {
  const a = nuevo('dos');
  const dir = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  a.agregarLider(dir, 'x');
  a.anotarLider(dir, 'TOKEN', 1000);
  a.anotarLider(dir, 'TOKEN', 500);
  assert.equal(a.posicionLider(dir, 'TOKEN'), 1500);
  a.anotarLider(dir, 'TOKEN', -600);
  assert.equal(a.posicionLider(dir, 'TOKEN'), 900);
  a.anotarLider(dir, 'TOKEN', -900);
  assert.equal(a.posicionLider(dir, 'TOKEN'), 0);
});

test('una firma ya vista no se procesa dos veces', () => {
  const a = nuevo('tres');
  assert.equal(a.yaVisto('firma-abc'), false);
  a.marcarVisto('firma-abc');
  assert.equal(a.yaVisto('firma-abc'), true);
});

test('los contadores se reinician al cambiar el dia', () => {
  const a = nuevo('cuatro');
  a.hoy().compras = 5;
  a.datos.dia.fecha = '2000-01-01';
  assert.equal(a.hoy().compras, 0);
});

test('dejar de seguir funciona por alias o por direccion', () => {
  const a = nuevo('cinco');
  const dir = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  a.agregarLider(dir, 'ballena');
  assert.equal(a.quitarLider('ballena'), dir);
  assert.equal(a.lideresActivos().length, 0);
  a.agregarLider(dir, 'ballena');
  assert.equal(a.quitarLider(dir), dir);
  assert.equal(a.quitarLider('no-existe'), null);
});

test('un estado corrupto no impide arrancar', () => {
  const ruta = join(carpeta, 'roto.json');
  writeFileSync(ruta, '{esto no es json');
  const a = new Almacen(ruta);
  assert.equal(a.lideresActivos().length, 0);
  assert.ok(a.p.compraUsd > 0);
});
