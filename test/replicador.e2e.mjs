// Prueba de funcionalidad de punta a punta: levanta el servidor, maneja la
// interfaz en un Chromium real, aprieta los dos botones y verifica que el
// sistema arranque, copie operaciones y se detenga de verdad.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const PUERTO = 4399;
const URL = `http://127.0.0.1:${PUERTO}`;
const CAPTURAS = 'capturas';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ok   ${msg}`); else { fallos++; console.log(`  FALLA ${msg}`); } };

const servidor = spawn(process.execPath, ['replicador/servidor.mjs'], {
  env: { ...process.env, PUERTO: String(PUERTO) }, stdio: 'ignore',
});

try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${URL}/api/estado`); break; } catch { await esperar(100); }
  }
  await mkdir(CAPTURAS, { recursive: true });

  // Simulacion acelerada para que la prueba no tarde un minuto.
  await fetch(`${URL}/api/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msPorTick: 45, segundosPorTick: 45, semillaSimulacion: 77, presupuestoSol: 0.5, cadena: 'simulada', ejecucion: 'sombra' }),
  });

  // El contenedor trae Chromium preinstalado en otra ruta que la que espera
  // esta version de Playwright.
  const BINARIO = '/opt/pw-browsers/chromium';
  const navegador = await chromium.launch(existsSync(BINARIO) ? { executablePath: BINARIO } : {});
  const pagina = await (await navegador.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  // 'networkidle' nunca se cumple: el stream de eventos queda abierto a
  // proposito, que es justamente lo que mantiene viva la interfaz.
  await pagina.goto(URL, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#btn-correr:not([disabled])', { timeout: 10000 });

  console.log('\nEstado inicial');
  ok(await pagina.isEnabled('#btn-correr'), 'el boton de correr esta habilitado');
  ok(await pagina.isDisabled('#btn-detener'), 'el boton de detener esta deshabilitado');
  ok((await pagina.textContent('#insignia-modo')).includes('DEMO'), 'la insignia avisa que la cadena es inventada');
  ok((await pagina.textContent('#aviso-modo')).includes('Nada de esto es real'), 'el aviso de modo demo es explicito');
  ok(await pagina.isChecked('input[name="modo"][value="demo"]'), 'el modo por defecto es el que no arriesga nada');

  // La interfaz no debe tener NINGUN campo donde se pueda pegar una clave.
  const campos = await pagina.$$eval('input', (els) => els.map((e) => `${e.id}|${e.type}|${e.placeholder}`));
  const sospechosos = campos.filter((c) => /clave|secret|private|semilla|frase|seed|password/i.test(c));
  ok(sospechosos.length === 0, `ningun campo pide claves (${campos.length} campos revisados)`);

  console.log('\nArranque');
  await pagina.fill('#trader', 'DumbCrayonEater');
  await pagina.fill('#presupuestoSol', '0.5');
  await pagina.click('#btn-correr');
  await pagina.waitForSelector('#btn-detener:not([disabled])', { timeout: 8000 });
  ok(await pagina.isDisabled('#btn-correr'), 'el boton de correr se deshabilita mientras corre');
  ok(await pagina.isDisabled('#presupuestoSol'), 'la configuracion queda bloqueada durante la corrida');

  await pagina.waitForFunction(() => Number(document.getElementById('m-copiadas').textContent) > 0, null, { timeout: 25000 });
  await esperar(6000);

  const copiadas = Number(await pagina.textContent('#m-copiadas'));
  const lineas = await pagina.$$eval('#registro .linea', (e) => e.length);
  const filas = await pagina.$$eval('#tbody-posiciones tr:not(.vacio)', (e) => e.length);
  ok(copiadas > 0, `copio ${copiadas} operaciones`);
  ok(lineas > 5, `el registro en vivo tiene ${lineas} lineas`);
  ok(filas > 0, `la tabla muestra ${filas} posiciones abiertas`);
  ok(/SOL/.test(await pagina.textContent('#m-valor')), 'la metrica de valor total se esta actualizando');
  await pagina.screenshot({ path: `${CAPTURAS}/replicador-corriendo.png`, fullPage: true });

  console.log('\nDetencion');
  await pagina.click('#btn-detener');
  await pagina.waitForSelector('#btn-correr:not([disabled])', { timeout: 8000 });
  ok(await pagina.isDisabled('#btn-detener'), 'el boton de detener se deshabilita al parar');
  ok(await pagina.isEnabled('#presupuestoSol'), 'la configuracion se desbloquea al parar');

  const tras = Number(await pagina.textContent('#m-copiadas'));
  await esperar(4000);
  const despues = Number(await pagina.textContent('#m-copiadas'));
  ok(despues === tras, `no se copio nada despues de detener (${tras} antes, ${despues} despues)`);

  // La interfaz no puede presentar una wallet inventada como si fuera la real.
  ok((await pagina.textContent('#estado-trader')).includes('simulada'), 'avisa que la cadena mostrada es simulada');

  const estado = await (await fetch(`${URL}/api/estado`)).json();
  ok(estado.corriendo === false, 'el servidor confirma que la automatizacion esta detenida');
  ok(/interfaz/.test(estado.motivoDetencion ?? ''), 'queda registrado el motivo de la detencion');

  await pagina.screenshot({ path: `${CAPTURAS}/replicador-detenido.png`, fullPage: true });
  ok(errores.length === 0, `sin errores de JavaScript en la pagina${errores.length ? ': ' + errores.join('; ') : ''}`);

  await navegador.close();
} finally {
  servidor.kill();
}

console.log(fallos === 0 ? '\nTodo en verde.\n' : `\n${fallos} fallas.\n`);
process.exit(fallos === 0 ? 0 : 1);
