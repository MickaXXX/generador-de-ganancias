/**
 * Genera un maestro de repuestos sintetico pero realista (planta industrial /
 * mineria) para demo, pruebas y para el archivo de ejemplo del sitio.
 * Determinista: misma semilla, mismos datos.
 */
import { prng } from "../docs/core/criticidad.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

const CATALOGO = [
  ["Rodamiento rigido de bolas 6210",       "Rodamientos",  85,    12,  4,  3],
  ["Rodamiento a rodillos conicos 32216",   "Rodamientos",  240,   21,  3,  2],
  ["Sello mecanico bomba centrifuga 3x2",   "Sellos",       420,   35,  5,  2],
  ["Sello mecanico cartucho API 682",       "Sellos",       1850,  75,  5,  1],
  ["Correa en V C-120",                     "Transmision",  38,    9,   2,  4],
  ["Correa dentada HTD 8M-1600",            "Transmision",  145,   28,  3,  2],
  ["Filtro hidraulico 10 micrones",         "Filtracion",   62,    14,  3,  4],
  ["Cartucho filtrante 5 um 40\"",          "Filtracion",   28,    18,  3,  5],
  ["Membrana osmosis inversa 8040",         "Tratamiento",  680,   65,  5,  2],
  ["Resina cationica fuerte (saco 25L)",    "Tratamiento",  310,   45,  4,  2],
  ["Valvula mariposa DN150 wafer",          "Valvulas",     540,   40,  4,  3],
  ["Valvula de bola inox 2\" 3 piezas",     "Valvulas",     195,   22,  3,  4],
  ["Actuador neumatico doble efecto",       "Valvulas",     880,   55,  4,  2],
  ["Motor electrico 15 kW 4 polos",         "Motores",      2400,  60,  5,  2],
  ["Motor electrico 55 kW 4 polos",         "Motores",      7200,  95,  5,  1],
  ["Bomba centrifuga 65-200 (repuesto)",    "Bombas",       5400,  110, 5,  1],
  ["Impulsor bomba 65-200",                 "Bombas",       1250,  70,  5,  2],
  ["Variador de frecuencia 22 kW",          "Electrico",    3100,  85,  5,  1],
  ["Contactor tripolar 65 A",               "Electrico",    120,   16,  3,  4],
  ["Rele termico 30-40 A",                  "Electrico",    75,    14,  3,  4],
  ["Tarjeta PLC entradas analogicas",       "Instrumentos", 1450,  90,  5,  1],
  ["Transmisor de presion 0-10 bar",        "Instrumentos", 480,   38,  4,  3],
  ["Sensor de flujo electromagnetico DN80", "Instrumentos", 2200,  75,  5,  1],
  ["Sensor de nivel ultrasonico",           "Instrumentos", 950,   50,  4,  2],
  ["Manguera hidraulica R2 1\" (metro)",    "Fluidos",      22,    7,   1,  5],
  ["Acople flexible tipo grilla",           "Transmision",  260,   30,  3,  3],
  ["Empaquetadura grafitada (kg)",          "Sellos",       95,    20,  2,  4],
  ["Piston neumatico ISO 63x200",           "Neumatica",    340,   26,  3,  3],
  ["Electrovalvula 5/2 24 VDC",             "Neumatica",    130,   18,  3,  4],
  ["Compresor de aire (kit reparacion)",    "Neumatica",    1600,  70,  5,  2],
  ["Reductor de velocidad i=20",            "Transmision",  4100,  100, 5,  1],
  ["Chumacera SNL 517",                     "Rodamientos",  380,   32,  3,  3],
  ["Bomba dosificadora de diafragma",       "Dosificacion", 1750,  58,  4,  2],
  ["Diafragma PTFE bomba dosificadora",     "Dosificacion", 210,   30,  4,  3],
  ["Manometro glicerina 0-16 bar",          "Instrumentos", 45,    10,  2,  5],
  ["Kit retenes caja reductora",            "Transmision",  175,   25,  3,  3],
  ["Cadena de rodillos ASA 80 (metro)",     "Transmision",  58,    15,  2,  4],
  ["Pinon Z=25 paso 1\"",                   "Transmision",  190,   28,  3,  3],
  ["Ventilador axial 400 mm",               "Ventilacion",  520,   42,  3,  2],
  ["Intercambiador de placas (placa)",      "Termico",      165,   48,  4,  2],
];

/**
 * @param {number} n cantidad de SKUs
 * @param {number} semilla
 * @returns {object[]}
 */
export function generarRepuestos(n = 120, semilla = 7) {
  const rnd = prng(semilla);
  const filas = [];
  for (let i = 0; i < n; i++) {
    const base = CATALOGO[i % CATALOGO.length];
    const [descBase, familia, precioBase, ltBase, critEquipo, provBase] = base;
    const variante = Math.floor(i / CATALOGO.length);

    const precio = Math.round(precioBase * (0.7 + rnd() * 0.8) * 100) / 100;
    const leadTime = Math.max(3, Math.round(ltBase * (0.6 + rnd() * 0.9)));
    const proveedores = Math.max(1, provBase + (rnd() < 0.3 ? -1 : 0));
    // Los repuestos caros y de equipos criticos rotan menos: correlacion negativa.
    const rotacionBase = Math.max(0.5, 400 / Math.sqrt(precio));
    const consumoAnual = Math.max(0, Math.round(rotacionBase * (0.3 + rnd() * 1.7)));
    const horasParada = Math.round(critEquipo * (2 + rnd() * 10));

    // Politica "a ojo" tipica: entre 1 y 5 meses de consumo, sin considerar lead
    // time ni criticidad. De ahi salen a la vez el sobrestock y los quiebres.
    const politicaIngenua = Math.ceil((consumoAnual / 12) * (1 + rnd() * 4));
    const sorteo = rnd();
    const stockActual =
      sorteo < 0.10 ? 0                                              // quiebre
      : sorteo < 0.22 ? Math.floor(politicaIngenua * 0.15 * rnd())   // bajo cobertura
      : Math.max(0, politicaIngenua + Math.round((rnd() - 0.3) * politicaIngenua));

    filas.push({
      sku: `SP-${String(1000 + i)}`,
      descripcion: variante ? `${descBase} (var. ${variante + 1})` : descBase,
      categoria: familia,
      precio,
      consumoAnual,
      leadTime,
      criticidadEquipo: critEquipo,
      horasParada,
      proveedores,
      stockActual,
    });
  }
  return filas;
}

export const COLUMNAS = [
  "sku", "descripcion", "categoria", "precio", "consumoAnual",
  "leadTime", "criticidadEquipo", "horasParada", "proveedores", "stockActual",
];

const ENCABEZADOS_ES = {
  sku: "SKU", descripcion: "Descripcion", categoria: "Categoria",
  precio: "Precio unitario", consumoAnual: "Consumo anual", leadTime: "Lead time (dias)",
  criticidadEquipo: "Criticidad equipo (1-5)", horasParada: "Horas parada si falla",
  proveedores: "N proveedores", stockActual: "Stock actual",
};

export function aCSV(filas) {
  const escapar = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecera = COLUMNAS.map((c) => ENCABEZADOS_ES[c]).join(",");
  const cuerpo = filas.map((f) => COLUMNAS.map((c) => escapar(f[c])).join(","));
  return [cabecera, ...cuerpo].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2]) || 120;
  const destino = resolve(AQUI, "../docs/ejemplo-repuestos.csv");
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, aCSV(generarRepuestos(n)), "utf8");
  console.log(`OK ${n} repuestos -> ${destino}`);
}
