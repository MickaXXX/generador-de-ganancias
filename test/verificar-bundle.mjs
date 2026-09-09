import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

// Se reproduce el envoltorio que el publicador agrega alrededor del archivo.
const cuerpo = readFileSync("dist/critispare.html", "utf8");
const pagina = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>${cuerpo}</body></html>`;

const servidor = createServer((q, r) => {
  r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  r.end(pagina);
});
await new Promise((l) => servidor.listen(4174, l));

const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await navegador.newContext({ viewport: { width: 1400, height: 950 } });
// Sin red externa: el archivo debe bastarse solo.
await ctx.route("**://**", (ruta) => ruta.request().url().startsWith("http://localhost:4174") ? ruta.continue() : ruta.abort());
const p = await ctx.newPage();
const errores = [];
p.on("pageerror", (e) => errores.push(String(e)));
p.on("console", (m) => m.type() === "error" && errores.push(m.text()));

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : " FALLA"} ${m}`); if (!c) fallas++; };

await p.goto("http://localhost:4174/", { waitUntil: "networkidle" });
ok(await p.isVisible("#zona-carga"), "la pagina carga");
await p.click("#btn-ejemplo");
await p.waitForSelector("#panel-mapeo:not(.oculto)", { timeout: 10000 });
ok(/200 filas/.test(await p.textContent("#resumen-archivo")), "el CSV de embotelladora incrustado se lee sin red");
await p.click("#btn-calcular");
await p.waitForSelector("#resultados:not(.oculto)", { timeout: 10000 });
const kpis = await p.$$eval(".kpi .cifra", (n) => n.map((x) => x.textContent.trim()));
ok(kpis.length === 4 && !kpis.some((k) => /NaN|undefined/.test(k)), `KPIs: ${kpis.join(" | ")}`);
ok(await p.isVisible(".bloqueo"), "el limite gratuito sigue activo");
await p.click("#btn-licencia");
await p.click("#btn-demo-licencia");
await p.waitForSelector("#aviso-licencia .aviso.exito", { timeout: 8000 });
ok(await p.isVisible("#insignia-pro"), "la licencia de demo desbloquea Pro");
await p.waitForFunction(() => !document.querySelector("#btn-exportar").disabled, { timeout: 8000 });
ok(true, "la exportacion a Excel queda habilitada");
ok(errores.length === 0, `sin errores de consola${errores.length ? ": " + errores.slice(0, 2).join(" | ") : ""}`);
await p.screenshot({ path: "capturas/7-artifact.png", fullPage: false });

await navegador.close();
servidor.close();
console.log(fallas ? `\n${fallas} FALLAS\n` : "\nBUNDLE OK\n");
process.exit(fallas ? 1 : 0);
