/**
 * Prueba de extremo a extremo sobre un navegador real: carga el sitio, corre el
 * flujo completo (ejemplo -> mapeo -> calculo -> limite gratis -> licencia Pro
 * -> exportacion a Excel) y guarda capturas.
 *
 *   node test/interfaz.e2e.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../docs/config.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(RAIZ, "docs");
const CAPTURAS = join(RAIZ, "capturas");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".csv": "text/csv", ".png": "image/png" };

let fallas = 0;
const comprobar = (condicion, mensaje) => {
  console.log(`${condicion ? "  ok  " : " FALLA"} ${mensaje}`);
  if (!condicion) fallas++;
};

const servidor = createServer(async (peticion, respuesta) => {
  try {
    const ruta = peticion.url.split("?")[0];
    const archivo = join(DOCS, ruta === "/" ? "index.html" : decodeURIComponent(ruta));
    if (!archivo.startsWith(DOCS)) { respuesta.writeHead(403).end(); return; }
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] || "application/octet-stream" });
    respuesta.end(contenido);
  } catch {
    respuesta.writeHead(404).end("no encontrado");
  }
});

await new Promise((listo) => servidor.listen(4173, listo));
mkdirSync(CAPTURAS, { recursive: true });

// El contenedor trae Chromium preinstalado; se usa ese binario en vez de
// descargar uno nuevo (PLAYWRIGHT_BROWSERS_PATH puede apuntar a otra revision).
const BINARIO = "/opt/pw-browsers/chromium";
const navegador = await chromium.launch(existsSync(BINARIO) ? { executablePath: BINARIO } : {});
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await contexto.route("**://**", (ruta) => {
  // Se corta todo lo externo a proposito: el producto debe funcionar dentro de
  // la red de una planta, sin CDN ni internet.
  const url = ruta.request().url();
  return url.startsWith("http://localhost:4173") ? ruta.continue() : ruta.abort();
});
const pagina = await contexto.newPage();

const erroresConsola = [];
pagina.on("pageerror", (e) => erroresConsola.push(String(e)));
pagina.on("console", (m) => { if (m.type() === "error") erroresConsola.push(m.text()); });

console.log("\n== Flujo gratuito ==");
await pagina.goto("http://localhost:4173/", { waitUntil: "networkidle" });
comprobar(await pagina.title() !== "", `titulo: ${await pagina.title()}`);
await pagina.screenshot({ path: join(CAPTURAS, "1-portada.png"), fullPage: false });

// --- deteccion automatica de columnas --------------------------------------
const deteccion = await pagina.evaluate(() => {
  const { detectarMapeo, aNumero } = window.__critispare;
  return {
    espanol: detectarMapeo(["SKU", "Descripcion", "Precio unitario", "Consumo anual", "Lead time (dias)", "Stock actual"]),
    ingles: detectarMapeo(["Part Number", "Description", "Unit Cost", "Annual Demand", "Lead Time", "On Hand"]),
    sucio: detectarMapeo(["  código ", "PRECIO UNITARIO $", "Consumo Anual (un)", "Lead-Time"]),
    numeros: [aNumero("US$ 1.234,56"), aNumero("1,234.56"), aNumero("45"), aNumero(""), aNumero("s/i"), aNumero(null)],
  };
});
comprobar(deteccion.espanol.sku === "SKU" && deteccion.espanol.precio === "Precio unitario", "detecta encabezados en espanol");
comprobar(deteccion.ingles.precio === "Unit Cost" && deteccion.ingles.consumoAnual === "Annual Demand", "detecta encabezados en ingles");
comprobar(deteccion.sucio.precio === "PRECIO UNITARIO $" && deteccion.sucio.leadTime === "Lead-Time", "tolera acentos, mayusculas y simbolos");
comprobar(deteccion.numeros[0] === 1234.56, `formato chileno US$ 1.234,56 -> ${deteccion.numeros[0]}`);
comprobar(deteccion.numeros[1] === 1234.56, `formato ingles 1,234.56 -> ${deteccion.numeros[1]}`);
comprobar(deteccion.numeros[3] === null && deteccion.numeros[4] === null && deteccion.numeros[5] === null, "celdas vacias o con texto -> null");

// --- la plantilla que se le manda al cliente debe reconocerse sola ----------
const plantilla = join(RAIZ, "producto", "Plantilla-Datos-Minima.xlsx");
if (existsSync(plantilla)) {
  const { default: XLSX } = await import("xlsx");
  const libro = XLSX.readFile(plantilla);
  const hoja = XLSX.utils.sheet_to_json(libro.Sheets["Datos"], { defval: null });
  const encabezados = Object.keys(hoja[0]).filter((h) => !h.startsWith("__EMPTY"));

  const mapeo = await pagina.evaluate((h) => window.__critispare.detectarMapeo(h), encabezados);
  const obligatorios = ["sku", "precio", "consumoAnual", "leadTime"];
  const opcionales = ["descripcion", "categoria", "criticidadEquipo", "horasParada", "proveedores", "stockActual"];
  comprobar(obligatorios.every((c) => mapeo[c]), `la plantilla del cliente mapea los 4 campos obligatorios: ${obligatorios.map((c) => mapeo[c] || "FALTA").join(", ")}`);
  comprobar(opcionales.every((c) => mapeo[c]), `y tambien los 6 opcionales: ${opcionales.filter((c) => !mapeo[c]).join(", ") || "todos"}`);

  const filas = hoja.filter((f) => f[mapeo.sku]);
  const analisis = await pagina.evaluate(({ filas, mapeo }) => {
    const { CAMPOS, aNumero } = window.__critispare;
    const preparadas = filas.map((f) => {
      const salida = {};
      for (const campo of CAMPOS) {
        const columna = mapeo[campo.clave];
        if (columna) salida[campo.clave] = campo.texto ? f[columna] : aNumero(f[columna]);
      }
      return salida;
    });
    try {
      const r = window.__critispare.analizar(preparadas);
      return { ok: true, n: r.items.length, clases: r.items.map((i) => i.clase) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, { filas, mapeo });
  comprobar(analisis.ok && analisis.n === filas.length,
    `las filas de ejemplo de la plantilla se analizan sin error (${analisis.n ?? analisis.error} de ${filas.length}, clases ${analisis.clases?.join("/")})`);
}

// --- carga del ejemplo y calculo -------------------------------------------
await pagina.click("#btn-ejemplo");
await pagina.waitForSelector("#panel-mapeo:not(.oculto)");
const resumenArchivo = await pagina.textContent("#resumen-archivo");
comprobar(/200 filas/.test(resumenArchivo), `ejemplo por defecto (embotelladora): ${resumenArchivo.trim()}`);

// El segundo maestro de ejemplo debe cargarse igual de solo.
await pagina.selectOption("#set-ejemplo", "planta");
await pagina.click("#btn-ejemplo");
await pagina.waitForFunction(() => /120 filas/.test(document.querySelector("#resumen-archivo").textContent), { timeout: 5000 });
comprobar(true, "se puede cambiar de maestro de ejemplo");
await pagina.selectOption("#set-ejemplo", "embotelladora");
await pagina.click("#btn-ejemplo");
await pagina.waitForFunction(() => /200 filas/.test(document.querySelector("#resumen-archivo").textContent), { timeout: 5000 });
comprobar((await pagina.inputValue("#mapa-precio")) !== "", "mapeo automatico completo sin tocar nada");
await pagina.screenshot({ path: join(CAPTURAS, "2-mapeo.png") });

await pagina.click("#btn-calcular");
await pagina.waitForSelector("#resultados:not(.oculto)");
const kpis = await pagina.$$eval(".kpi .cifra", (n) => n.map((x) => x.textContent.trim()));
comprobar(kpis.length === 4, `4 tarjetas KPI (${kpis.join(" | ")})`);
comprobar(kpis.every((k) => !/NaN|undefined|Infinity/.test(k)), "ningun KPI muestra NaN o undefined");

const filasVisibles = await pagina.$$eval("#resultados tbody tr", (f) => f.length);
comprobar(await pagina.isVisible(".bloqueo"), "aparece el bloqueo de la version gratuita");
const textoBloqueo = await pagina.textContent(".bloqueo");
comprobar(textoBloqueo.includes("200"), "el bloqueo nombra el total real de repuestos del archivo");
comprobar(await pagina.isDisabled("#btn-exportar"), "exportar a Excel esta bloqueado en gratis");
const analizados = Number((await pagina.textContent(".rejilla-kpi .kpi:nth-child(3) .cifra")).replace(/\D/g, ""));
comprobar(analizados === CONFIG.limiteGratis, `la version gratis analiza exactamente ${CONFIG.limiteGratis} (analizo ${analizados})`);
await pagina.screenshot({ path: join(CAPTURAS, "3-resultados-gratis.png"), fullPage: true });

console.log("\n== Activacion de licencia ==");
await pagina.click("#btn-licencia");
await pagina.waitForSelector("#velo-licencia:not(.oculto)");
await pagina.fill("#entrada-licencia", "clave-inventada-por-un-pirata");
await pagina.click("#btn-activar");
await pagina.waitForSelector("#aviso-licencia .aviso.error");
comprobar(!(await pagina.isVisible("#insignia-pro")), "una clave falsa NO desbloquea Pro");
await pagina.screenshot({ path: join(CAPTURAS, "4-licencia-rechazada.png") });

await pagina.click("#btn-demo-licencia");
await pagina.waitForSelector("#aviso-licencia .aviso.exito", { timeout: 5000 });
comprobar(await pagina.isVisible("#insignia-pro"), "la licencia firmada valida desbloquea Pro");
await pagina.waitForSelector("#velo-licencia", { state: "hidden", timeout: 5000 });

console.log("\n== Flujo Pro ==");
await pagina.waitForFunction(
  () => !document.querySelector(".bloqueo") && !document.querySelector("#btn-exportar").disabled,
  { timeout: 5000 }
);
const analizadosPro = Number((await pagina.textContent(".rejilla-kpi .kpi:nth-child(3) .cifra")).replace(/\D/g, ""));
comprobar(analizadosPro === 200, `Pro analiza el maestro completo (${analizadosPro} de 200)`);
comprobar(!(await pagina.isDisabled("#btn-exportar")), "exportar a Excel queda habilitado");
const filasPro = await pagina.$$eval("#resultados tbody tr", (f) => f.length);
comprobar(filasPro > filasVisibles, `la tabla crece de ${filasVisibles} a ${filasPro} filas`);
const textoABC = await pagina.textContent("#resultados");
comprobar(/concentra el \d+%/.test(textoABC), "se informa la concentracion real del portafolio");
await pagina.screenshot({ path: join(CAPTURAS, "5-resultados-pro.png"), fullPage: true });

const descarga = await Promise.all([
  pagina.waitForEvent("download", { timeout: 15000 }),
  pagina.click("#btn-exportar"),
]).then(([d]) => d);
const destino = join(CAPTURAS, "informe-critispare.xlsx");
await descarga.saveAs(destino);
comprobar(existsSync(destino) && /\.xlsx$/.test(descarga.suggestedFilename()), `Excel descargado: ${descarga.suggestedFilename()}`);

console.log("\n== Persistencia y robustez ==");
await pagina.reload({ waitUntil: "networkidle" });
await pagina.waitForFunction(() => !document.querySelector("#insignia-pro").classList.contains("oculto"), { timeout: 5000 });
comprobar(true, "la licencia sobrevive a recargar la pagina");

await pagina.evaluate(() => localStorage.setItem("critispare.licencia", "basura.basura"));
await pagina.reload({ waitUntil: "networkidle" });
await pagina.waitForTimeout(600);
comprobar(!(await pagina.isVisible("#insignia-pro")), "una licencia adulterada en localStorage se descarta");

// --- vista movil ------------------------------------------------------------
const movil = await contexto.newPage();
await movil.setViewportSize({ width: 390, height: 844 });
await movil.goto("http://localhost:4173/", { waitUntil: "networkidle" });
const desborde = await movil.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
comprobar(desborde <= 1, `no hay desborde horizontal en movil (${desborde}px)`);
await movil.screenshot({ path: join(CAPTURAS, "6-movil.png") });

comprobar(erroresConsola.length === 0, `sin errores de consola${erroresConsola.length ? `: ${erroresConsola.slice(0, 3).join(" | ")}` : ""}`);

await navegador.close();
servidor.close();
console.log(`\n${fallas === 0 ? "TODO OK" : `${fallas} FALLAS`}\n`);
process.exit(fallas === 0 ? 0 : 1);
