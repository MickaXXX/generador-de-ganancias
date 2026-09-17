// El parseo de datos de mercado y la resolucion del perfil son las partes que
// hablan con la red. Aca se prueban con respuestas inyectadas, para que lo
// unico sin cubrir sea la llamada HTTP en si.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerParesDex, leerAutoridades, MercadoReal } from '../replicador/motor/mercado.mjs';
import { esDireccion, usuarioDesdeUrl, resolver } from '../replicador/motor/resolver.mjs';

const MINT = 'Token11111111111111111111111111111111111111';
const AHORA = 1_700_000_000_000;
const resp = (cuerpo) => ({ ok: true, json: async () => cuerpo });

// ------------------------------------------------------------------- mercado

test('se queda con el par mas liquido y no con el primero de la lista', () => {
  const d = leerParesDex({ pairs: [
    { liquidity: { usd: 1000 }, priceUsd: '9', pairCreatedAt: AHORA - 60_000 },
    { liquidity: { usd: 750_000 }, priceUsd: '1.5', pairCreatedAt: AHORA - 7_200_000, priceNative: '0.01', quoteToken: { symbol: 'SOL' } },
  ] }, AHORA);
  assert.equal(d.liquidezUsd, 750_000);
  assert.equal(d.precioUsd, 1.5);
  assert.equal(d.precioSol, 0.01);
  assert.equal(d.edadMinutos, 120);
});

test('no toma el precio nativo como precio en SOL si el par no es contra SOL', () => {
  const d = leerParesDex({ pairs: [{ liquidity: { usd: 50_000 }, priceNative: '0.9', quoteToken: { symbol: 'USDC' } }] }, AHORA);
  assert.equal(d.precioSol, 0, 'un par contra USDC se leyo como si cotizara en SOL');
});

test('un token sin pares devuelve null en vez de datos a medias', () => {
  assert.equal(leerParesDex({ pairs: [] }, AHORA), null);
  assert.equal(leerParesDex(null, AHORA), null);
});

test('lee las autoridades de mint y freeze del formato jsonParsed', () => {
  const a = leerAutoridades({ value: { data: { parsed: { info: { mintAuthority: 'ABC', freezeAuthority: null, decimals: 9 } } } } });
  assert.equal(a.mintAuthority, 'ABC');
  assert.equal(a.freezeAuthority, null);
  assert.equal(a.decimales, 9);
  assert.equal(leerAutoridades({ value: null }), null, 'una cuenta vacia deberia dar null');
});

test('sin datos de autoridades no se devuelve informacion del token', async () => {
  // Si no se puede verificar que el token no sea una trampa, la politica tiene
  // que quedarse sin datos y rechazar la compra.
  const m = new MercadoReal({
    conexion: { getParsedAccountInfo: async () => { throw new Error('rpc caido'); } },
    obtener: async () => resp({ pairs: [{ liquidity: { usd: 99_999 }, pairCreatedAt: AHORA - 7_200_000 }] }),
    ahora: () => AHORA,
  });
  assert.equal(await m.infoToken(MINT), null);
});

test('convierte el precio de Jupiter de USD a SOL', async () => {
  const m = new MercadoReal({
    conexion: {},
    obtener: async () => resp({
      [MINT]: { usdPrice: 0.45 },
      So11111111111111111111111111111111111111112: { usdPrice: 150 },
    }),
    ahora: () => AHORA,
  });
  assert.ok(Math.abs(await m.precio(MINT) - 0.003) < 1e-12);
});

test('un fallo de red no borra el ultimo precio conocido', async () => {
  let caer = false;
  const m = new MercadoReal({
    conexion: {},
    obtener: async () => (caer ? { ok: false } : resp({ [MINT]: { usdPrice: 3 }, So11111111111111111111111111111111111111112: { usdPrice: 150 } })),
    ahora: () => (caer ? AHORA + 60_000 : AHORA),
  });
  const bueno = await m.precio(MINT);
  caer = true;
  assert.equal(await m.precio(MINT), bueno, 'el precio se fue a cero ante un fallo de red');
});

// ------------------------------------------------------------------ resolver

test('reconoce direcciones de Solana y descarta lo que no lo es', () => {
  assert.ok(esDireccion('GGYXhCXBg1jUqBbQWUNvjt1m4H8gpfbyY5bgZUArdbgf'));
  assert.ok(!esDireccion('DumbCrayonEater'));
  assert.ok(!esDireccion('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), 'acepto una direccion de Ethereum');
  assert.ok(!esDireccion('IOl0111111111111111111111111111111111111111'), 'acepto caracteres que base58 excluye');
});

test('saca el usuario de una URL de perfil con parametros de compartir', () => {
  assert.equal(usuarioDesdeUrl('https://fomo.family/profile/DumbCrayonEater?source=share_link&r=PastordeOvejas'), 'DumbCrayonEater');
  assert.equal(usuarioDesdeUrl('@DumbCrayonEater'), 'DumbCrayonEater');
  assert.equal(usuarioDesdeUrl('GGYXhCXBg1jUqBbQWUNvjt1m4H8gpfbyY5bgZUArdbgf'), null, 'trato una direccion como si fuera un usuario');
});

test('una direccion pegada se acepta sin consultar la red', async () => {
  const r = await resolver('GGYXhCXBg1jUqBbQWUNvjt1m4H8gpfbyY5bgZUArdbgf');
  assert.equal(r.direccion, 'GGYXhCXBg1jUqBbQWUNvjt1m4H8gpfbyY5bgZUArdbgf');
});

test('si no se puede resolver, el error explica que hacer', async () => {
  const r = await resolver('https://fomo.family/profile/UsuarioQueNoExiste999');
  assert.ok(r.error, 'deberia haber fallado');
  assert.match(r.error, /copia la direccion/i);
});
