/**
 * CritiSpare - Motor de criticidad de repuestos.
 *
 * Metodo: pesos objetivos por Entropia de Shannon -> ranking multicriterio TOPSIS
 * -> segmentacion en familias por k-means (k elegido por silueta) -> clasificacion
 * ABC por impacto de Pareto -> politica de revision periodica (R,S) por clase.
 *
 * Modulo ESM puro, sin dependencias: corre igual en Node y en el navegador.
 */

// ---------------------------------------------------------------------------
// Utilidades numericas
// ---------------------------------------------------------------------------

/** PRNG determinista (mulberry32) para que k-means sea reproducible. */
export function prng(semilla = 42) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const suma = (xs) => xs.reduce((a, b) => a + b, 0);
export const promedio = (xs) => (xs.length ? suma(xs) / xs.length : 0);

export function desviacion(xs) {
  if (xs.length < 2) return 0;
  const m = promedio(xs);
  return Math.sqrt(suma(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

function columna(matriz, j) {
  return matriz.map((fila) => fila[j]);
}

/** Normalizacion min-max a [0,1]; columna constante -> 0.5 en todas sus celdas. */
export function minMax(matriz) {
  const nCols = matriz[0].length;
  return matriz.map((fila) =>
    fila.map((v, j) => {
      const col = columna(matriz, j);
      const min = Math.min(...col);
      const max = Math.max(...col);
      return max - min < 1e-12 ? 0.5 : (v - min) / (max - min);
    })
  );
}

// ---------------------------------------------------------------------------
// Pesos por entropia de Shannon
// ---------------------------------------------------------------------------

/**
 * Pesos objetivos: un criterio que discrimina poco entre repuestos pesa poco.
 * Elimina el sesgo de "yo creo que el lead time vale 30%".
 *
 * @param {number[][]} matriz filas = repuestos, columnas = criterios (valores crudos)
 * @returns {number[]} pesos que suman 1
 */
export function pesosEntropia(matriz) {
  const m = matriz.length;
  const n = matriz[0].length;
  if (m < 2) return new Array(n).fill(1 / n);

  const norm = minMax(matriz);
  const eps = 1e-9;
  const k = 1 / Math.log(m);
  const divergencias = [];

  for (let j = 0; j < n; j++) {
    const col = columna(norm, j).map((v) => v + eps);
    const total = suma(col);
    const entropia = -k * suma(col.map((v) => {
      const p = v / total;
      return p * Math.log(p);
    }));
    divergencias.push(Math.max(0, 1 - entropia));
  }

  const totalDiv = suma(divergencias);
  // Todos los criterios constantes: no hay informacion, se reparte parejo.
  if (totalDiv < 1e-12) return new Array(n).fill(1 / n);
  return divergencias.map((d) => d / totalDiv);
}

// ---------------------------------------------------------------------------
// TOPSIS
// ---------------------------------------------------------------------------

/**
 * @param {number[][]} matriz filas = repuestos, columnas = criterios
 * @param {("beneficio"|"costo")[]} sentidos 'beneficio' = mas alto es mas critico
 * @param {number[]} [pesos] si se omite, se calculan por entropia
 * @returns {{indices:number[], pesos:number[], idealPos:number[], idealNeg:number[]}}
 */
export function topsis(matriz, sentidos, pesos) {
  const m = matriz.length;
  const n = matriz[0].length;
  const w = pesos && pesos.length === n ? pesos : pesosEntropia(matriz);

  // Normalizacion vectorial de Hwang & Yoon.
  const normas = [];
  for (let j = 0; j < n; j++) {
    const norma = Math.sqrt(suma(columna(matriz, j).map((v) => v * v)));
    normas.push(norma < 1e-12 ? 1 : norma);
  }
  const v = matriz.map((fila) => fila.map((x, j) => (x / normas[j]) * w[j]));

  const idealPos = [];
  const idealNeg = [];
  for (let j = 0; j < n; j++) {
    const col = columna(v, j);
    const max = Math.max(...col);
    const min = Math.min(...col);
    if (sentidos[j] === "costo") {
      idealPos.push(min);
      idealNeg.push(max);
    } else {
      idealPos.push(max);
      idealNeg.push(min);
    }
  }

  const indices = v.map((fila) => {
    const dPos = Math.sqrt(suma(fila.map((x, j) => (x - idealPos[j]) ** 2)));
    const dNeg = Math.sqrt(suma(fila.map((x, j) => (x - idealNeg[j]) ** 2)));
    const den = dPos + dNeg;
    return den < 1e-12 ? 0.5 : dNeg / den;
  });

  return { indices, pesos: w, idealPos, idealNeg };
}

// ---------------------------------------------------------------------------
// k-means + silueta
// ---------------------------------------------------------------------------

export function estandarizar(matriz) {
  const n = matriz[0].length;
  const medias = [];
  const sigmas = [];
  for (let j = 0; j < n; j++) {
    const col = columna(matriz, j);
    medias.push(promedio(col));
    const s = desviacion(col);
    sigmas.push(s < 1e-12 ? 1 : s);
  }
  return matriz.map((fila) => fila.map((x, j) => (x - medias[j]) / sigmas[j]));
}

const dist2 = (a, b) => suma(a.map((x, i) => (x - b[i]) ** 2));

/** k-means con inicializacion k-means++ y semilla fija (resultados reproducibles). */
export function kmeans(datos, k, { semilla = 42, maxIter = 100 } = {}) {
  const m = datos.length;
  if (k >= m) {
    return { asignaciones: datos.map((_, i) => i % k), centroides: datos.slice(0, k), inercia: 0 };
  }
  const rnd = prng(semilla);

  // k-means++
  const centroides = [datos[Math.floor(rnd() * m)].slice()];
  while (centroides.length < k) {
    const d = datos.map((p) => Math.min(...centroides.map((c) => dist2(p, c))));
    const total = suma(d);
    let objetivo = rnd() * (total || 1);
    let idx = 0;
    for (let i = 0; i < m; i++) {
      objetivo -= d[i];
      if (objetivo <= 0) { idx = i; break; }
      idx = i;
    }
    centroides.push(datos[idx].slice());
  }

  let asignaciones = new Array(m).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let cambio = false;
    for (let i = 0; i < m; i++) {
      let mejor = 0;
      let mejorD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(datos[i], centroides[c]);
        if (d < mejorD) { mejorD = d; mejor = c; }
      }
      if (asignaciones[i] !== mejor) { asignaciones[i] = mejor; cambio = true; }
    }
    for (let c = 0; c < k; c++) {
      const miembros = datos.filter((_, i) => asignaciones[i] === c);
      if (!miembros.length) continue;
      centroides[c] = miembros[0].map((_, j) => promedio(miembros.map((p) => p[j])));
    }
    if (!cambio) break;
  }

  const inercia = suma(datos.map((p, i) => dist2(p, centroides[asignaciones[i]])));
  return { asignaciones, centroides, inercia };
}

/** Coeficiente de silueta promedio. Devuelve -1 si el clustering es degenerado. */
export function silueta(datos, asignaciones) {
  const m = datos.length;
  const grupos = new Map();
  asignaciones.forEach((c, i) => {
    if (!grupos.has(c)) grupos.set(c, []);
    grupos.get(c).push(i);
  });
  if (grupos.size < 2) return -1;

  const valores = datos.map((p, i) => {
    const propio = grupos.get(asignaciones[i]);
    if (propio.length <= 1) return 0;
    const a = promedio(propio.filter((j) => j !== i).map((j) => Math.sqrt(dist2(p, datos[j]))));
    let b = Infinity;
    for (const [c, miembros] of grupos) {
      if (c === asignaciones[i]) continue;
      b = Math.min(b, promedio(miembros.map((j) => Math.sqrt(dist2(p, datos[j])))));
    }
    return (b - a) / Math.max(a, b);
  });
  return promedio(valores);
}

/** Elige k en [2, kMax] maximizando la silueta. Con pocos datos devuelve k=1. */
export function elegirK(datos, kMax = 5, semilla = 42) {
  const m = datos.length;
  const techo = Math.min(kMax, m - 1);
  if (m < 6 || techo < 2) return { k: 1, silueta: 0, curva: [] };

  const curva = [];
  let mejor = { k: 1, silueta: -Infinity };
  for (let k = 2; k <= techo; k++) {
    const { asignaciones } = kmeans(datos, k, { semilla });
    const s = silueta(datos, asignaciones);
    curva.push({ k, silueta: s });
    if (s > mejor.silueta) mejor = { k, silueta: s };
  }
  return { ...mejor, curva };
}

// ---------------------------------------------------------------------------
// Politica de inventario (R,S) por clase
// ---------------------------------------------------------------------------

/** Nivel de servicio -> factor z (aproximacion de Acklam, error < 1e-4). */
export function zDeServicio(p) {
  if (p <= 0) return -4;
  if (p >= 1) return 4;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
             138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
             66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pBajo = 0.02425;
  let q, r;
  if (p < pBajo) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pBajo) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export const PARAMETROS_CLASE = {
  A: { servicio: 0.99, revisionDias: 7 },
  B: { servicio: 0.95, revisionDias: 15 },
  C: { servicio: 0.90, revisionDias: 30 },
};

/**
 * Politica de revision periodica (R,S).
 * Periodo de proteccion = R + L. S cubre la demanda esperada de ese periodo mas
 * el stock de seguridad correspondiente al nivel de servicio de la clase.
 */
export function politicaRS(item, clase, { cvDemanda = 0.5, diasAnio = 360 } = {}) {
  const { servicio, revisionDias: R } = PARAMETROS_CLASE[clase] ?? PARAMETROS_CLASE.C;
  const L = Math.max(0, Number(item.leadTime) || 0);
  const D = Math.max(0, Number(item.consumoAnual) || 0);
  const dDiaria = D / diasAnio;
  const proteccion = R + L;

  const sigmaDiaria = dDiaria * cvDemanda;
  const z = zDeServicio(servicio);
  const stockSeguridad = z * sigmaDiaria * Math.sqrt(proteccion);
  const S = dDiaria * proteccion + stockSeguridad;

  // Con revision periodica el stock medio es SS + media de la demanda del periodo R.
  const stockMedio = stockSeguridad + (dDiaria * R) / 2;

  return {
    clase,
    servicioObjetivo: servicio,
    revisionDias: R,
    leadTime: L,
    demandaDiaria: dDiaria,
    stockSeguridad: Math.max(0, Math.ceil(stockSeguridad)),
    nivelObjetivoS: Math.max(1, Math.ceil(S)),
    stockMedio: Math.max(0, stockMedio),
    capitalPropuesto: Math.max(0, stockMedio) * (Number(item.precio) || 0),
  };
}

// ---------------------------------------------------------------------------
// Clasificacion ABC por impacto de Pareto
// ---------------------------------------------------------------------------

/**
 * Impacto = indice de criticidad x valor de consumo anual. Se ordena de mayor a
 * menor y se corta por porcentaje acumulado: A hasta 80%, B hasta 95%, C el resto.
 */
export function clasificarABC(items, indices, cortes = { A: 0.8, B: 0.95 }) {
  const impactos = items.map((it, i) => {
    const valorAnual = (Number(it.consumoAnual) || 0) * (Number(it.precio) || 0);
    // El piso evita que un repuesto de consumo cero pero criticidad alta quede invisible.
    return { i, impacto: indices[i] * Math.max(valorAnual, 1) };
  });
  const total = suma(impactos.map((x) => x.impacto)) || 1;
  const orden = [...impactos].sort((a, b) => b.impacto - a.impacto);

  const clases = new Array(items.length).fill("C");
  let acumulado = 0;
  for (const { i, impacto } of orden) {
    acumulado += impacto / total;
    clases[i] = acumulado <= cortes.A ? "A" : acumulado <= cortes.B ? "B" : "C";
  }
  // Garantiza al menos un repuesto en A cuando hay datos.
  if (items.length && !clases.includes("A")) clases[orden[0].i] = "A";
  return clases;
}

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

/** Criterios soportados. sentido 'costo' = valor alto REDUCE la criticidad. */
export const CRITERIOS = [
  { clave: "precio",           etiqueta: "Precio unitario",        sentido: "beneficio" },
  { clave: "consumoAnual",     etiqueta: "Consumo anual",          sentido: "beneficio" },
  { clave: "leadTime",         etiqueta: "Lead time (días)",       sentido: "beneficio" },
  { clave: "criticidadEquipo", etiqueta: "Criticidad del equipo",  sentido: "beneficio" },
  { clave: "horasParada",      etiqueta: "Horas de parada si falla", sentido: "beneficio" },
  { clave: "proveedores",      etiqueta: "N.º de proveedores",       sentido: "costo" },
];

/** Atributos usados para agrupar familias (perfil de demanda y valor). */
const EJES_FAMILIA = ["precio", "consumoAnual", "leadTime"];

/**
 * Analisis completo.
 * @param {object[]} filas repuestos con las claves de CRITERIOS + sku, descripcion, stockActual
 * @param {object} config
 * @returns {{items:object[], pesos:object[], familias:object[], resumen:object}}
 */
export function analizar(filas, config = {}) {
  const { cvDemanda = 0.5, kMax = 5, semilla = 42, criterios = CRITERIOS } = config;
  if (!Array.isArray(filas) || filas.length === 0) {
    throw new Error("No hay repuestos para analizar.");
  }

  const usados = criterios.filter((c) =>
    filas.some((f) => Number.isFinite(Number(f[c.clave])))
  );
  if (usados.length < 2) {
    throw new Error("Se necesitan al menos 2 criterios numéricos con datos.");
  }

  const matriz = filas.map((f) =>
    usados.map((c) => {
      const v = Number(f[c.clave]);
      return Number.isFinite(v) ? Math.max(v, 0) : 0;
    })
  );

  const { indices, pesos } = topsis(matriz, usados.map((c) => c.sentido));

  // Familias sobre el perfil de demanda/valor, no sobre el indice ya calculado.
  const ejes = EJES_FAMILIA.filter((e) => usados.some((c) => c.clave === e));
  let familiaDe = new Array(filas.length).fill(0);
  let seleccionK = { k: 1, silueta: 0, curva: [] };
  if (ejes.length >= 2) {
    // log1p comprime las colas largas tipicas de precio y consumo de repuestos.
    const datos = estandarizar(
      filas.map((f) => ejes.map((e) => Math.log1p(Math.max(0, Number(f[e]) || 0))))
    );
    seleccionK = elegirK(datos, kMax, semilla);
    if (seleccionK.k > 1) {
      familiaDe = kmeans(datos, seleccionK.k, { semilla }).asignaciones;
    }
  }

  const clases = clasificarABC(filas, indices);

  const items = filas.map((f, i) => {
    const politica = politicaRS(f, clases[i], { cvDemanda });
    const precio = Number(f.precio) || 0;
    const stockActual = Number.isFinite(Number(f.stockActual)) ? Number(f.stockActual) : null;
    const capitalActual = stockActual === null ? null : stockActual * precio;
    return {
      ...f,
      indiceCriticidad: indices[i],
      clase: clases[i],
      familia: familiaDe[i] + 1,
      ...politica,
      capitalActual,
      // Exceso: lo que sobra por encima del nivel objetivo S.
      excesoUnidades: stockActual === null ? null : Math.max(0, stockActual - politica.nivelObjetivoS),
      capitalLiberable: stockActual === null ? 0 : Math.max(0, stockActual - politica.nivelObjetivoS) * precio,
      // Riesgo: bajo el stock de seguridad de su clase.
      enRiesgo: stockActual === null ? false : stockActual < politica.stockSeguridad,
    };
  });

  items.sort((a, b) => b.indiceCriticidad - a.indiceCriticidad);

  const familias = [];
  for (let k = 1; k <= (seleccionK.k || 1); k++) {
    const miembros = items.filter((it) => it.familia === k);
    if (!miembros.length) continue;
    familias.push({
      id: k,
      n: miembros.length,
      precioMedio: promedio(miembros.map((m) => Number(m.precio) || 0)),
      consumoMedio: promedio(miembros.map((m) => Number(m.consumoAnual) || 0)),
      leadTimeMedio: promedio(miembros.map((m) => Number(m.leadTime) || 0)),
      criticidadMedia: promedio(miembros.map((m) => m.indiceCriticidad)),
    });
  }

  const conStock = items.filter((it) => it.capitalActual !== null);
  const resumen = {
    n: items.length,
    porClase: { A: 0, B: 0, C: 0 },
    k: seleccionK.k || 1,
    silueta: seleccionK.silueta,
    curvaK: seleccionK.curva,
    capitalActual: suma(conStock.map((it) => it.capitalActual)),
    capitalPropuesto: suma(conStock.map((it) => it.capitalPropuesto)),
    capitalLiberable: suma(items.map((it) => it.capitalLiberable)),
    enRiesgo: items.filter((it) => it.enRiesgo).length,
    riesgoClaseA: items.filter((it) => it.enRiesgo && it.clase === "A").length,
    tieneStock: conStock.length > 0,
  };
  items.forEach((it) => { resumen.porClase[it.clase]++; });

  return {
    items,
    pesos: usados.map((c, j) => ({ ...c, peso: pesos[j] })),
    familias,
    resumen,
  };
}
