import test from "node:test";
import assert from "node:assert/strict";
import {
  pesosEntropia, minMax, topsis, kmeans, silueta, elegirK,
  zDeServicio, politicaRS, clasificarABC, analizar, suma, estandarizar,
} from "../docs/core/criticidad.js";
import { generarRepuestos } from "../scripts/generar-demo.mjs";

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperaba ${b} +-${tol}, obtuve ${a}`);

// --------------------------------------------------------------------------
test("minMax deja las columnas constantes en 0.5", () => {
  const r = minMax([[1, 5], [2, 5], [3, 5]]);
  assert.deepEqual(r.map((f) => f[1]), [0.5, 0.5, 0.5]);
  cerca(r[0][0], 0);
  cerca(r[2][0], 1);
});

test("pesos de entropia suman 1 y anulan criterios sin informacion", () => {
  const m = [[1, 7], [5, 7], [9, 7]];
  const w = pesosEntropia(m);
  cerca(suma(w), 1, 1e-9);
  cerca(w[1], 0, 1e-9);   // columna constante no aporta
  cerca(w[0], 1, 1e-9);
});

test("pesos de entropia: mas dispersion objetiva -> mas peso", () => {
  // col 0 muy dispersa, col 1 casi plana
  const m = [[1, 10], [50, 10.1], [100, 10.2], [500, 10.3]];
  const w = pesosEntropia(m);
  assert.ok(w[0] > w[1], `w0=${w[0]} deberia superar a w1=${w[1]}`);
  cerca(suma(w), 1, 1e-9);
});

test("pesos de entropia caen a reparto parejo si todo es constante", () => {
  const w = pesosEntropia([[3, 3], [3, 3], [3, 3]]);
  cerca(w[0], 0.5, 1e-9);
  cerca(w[1], 0.5, 1e-9);
});

// --------------------------------------------------------------------------
test("TOPSIS: indices en [0,1] y la alternativa dominante gana", () => {
  //           precio  consumo  leadtime  proveedores(costo)
  const m = [
    [1000, 500, 90, 1],   // domina en todo
    [500,  200, 40, 2],
    [10,   5,   3,  5],   // dominada en todo
  ];
  const { indices } = topsis(m, ["beneficio", "beneficio", "beneficio", "costo"]);
  indices.forEach((c) => assert.ok(c >= 0 && c <= 1, `fuera de rango: ${c}`));
  assert.ok(indices[0] > indices[1], "la dominante debe superar a la media");
  assert.ok(indices[1] > indices[2], "la media debe superar a la dominada");
  cerca(indices[0], 1, 1e-9);
  cerca(indices[2], 0, 1e-9);
});

test("TOPSIS respeta el sentido 'costo'", () => {
  // Unico criterio: numero de proveedores. Menos proveedores = mas critico.
  const m = [[1], [5]];
  const { indices } = topsis(m, ["costo"]);
  assert.ok(indices[0] > indices[1], "1 proveedor debe ser mas critico que 5");
});

test("TOPSIS con filas identicas devuelve 0.5 para todas", () => {
  const { indices } = topsis([[5, 5], [5, 5]], ["beneficio", "beneficio"]);
  indices.forEach((c) => cerca(c, 0.5, 1e-9));
});

test("TOPSIS acepta pesos externos", () => {
  const m = [[10, 1], [1, 10]];
  const a = topsis(m, ["beneficio", "beneficio"], [0.9, 0.1]).indices;
  assert.ok(a[0] > a[1], "con 90% del peso en el criterio 1 gana la fila 1");
});

// --------------------------------------------------------------------------
test("k-means separa dos nubes evidentes y es determinista", () => {
  const datos = [];
  for (let i = 0; i < 20; i++) datos.push([0 + i * 0.01, 0 + i * 0.01]);
  for (let i = 0; i < 20; i++) datos.push([50 + i * 0.01, 50 + i * 0.01]);
  const a = kmeans(datos, 2, { semilla: 1 });
  const b = kmeans(datos, 2, { semilla: 1 });
  assert.deepEqual(a.asignaciones, b.asignaciones, "misma semilla -> mismo resultado");
  const g1 = new Set(a.asignaciones.slice(0, 20));
  const g2 = new Set(a.asignaciones.slice(20));
  assert.equal(g1.size, 1);
  assert.equal(g2.size, 1);
  assert.notDeepEqual([...g1], [...g2]);
});

test("silueta alta para nubes separadas, baja para ruido uniforme", () => {
  const separadas = [[0, 0], [0.1, 0], [0, 0.1], [40, 40], [40.1, 40], [40, 40.1]];
  const sep = kmeans(separadas, 2, { semilla: 3 });
  assert.ok(silueta(separadas, sep.asignaciones) > 0.9);
  assert.equal(silueta(separadas, [0, 0, 0, 0, 0, 0]), -1, "un solo grupo -> indefinido");
});

test("elegirK encuentra las 3 familias plantadas", () => {
  const datos = [];
  for (const centro of [[0, 0], [30, 30], [60, 0]]) {
    for (let i = 0; i < 12; i++) datos.push([centro[0] + (i % 4) * 0.3, centro[1] + (i % 3) * 0.3]);
  }
  const { k, silueta: s } = elegirK(datos, 5, 11);
  assert.equal(k, 3);
  assert.ok(s > 0.8, `silueta baja: ${s}`);
});

test("elegirK devuelve k=1 con muy pocos datos", () => {
  assert.equal(elegirK([[1, 1], [2, 2]], 5).k, 1);
});

test("estandarizar deja media 0 y sigma 1 sin dividir por cero", () => {
  const z = estandarizar([[1, 5], [2, 5], [3, 5]]);
  cerca(suma(z.map((f) => f[0])), 0, 1e-9);
  assert.ok(z.every((f) => Number.isFinite(f[1])), "columna constante no debe dar NaN");
});

// --------------------------------------------------------------------------
test("z de servicio coincide con la tabla normal", () => {
  cerca(zDeServicio(0.5), 0, 1e-6);
  cerca(zDeServicio(0.90), 1.281552, 1e-4);
  cerca(zDeServicio(0.95), 1.644854, 1e-4);
  cerca(zDeServicio(0.99), 2.326348, 1e-4);
});

// --------------------------------------------------------------------------
const ITEM = { precio: 100, consumoAnual: 360, leadTime: 30 };

test("(R,S): el nivel objetivo supera al stock de seguridad", () => {
  const p = politicaRS(ITEM, "A");
  assert.ok(p.nivelObjetivoS > p.stockSeguridad);
  assert.ok(p.stockSeguridad > 0);
});

test("(R,S): clase A exige mas stock de seguridad que clase C para el mismo item", () => {
  const a = politicaRS(ITEM, "A");
  const c = politicaRS(ITEM, "C");
  assert.ok(a.servicioObjetivo > c.servicioObjetivo);
  // A revisa cada 7 dias y C cada 30: el periodo de proteccion de C es mayor,
  // asi que se compara el efecto del servicio a igual periodo.
  const aIgualR = politicaRS(ITEM, "A");
  assert.ok(aIgualR.revisionDias < c.revisionDias, "A debe revisarse mas seguido");
});

test("(R,S): mas lead time -> mas nivel objetivo", () => {
  const corto = politicaRS({ ...ITEM, leadTime: 5 }, "B");
  const largo = politicaRS({ ...ITEM, leadTime: 90 }, "B");
  assert.ok(largo.nivelObjetivoS > corto.nivelObjetivoS);
});

test("(R,S): consumo cero no genera stock ni capital", () => {
  const p = politicaRS({ precio: 100, consumoAnual: 0, leadTime: 10 }, "C");
  assert.equal(p.stockSeguridad, 0);
  assert.equal(p.capitalPropuesto, 0);
});

test("(R,S): datos faltantes no producen NaN", () => {
  const p = politicaRS({}, "B");
  Object.values(p).forEach((v) => {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `NaN en la politica: ${JSON.stringify(p)}`);
  });
});

// --------------------------------------------------------------------------
test("ABC: el repuesto de mayor impacto queda en A y siempre existe un A", () => {
  const items = [
    { precio: 5000, consumoAnual: 100 },  // impacto enorme
    { precio: 10,   consumoAnual: 5 },
    { precio: 8,    consumoAnual: 3 },
  ];
  const clases = clasificarABC(items, [0.9, 0.2, 0.1]);
  assert.equal(clases[0], "A");
  assert.ok(clases.includes("A"));
});

test("ABC concentra el capital: la clase A es minoria de los SKU", () => {
  const filas = generarRepuestos(200, 5);
  const { items, resumen } = analizar(filas);
  assert.equal(resumen.n, 200);
  assert.ok(resumen.porClase.A > 0, "debe haber clase A");
  assert.ok(resumen.porClase.A < items.length * 0.5, "A no puede ser la mayoria");
});

// --------------------------------------------------------------------------
test("analizar: contrato completo sobre un maestro realista", () => {
  const filas = generarRepuestos(120, 7);
  const { items, pesos, familias, resumen } = analizar(filas);

  assert.equal(items.length, 120);
  cerca(suma(pesos.map((p) => p.peso)), 1, 1e-9);
  assert.ok(pesos.every((p) => p.peso >= 0));

  // Orden descendente por criticidad.
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i - 1].indiceCriticidad >= items[i].indiceCriticidad, "debe venir ordenado");
  }
  // Sin NaN en ningun campo numerico.
  for (const it of items) {
    for (const [k, v] of Object.entries(it)) {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `NaN en ${it.sku}.${k}`);
    }
    assert.ok(["A", "B", "C"].includes(it.clase));
    assert.ok(it.indiceCriticidad >= 0 && it.indiceCriticidad <= 1);
    assert.ok(it.familia >= 1);
  }
  assert.equal(suma(Object.values(resumen.porClase)), 120);
  assert.equal(suma(familias.map((f) => f.n)), 120);
  assert.ok(resumen.capitalLiberable >= 0);
  assert.ok(resumen.capitalActual > 0);
  assert.ok(resumen.k >= 1 && resumen.k <= 5);
});

test("analizar es reproducible: dos corridas dan el mismo resultado", () => {
  const filas = generarRepuestos(80, 3);
  const a = analizar(filas);
  const b = analizar(filas);
  assert.deepEqual(a.items.map((i) => [i.sku, i.clase, i.familia]),
                   b.items.map((i) => [i.sku, i.clase, i.familia]));
});

test("analizar: capital liberable nunca excede el capital actual", () => {
  const { resumen } = analizar(generarRepuestos(150, 9));
  assert.ok(resumen.capitalLiberable <= resumen.capitalActual + 1e-6);
});

test("analizar sin columna de stock no inventa capital", () => {
  const filas = generarRepuestos(30, 4).map(({ stockActual, ...resto }) => resto);
  const { resumen, items } = analizar(filas);
  assert.equal(resumen.capitalActual, 0);
  assert.equal(resumen.tieneStock, false);
  assert.ok(items.every((i) => i.capitalActual === null));
  assert.ok(items.every((i) => i.nivelObjetivoS >= 1), "igual debe proponer politica");
});

test("analizar rechaza entradas invalidas con mensaje claro", () => {
  assert.throws(() => analizar([]), /No hay repuestos/);
  assert.throws(() => analizar([{ sku: "X", descripcion: "solo texto" }]), /al menos 2 criterios/);
});

test("analizar tolera celdas vacias, negativas y texto basura", () => {
  const filas = [
    { sku: "A", precio: 100, consumoAnual: 50, leadTime: 10, proveedores: 2 },
    { sku: "B", precio: "", consumoAnual: -5, leadTime: "abc", proveedores: 1 },
    { sku: "C", precio: 20, consumoAnual: 200, leadTime: 45, proveedores: null },
    { sku: "D", precio: 999, consumoAnual: 1, leadTime: 120, proveedores: 3 },
  ];
  const { items } = analizar(filas);
  assert.equal(items.length, 4);
  items.forEach((it) => assert.ok(Number.isFinite(it.indiceCriticidad)));
});

test("un repuesto caro, de lead time largo y proveedor unico sube al top", () => {
  const filas = generarRepuestos(60, 2);
  filas.push({
    sku: "CRITICO-1", descripcion: "Rotor unico importado", categoria: "Bombas",
    precio: 90000, consumoAnual: 12, leadTime: 240,
    criticidadEquipo: 5, horasParada: 72, proveedores: 1, stockActual: 0,
  });
  const { items } = analizar(filas);
  const pos = items.findIndex((i) => i.sku === "CRITICO-1");
  assert.ok(pos < 3, `deberia estar en el top 3, quedo en la posicion ${pos + 1}`);
  assert.equal(items[pos].clase, "A");
  assert.equal(items[pos].enRiesgo, true, "stock 0 en clase A es riesgo de quiebre");
});

// ---------------------------------------------------------------------------
// Regresiones encontradas con un maestro real de embotelladora: los criterios
// de cola larga secuestraban el indice y los repuestos de capital caian a C.
// ---------------------------------------------------------------------------

import { generarEmbotelladora } from "../scripts/generar-embotelladora.mjs";
import { concentracionPareto } from "../docs/core/criticidad.js";

test("un consumible barato de altisima rotacion no encabeza el ranking", () => {
  const filas = [
    // El caso que rompia el metodo: 1.900 salidas al año a 2 dolares la unidad.
    { sku: "CONSUMIBLE", precio: 2, consumoAnual: 1900, leadTime: 10,
      criticidadEquipo: 2, horasParada: 2, proveedores: 5 },
    { sku: "CAPITAL", precio: 28000, consumoAnual: 0, leadTime: 165,
      criticidadEquipo: 5, horasParada: 40, proveedores: 1 },
    { sku: "OEM", precio: 90, consumoAnual: 240, leadTime: 120,
      criticidadEquipo: 5, horasParada: 30, proveedores: 1 },
    { sku: "COMUN", precio: 12, consumoAnual: 380, leadTime: 18,
      criticidadEquipo: 3, horasParada: 6, proveedores: 5 },
  ];
  const { items } = analizar(filas);
  assert.notEqual(items[0].sku, "CONSUMIBLE",
    "el consumible mas barato no puede ser el repuesto mas critico de la planta");
  const consumible = items.find((i) => i.sku === "CONSUMIBLE");
  const oem = items.find((i) => i.sku === "OEM");
  assert.ok(oem.indiceCriticidad > consumible.indiceCriticidad,
    `el repuesto OEM de un solo proveedor debe superar al consumible (${oem.indiceCriticidad} vs ${consumible.indiceCriticidad})`);
});

test("un repuesto de capital sin rotacion queda en clase A", () => {
  const filas = generarEmbotelladora(200);
  const { items } = analizar(filas);
  const capital = items.filter((i) => i.precio > 15000 && i.consumoAnual <= 1);
  assert.ok(capital.length > 0, "el maestro de prueba debe traer repuestos de capital");
  const enA = capital.filter((i) => i.clase === "A").length;
  assert.equal(enA, capital.length,
    `los ${capital.length} repuestos de capital deben ser clase A, solo ${enA} lo son`);
});

test("la escala logaritmica impide que un criterio se lleve todo el peso", () => {
  const { pesos } = analizar(generarEmbotelladora(200));
  const mayor = Math.max(...pesos.map((p) => p.peso));
  assert.ok(mayor < 0.45, `ningun criterio deberia superar el 45% del peso (el mayor fue ${(mayor * 100).toFixed(1)}%)`);
  assert.ok(pesos.every((p) => p.peso > 0.01), "ningun criterio deberia quedar anulado");
});

test("el ABC mantiene proporciones accionables aunque el portafolio sea plano", () => {
  for (const n of [50, 120, 200]) {
    const { resumen } = analizar(generarEmbotelladora(n));
    const porcentajeA = resumen.porClase.A / resumen.n;
    assert.ok(porcentajeA <= 0.21, `con ${n} SKU la clase A llego a ${(porcentajeA * 100).toFixed(0)}%`);
    assert.ok(resumen.porClase.A >= 1, "siempre debe haber al menos un repuesto en A");
    assert.equal(resumen.porClase.A + resumen.porClase.B + resumen.porClase.C, n);
  }
});

test("un portafolio muy concentrado igual respeta el corte por valor", () => {
  // 1 repuesto se lleva casi todo el impacto: la regla de Pareto manda sobre el tope.
  const filas = [
    { sku: "DOMINANTE", precio: 500000, consumoAnual: 50, leadTime: 90, proveedores: 1 },
    ...Array.from({ length: 19 }, (_, i) => ({
      sku: `MENOR-${i}`, precio: 5, consumoAnual: 2, leadTime: 10, proveedores: 5,
    })),
  ];
  const { items } = analizar(filas);
  assert.equal(items.find((i) => i.sku === "DOMINANTE").clase, "A");
  const enA = items.filter((i) => i.clase === "A").length;
  assert.ok(enA <= 4, `con un unico repuesto dominante la clase A debe ser minima, fue ${enA}`);
});

test("concentracionPareto mide la forma real del portafolio", () => {
  const plano = new Array(100).fill(10);
  cerca(concentracionPareto(plano), 0.2, 0.01);           // reparto parejo
  const concentrado = [1000, ...new Array(99).fill(0.01)];
  assert.ok(concentracionPareto(concentrado) > 0.98);      // todo en uno
  assert.equal(concentracionPareto([]), 0);
  assert.equal(concentracionPareto([0, 0, 0]), 0);
});

test("el maestro de embotelladora es coherente y variado", () => {
  const filas = generarEmbotelladora(200);
  assert.equal(filas.length, 200);
  assert.equal(new Set(filas.map((f) => f.sku)).size, 200, "no puede haber SKU repetidos");
  assert.ok(new Set(filas.map((f) => f.categoria)).size >= 15, "debe cubrir toda la planta");
  assert.ok(filas.some((f) => f.stockActual === 0), "debe haber quiebres reales");
  assert.ok(filas.some((f) => f.precio > 10000) && filas.some((f) => f.precio < 5),
    "debe mezclar repuestos de capital y consumibles");
  assert.ok(filas.some((f) => f.leadTime > 120), "debe haber repuestos OEM de importacion larga");
  filas.forEach((f) => {
    assert.ok(f.precio > 0 && Number.isFinite(f.precio), `precio invalido en ${f.sku}`);
    assert.ok(f.consumoAnual >= 0 && f.stockActual >= 0, `cantidades invalidas en ${f.sku}`);
    assert.ok(f.criticidadEquipo >= 1 && f.criticidadEquipo <= 5, `criticidad fuera de rango en ${f.sku}`);
    assert.ok(f.proveedores >= 1, `proveedores invalidos en ${f.sku}`);
  });
});

test("el analisis del maestro de embotelladora no produce NaN", () => {
  const { items, resumen } = analizar(generarEmbotelladora(200));
  assert.equal(items.length, 200);
  assert.ok(resumen.capitalLiberable > 0 && resumen.capitalActual > 0);
  assert.ok(resumen.concentracion > 0 && resumen.concentracion <= 1);
  for (const it of items) {
    for (const [k, v] of Object.entries(it)) {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `NaN en ${it.sku}.${k}`);
    }
  }
});
