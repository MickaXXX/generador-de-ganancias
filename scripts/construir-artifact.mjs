/**
 * Empaqueta el sitio completo en un solo archivo HTML autocontenido, listo para
 * publicar como Artifact (una URL que funciona al instante, sin configurar nada).
 *
 * Inlinea estilos, los tres modulos ES, SheetJS y el CSV de ejemplo, de modo que
 * la pagina no depende de ningun archivo externo ni de ninguna CDN.
 *
 *   node scripts/construir-artifact.mjs [destino.html]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta) => readFileSync(resolve(RAIZ, ruta), "utf8");

/** Convierte un modulo ES en codigo plano concatenable. */
function aplanarModulo(codigo) {
  return codigo
    .replace(/^\s*import\s[^;]*;\s*$/gm, "")
    .replace(/^export\s+(?=(async\s+function|function|const|let|class))/gm, "")
    .trimEnd();
}

/**
 * Deja el codigo apto para ir dentro de un <script> inline:
 * - evita que un "</script" literal cierre la etiqueta antes de tiempo;
 * - escapa el caracter de reemplazo U+FFFD, que SheetJS usa a miles en sus
 *   tablas de codigos y que los publicadores de HTML rechazan como texto crudo.
 */
const seguroEnScript = (texto) =>
  texto.replace(/<\/script/gi, "<\\/script").replace(/\uFFFD/g, "\\ufffd");

function construir() {
  const html = leer("docs/index.html");
  const cuerpo = html.match(/<body>([\s\S]*)<\/body>/)[1];
  // El Artifact se identifica por su nombre de producto; la version del sitio
  // conserva el titulo largo, que ahi sirve para buscadores.
  const titulo = "CritiSpare";

  // Se quitan del cuerpo las etiquetas que el envoltorio del Artifact ya aporta.
  const contenido = cuerpo
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "")
    .replace(/<script type="module"[^>]*><\/script>/g, "")
    .trim();

  const sheetjs = leer("docs/vendor/xlsx.full.min.js");
  const csvEjemplo = leer("docs/ejemplo-repuestos.csv");

  const aplicacion = [
    aplanarModulo(leer("docs/core/criticidad.js")),
    aplanarModulo(leer("docs/core/licencia.js")),
    aplanarModulo(leer("docs/config.js")),
    aplanarModulo(leer("docs/app.js"))
      // El CSV viaja incrustado: no hay servidor del que descargarlo.
      .replace(
        /const respuesta = await fetch\("ejemplo-repuestos\.csv"\);\s*\n\s*if \(!respuesta\.ok\)[^\n]*\n\s*const texto = await respuesta\.text\(\);/,
        "const texto = CSV_EJEMPLO;"
      ),
  ].join("\n\n");

  if (aplicacion.includes('fetch("ejemplo-repuestos.csv")')) {
    throw new Error("No se pudo incrustar el CSV de ejemplo: revisa cargarEjemplo() en app.js");
  }
  for (const senal of ["export ", "import {"]) {
    if (aplicacion.includes(`\n${senal}`)) throw new Error(`Quedo un "${senal}" sin aplanar.`);
  }

  const salida = `<title>${titulo}</title>
<style>
${leer("docs/styles.css")}
</style>

${contenido}

<script>
${seguroEnScript(sheetjs)}
</script>
<script>
const CSV_EJEMPLO = ${JSON.stringify(csvEjemplo)};

${seguroEnScript(aplicacion)}
</script>
`;
  return salida;
}

const destino = resolve(RAIZ, process.argv[2] || "dist/critispare.html");
mkdirSync(dirname(destino), { recursive: true });
const salida = construir();
writeFileSync(destino, salida, "utf8");
console.log(`OK  ${destino}  (${Math.round(salida.length / 1024)} KB, un solo archivo sin dependencias externas)`);
