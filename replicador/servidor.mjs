#!/usr/bin/env node
// Servidor local del replicador. Se abre SOLO en 127.0.0.1: no queda expuesto
// a la red, ni a internet, ni a nadie mas que el navegador de esta maquina.
//
// LA CLAVE PRIVADA NUNCA PASA POR AQUI. No hay ningun endpoint que la reciba.
// Se lee de la variable de entorno CLAVE_PRIVADA o del archivo .clave, ambos
// en esta maquina, y jamas se envia al navegador ni a ningun servicio.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FuenteSimulada, FuenteSolana } from './motor/fuente.mjs';
import { MercadoReal } from './motor/mercado.mjs';
import { EjecutorSombra, EjecutorJupiter } from './motor/ejecutor.mjs';
import { Replicador } from './motor/replicador.mjs';
import { resolver, esDireccion } from './motor/resolver.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO ?? 4310);

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function cargarConfig() {
  for (const n of ['config.json', 'config.ejemplo.json']) {
    const p = join(AQUI, n);
    if (existsSync(p)) return { ...JSON.parse(readFileSync(p, 'utf8')), _archivo: n };
  }
  return {};
}

/** Lee la clave privada de disco o del entorno. Nunca de la red. */
function cargarClave() {
  const crudo = process.env.CLAVE_PRIVADA ?? (existsSync(join(AQUI, '.clave')) ? readFileSync(join(AQUI, '.clave'), 'utf8') : '');
  const t = crudo.trim();
  return t.length ? t : null;
}

// ------------------------------------------------------------------- estado

let config = cargarConfig();
let replicador = null;
let traderResuelto = esDireccion(config.trader ?? '') ? config.trader : null;
let ultimoError = null;
const oyentes = new Set();

function difundir(tipo, datos) {
  const linea = `data: ${JSON.stringify({ tipo, datos })}\n\n`;
  for (const res of oyentes) { try { res.write(linea); } catch { oyentes.delete(res); } }
}

function estadoServidor() {
  const { cadena, ejecucion } = modos();
  const base = {
    trader: traderResuelto,
    traderConfigurado: config.trader ?? '',
    cadena,
    ejecucion,
    hayClave: cargarClave() != null,
    config,
    ultimoError,
  };
  return replicador ? { ...base, ...replicador.estado(), registro: replicador.registro.slice(-120) } : { ...base, corriendo: false, registro: [] };
}

/**
 * Dos ejes independientes, que es la distincion que importa:
 *
 *   cadena    de donde salen las operaciones:  simulada | real
 *   ejecucion a donde va el dinero:            sombra   | real
 *
 * simulada + sombra  demo sin red y sin riesgo. Sirve para probar la app.
 * real     + sombra  papel sobre las operaciones REALES del trader. Este es
 *                    el modo que responde si vale la pena copiarlo.
 * real     + real     dinero de verdad.
 * simulada + real     prohibido: firmar contra precios inventados.
 */
function modos() {
  const cadena = config.cadena ?? (config.modo === 'real' ? 'real' : 'simulada');
  const ejecucion = config.ejecucion ?? (config.modo === 'real' ? 'real' : 'sombra');
  return { cadena, ejecucion };
}

async function construir() {
  const { cadena, ejecucion } = modos();
  if (cadena === 'simulada' && ejecucion === 'real') {
    throw new Error('No se puede ejecutar con dinero real contra una cadena simulada.');
  }

  // --- de donde salen las operaciones ---
  let fuente;
  let mercado;
  let conexion = null;

  if (cadena === 'simulada') {
    fuente = new FuenteSimulada({
      semilla: config.semillaSimulacion ?? (Date.now() & 0xffff),
      msPorTick: config.msPorTick ?? 700,
      segundosPorTick: config.segundosPorTick ?? 45,
    });
    mercado = fuente;
  } else {
    if (!traderResuelto) throw new Error('Falta la direccion del trader. Pegala o resolvela antes de arrancar.');
    const { Connection } = await import('@solana/web3.js');
    conexion = new Connection(config.rpc, { commitment: 'confirmed', wsEndpoint: config.rpcWs || undefined });
    fuente = new FuenteSolana({ conexion, trader: traderResuelto });
    mercado = new MercadoReal({ conexion });
  }

  // --- a donde va el dinero ---
  let ejecutor;
  if (ejecucion === 'sombra') {
    ejecutor = new EjecutorSombra({ mercado, retrasoMs: config.retrasoEstimadoMs ?? 1200 });
  } else {
    const clave = cargarClave();
    if (!clave) {
      throw new Error('No hay clave privada. Ponela en replicador/.clave o en la variable CLAVE_PRIVADA de esta maquina. Nunca la pegues en el navegador.');
    }
    const { Keypair } = await import('@solana/web3.js');
    const bs58 = (await import('bs58')).default;
    ejecutor = new EjecutorJupiter({ conexion, billetera: Keypair.fromSecretKey(bs58.decode(clave)), ...config });
  }

  return new Replicador({ fuente, ejecutor, mercado, config });
}

function enganchar(rep) {
  rep.on('registro', (l) => difundir('registro', l));
  rep.on('estado', () => difundir('estado', estadoServidor()));
}

// ------------------------------------------------------------------ endpoints

const leerCuerpo = (req) => new Promise((res) => {
  let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res({}); } });
});

const responder = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
};

const RUTAS = {
  'GET /api/estado': async (req, res) => responder(res, 200, estadoServidor()),

  'POST /api/arrancar': async (req, res) => {
    try {
      if (replicador?.corriendo) return responder(res, 200, estadoServidor());
      ultimoError = null;
      if (!traderResuelto && config.trader) {
        const r = await resolver(config.trader);
        if (r.direccion) traderResuelto = r.direccion;
        else if (modos().cadena === 'real') throw new Error(r.error);
      }
      replicador = await construir();
      enganchar(replicador);
      replicador.arrancar();
      difundir('estado', estadoServidor());
      responder(res, 200, estadoServidor());
    } catch (e) {
      ultimoError = e.message;
      difundir('estado', estadoServidor());
      responder(res, 400, { error: e.message });
    }
  },

  'POST /api/detener': async (req, res) => {
    await replicador?.detener('detenido desde la interfaz');
    difundir('estado', estadoServidor());
    responder(res, 200, estadoServidor());
  },

  'POST /api/config': async (req, res) => {
    const cuerpo = await leerCuerpo(req);
    // Cualquier cosa que huela a secreto se descarta antes de tocar la config.
    for (const k of ['clave', 'clavePrivada', 'secretKey', 'privateKey', 'semilla', 'frase', 'mnemonic', 'seedPhrase']) delete cuerpo[k];
    if (replicador?.corriendo) return responder(res, 409, { error: 'Detene la automatizacion antes de cambiar la configuracion.' });
    config = { ...config, ...cuerpo };
    if ('trader' in cuerpo) traderResuelto = esDireccion(cuerpo.trader) ? cuerpo.trader : null;
    responder(res, 200, estadoServidor());
  },

  'POST /api/resolver': async (req, res) => {
    const { trader } = await leerCuerpo(req);
    const r = await resolver(trader ?? config.trader);
    if (r.direccion) { traderResuelto = r.direccion; config.trader = trader ?? config.trader; }
    responder(res, r.direccion ? 200 : 422, r);
  },

  'GET /api/eventos': async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ tipo: 'estado', datos: estadoServidor() })}\n\n`);
    oyentes.add(res);
    const latido = setInterval(() => { try { res.write(': latido\n\n'); } catch {} }, 20000);
    req.on('close', () => { clearInterval(latido); oyentes.delete(res); });
  },
};

const servidor = createServer(async (req, res) => {
  const ruta = new URL(req.url, 'http://localhost').pathname;
  const manejador = RUTAS[`${req.method} ${ruta}`];
  if (manejador) return manejador(req, res);

  const archivo = join(AQUI, 'publico', ruta === '/' ? 'index.html' : ruta.replace(/^\/+/, ''));
  if (!archivo.startsWith(join(AQUI, 'publico'))) { res.writeHead(403).end(); return; }
  try {
    const contenido = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    res.end(contenido);
  } catch { res.writeHead(404).end('no encontrado'); }
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`\n  Replicador FOMO   http://127.0.0.1:${PUERTO}`);
  const { cadena, ejecucion } = modos();
  console.log(`  Cadena: ${cadena.toUpperCase()}   Ejecucion: ${ejecucion.toUpperCase()}   Config: ${config._archivo ?? 'por defecto'}`);
  console.log(`  Clave privada: ${cargarClave() ? 'cargada desde disco' : 'no cargada (el modo sombra no la necesita)'}\n`);
});

export { servidor };
