import { CONFIG } from "./config.js";
import { analizar, CRITERIOS } from "./core/criticidad.js";
import { verificarLicencia, verificarGumroad } from "./core/licencia.js";

// ---------------------------------------------------------------------------
// Estado y utilidades
// ---------------------------------------------------------------------------

const estado = {
  filas: [],          // filas crudas del archivo
  encabezados: [],
  mapeo: {},          // campo interno -> nombre de columna del archivo
  resultado: null,
  pro: false,
  cliente: null,
  nombreArchivo: "",
};

const $ = (sel) => document.querySelector(sel);
const crear = (etiqueta, props = {}) => Object.assign(document.createElement(etiqueta), props);
const LLAVE_LICENCIA = "critispare.licencia";

const fMoneda = new Intl.NumberFormat("es-CL", {
  style: "currency", currency: CONFIG.moneda, maximumFractionDigits: 0,
});
const fNumero = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const dinero = (n) => fMoneda.format(Number.isFinite(n) ? n : 0);
const numero = (n) => fNumero.format(Number.isFinite(n) ? n : 0);

function aviso(contenedor, texto, tipo = "error") {
  $(contenedor).innerHTML = texto ? `<div class="aviso ${tipo}">${texto}</div>` : "";
}

// ---------------------------------------------------------------------------
// Deteccion automatica de columnas
// ---------------------------------------------------------------------------

/** Campos que la app entiende. `texto: true` = no es un criterio numerico. */
const CAMPOS = [
  { clave: "sku",              etiqueta: "SKU / Código",            texto: true, obligatorio: true,
    alias: ["sku", "codigo", "cod", "item", "material", "parte", "partnumber", "numeroparte", "id"] },
  { clave: "descripcion",      etiqueta: "Descripción",             texto: true,
    alias: ["descripcion", "description", "detalle", "nombre", "denominacion", "texto"] },
  { clave: "categoria",        etiqueta: "Categoría / Familia",     texto: true,
    alias: ["categoria", "category", "familia", "grupo", "tipo", "clase"] },
  { clave: "precio",           etiqueta: "Precio unitario",         obligatorio: true,
    alias: ["precio", "preciounitario", "costo", "costounitario", "valor", "valorunitario", "price", "unitcost"] },
  { clave: "consumoAnual",     etiqueta: "Consumo anual",           obligatorio: true,
    alias: ["consumoanual", "consumo", "demanda", "demandaanual", "salidas", "rotacion", "usoanual", "annualdemand", "usage"] },
  { clave: "leadTime",         etiqueta: "Lead time (días)",        obligatorio: true,
    alias: ["leadtime", "leadtimedias", "plazoentrega", "tiempoentrega", "plazo", "diasentrega", "lt"] },
  { clave: "criticidadEquipo", etiqueta: "Criticidad del equipo",
    alias: ["criticidadequipo", "criticidad", "criticidadequipo15", "criticalidad", "equipmentcriticality", "criticality"] },
  { clave: "horasParada",      etiqueta: "Horas de parada si falla",
    alias: ["horasparada", "horasdeparada", "downtime", "tiempoparada", "horasparadasifalla", "mtti"] },
  { clave: "proveedores",      etiqueta: "N.º de proveedores",
    alias: ["proveedores", "nproveedores", "numeroproveedores", "suppliers", "fuentes", "cantidadproveedores"] },
  { clave: "stockActual",      etiqueta: "Stock actual",
    alias: ["stockactual", "stock", "existencia", "existencias", "saldo", "inventario", "cantidad", "onhand", "qty"] },
];

const normalizar = (s) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

/** Empareja cada campo con la columna mas parecida del archivo. */
function detectarMapeo(encabezados) {
  const mapeo = {};
  const usadas = new Set();
  const normalizados = encabezados.map((h) => ({ original: h, norma: normalizar(h) }));

  for (const campo of CAMPOS) {
    // Primero coincidencia exacta, despues por contencion (mas fragil).
    let hallazgo = normalizados.find((h) => !usadas.has(h.original) && campo.alias.includes(h.norma));
    if (!hallazgo) {
      hallazgo = normalizados.find((h) =>
        !usadas.has(h.original) && h.norma.length > 2 &&
        campo.alias.some((a) => a.length > 3 && (h.norma.includes(a) || a.includes(h.norma)))
      );
    }
    if (hallazgo) { mapeo[campo.clave] = hallazgo.original; usadas.add(hallazgo.original); }
  }
  return mapeo;
}

/** Convierte texto de planilla a numero tolerando $ . , y espacios. */
function aNumero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (valor === null || valor === undefined) return null;
  let s = String(valor).trim().replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  const ultimaComa = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  if (ultimaComa > -1 && ultimoPunto > -1) {
    // El separador decimal es el que aparece mas a la derecha.
    s = ultimaComa > ultimoPunto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (ultimaComa > -1) {
    s = s.split(",").length === 2 && s.length - ultimaComa <= 3 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Carga de archivos
// ---------------------------------------------------------------------------

async function leerArchivo(archivo) {
  aviso("#aviso-carga", "");
  try {
    if (typeof XLSX === "undefined") throw new Error("La librería de planillas aún no carga. Espera un segundo y reintenta.");
    const buffer = await archivo.arrayBuffer();
    const libro = XLSX.read(buffer, { type: "array", cellDates: false });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: null });
    if (!filas.length) throw new Error("La primera hoja del archivo está vacía.");
    estado.nombreArchivo = archivo.name;
    prepararMapeo(filas);
  } catch (error) {
    aviso("#aviso-carga", `No se pudo leer el archivo: ${error.message}`);
  }
}

function prepararMapeo(filas) {
  estado.filas = filas;
  estado.encabezados = Object.keys(filas[0]);
  estado.mapeo = detectarMapeo(estado.encabezados);

  const rejilla = $("#rejilla-mapeo");
  rejilla.innerHTML = "";
  for (const campo of CAMPOS) {
    const contenedor = crear("div", { className: "campo" });
    contenedor.append(crear("label", {
      htmlFor: `mapa-${campo.clave}`,
      innerHTML: `${campo.etiqueta}${campo.obligatorio ? ' <span class="obligatorio">*</span>' : ""}`,
    }));
    const select = crear("select", { id: `mapa-${campo.clave}` });
    select.append(crear("option", { value: "", textContent: "— sin usar —" }));
    for (const encabezado of estado.encabezados) {
      select.append(crear("option", { value: encabezado, textContent: encabezado }));
    }
    select.value = estado.mapeo[campo.clave] || "";
    select.addEventListener("change", () => { estado.mapeo[campo.clave] = select.value; });
    contenedor.append(select);
    rejilla.append(contenedor);
  }

  const detectadas = Object.keys(estado.mapeo).length;
  $("#resumen-archivo").textContent =
    `${estado.nombreArchivo || "datos de ejemplo"} · ${numero(filas.length)} filas · ${detectadas} columnas reconocidas automáticamente`;
  $("#panel-mapeo").classList.remove("oculto");
  $("#panel-mapeo").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Analisis
// ---------------------------------------------------------------------------

function calcular() {
  aviso("#aviso-mapeo", "");
  const faltantes = CAMPOS.filter((c) => c.obligatorio && !estado.mapeo[c.clave]);
  if (faltantes.length) {
    aviso("#aviso-mapeo", `Falta asignar: <strong>${faltantes.map((f) => f.etiqueta).join(", ")}</strong>.`);
    return;
  }

  const totalFilas = estado.filas.length;
  const limite = estado.pro ? Infinity : CONFIG.limiteGratis;
  const recortado = !estado.pro && totalFilas > limite;

  const preparadas = estado.filas.slice(0, recortado ? limite : totalFilas).map((fila, i) => {
    const salida = { sku: `FILA-${i + 1}` };
    for (const campo of CAMPOS) {
      const columna = estado.mapeo[campo.clave];
      if (!columna) continue;
      const valor = fila[columna];
      salida[campo.clave] = campo.texto ? (valor ?? salida[campo.clave] ?? "") : aNumero(valor);
    }
    if (!salida.sku) salida.sku = `FILA-${i + 1}`;
    return salida;
  });

  try {
    const cv = Math.min(2, Math.max(0.1, Number($("#cv-demanda").value) || CONFIG.cvDemanda));
    estado.resultado = analizar(preparadas, { cvDemanda: cv });
    estado.resultado.recortado = recortado;
    estado.resultado.totalFilas = totalFilas;
    dibujarResultados();
  } catch (error) {
    aviso("#aviso-mapeo", `No se pudo calcular: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Presentacion de resultados
// ---------------------------------------------------------------------------

function planAccion(item) {
  if (item.enRiesgo) return { texto: "Reponer ahora", clase: "marca-riesgo" };
  if (item.excesoUnidades > 0) return { texto: `Bajar ${numero(item.excesoUnidades)} un.`, clase: "" };
  return { texto: "En rango", clase: "" };
}

function dibujarResultados() {
  const { items, pesos, familias, resumen, recortado, totalFilas } = estado.resultado;
  const destino = $("#resultados");
  const maxPeso = Math.max(...pesos.map((p) => p.peso), 1e-9);
  const pct = (n) => (resumen.n ? (n / resumen.n) * 100 : 0);
  const visibles = estado.pro ? items.slice(0, 300) : items;

  destino.innerHTML = `
    <div class="entre" style="margin-bottom:18px">
      <h2 style="margin:0">3. Resultado del análisis</h2>
      <div class="fila">
        <span class="silencio" id="aviso-exportar"></span>
        <button class="boton boton-secundario boton-fino" id="btn-exportar" ${estado.pro ? "" : "disabled"}>
          ⬇ Exportar a Excel${estado.pro ? "" : " (Pro)"}
        </button>
      </div>
    </div>

    <div class="rejilla-kpi" style="margin-bottom:22px">
      ${resumen.tieneStock ? `
      <div class="kpi destacada">
        <div class="rotulo">Capital liberable</div>
        <div class="cifra">${dinero(resumen.capitalLiberable)}</div>
        <div class="nota">sobrestock por encima del nivel objetivo S</div>
      </div>` : `
      <div class="kpi">
        <div class="rotulo">Capital liberable</div>
        <div class="cifra">—</div>
        <div class="nota">asigna la columna "Stock actual" para calcularlo</div>
      </div>`}
      <div class="kpi ${resumen.riesgoClaseA ? "peligro" : ""}">
        <div class="rotulo">Riesgo de quiebre</div>
        <div class="cifra">${numero(resumen.enRiesgo)}</div>
        <div class="nota">${numero(resumen.riesgoClaseA)} son clase A (paran la planta)</div>
      </div>
      <div class="kpi">
        <div class="rotulo">Repuestos analizados</div>
        <div class="cifra">${numero(resumen.n)}</div>
        <div class="nota">${numero(resumen.porClase.A)} A · ${numero(resumen.porClase.B)} B · ${numero(resumen.porClase.C)} C</div>
      </div>
      <div class="kpi">
        <div class="rotulo">Familias detectadas</div>
        <div class="cifra">${resumen.k}</div>
        <div class="nota">silueta ${resumen.silueta.toFixed(2)} (calidad del agrupamiento)</div>
      </div>
    </div>

    ${recortado ? `
    <div class="bloqueo">
      <p><strong>Tu archivo tiene ${numero(totalFilas)} repuestos y la versión gratuita analiza ${numero(CONFIG.limiteGratis)}.</strong>
      Lo que ves arriba es solo la punta: el capital dormido del maestro completo suele ser
      ${Math.round(totalFilas / CONFIG.limiteGratis)}x mayor que esta muestra.</p>
      <a href="${CONFIG.linkCompra}" target="_blank" rel="noopener" class="boton boton-primario">Desbloquear maestro completo</a>
      <button class="boton boton-secundario" id="btn-licencia-2">Ya tengo licencia</button>
    </div>` : ""}

    <div class="rejilla-planes" style="margin-top:24px">
      <div class="tarjeta">
        <h3>Peso objetivo de cada criterio</h3>
        <p class="silencio" style="font-size:.85rem">Calculado por entropía sobre tus propios datos.</p>
        ${pesos.map((p) => `
          <div class="barra-peso">
            <span>${p.etiqueta}</span>
            <span class="via"><span class="relleno" style="width:${(p.peso / maxPeso) * 100}%"></span></span>
            <span class="valor">${(p.peso * 100).toFixed(1)}%</span>
          </div>`).join("")}
      </div>
      <div class="tarjeta">
        <h3>Distribución ABC</h3>
        <p class="silencio" style="font-size:.85rem">Corte de Pareto sobre criticidad × valor de consumo.</p>
        <div class="barra-abc">
          <div style="width:${pct(resumen.porClase.A)}%;background:var(--clase-a)">${resumen.porClase.A ? "A" : ""}</div>
          <div style="width:${pct(resumen.porClase.B)}%;background:var(--clase-b)">${resumen.porClase.B ? "B" : ""}</div>
          <div style="width:${pct(resumen.porClase.C)}%;background:var(--clase-c)">${resumen.porClase.C ? "C" : ""}</div>
        </div>
        <p class="silencio" style="font-size:.85rem;margin:0 0 10px">
          El 20% más importante concentra el <strong>${(resumen.concentracion * 100).toFixed(0)}%</strong>
          del impacto.${resumen.concentracion < 0.6
            ? " Tu portafolio está poco concentrado: el corte por valor se acota a 20% / 30% / 50% para que la política siga siendo aplicable."
            : " Portafolio concentrado: manda la regla de Pareto por valor."}
        </p>
        <table style="min-width:0"><tbody>
          <tr><td><span class="insignia A">A</span></td><td>${numero(resumen.porClase.A)} SKU</td>
              <td class="num">servicio 99% · revisión 7 d</td></tr>
          <tr><td><span class="insignia B">B</span></td><td>${numero(resumen.porClase.B)} SKU</td>
              <td class="num">servicio 95% · revisión 15 d</td></tr>
          <tr><td><span class="insignia C">C</span></td><td>${numero(resumen.porClase.C)} SKU</td>
              <td class="num">servicio 90% · revisión 30 d</td></tr>
        </tbody></table>
      </div>
      <div class="tarjeta">
        <h3>Familias del portafolio</h3>
        <p class="silencio" style="font-size:.85rem">Grupos homogéneos de precio, rotación y lead time.</p>
        <div class="envoltura-tabla">
          <table style="min-width:0">
            <thead><tr><th>#</th><th>SKU</th><th>Precio medio</th><th>Consumo</th><th>Lead time</th></tr></thead>
            <tbody>${familias.map((f) => `
              <tr><td>F${f.id}</td><td class="num">${numero(f.n)}</td><td class="num">${dinero(f.precioMedio)}</td>
                  <td class="num">${numero(f.consumoMedio)}</td><td class="num">${numero(f.leadTimeMedio)} d</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <h3 style="margin-top:30px">Repuestos ordenados por criticidad</h3>
    <p class="silencio" style="margin-top:-.5em">
      ${estado.pro && items.length > 300
        ? `Mostrando los 300 más críticos de ${numero(items.length)}. El Excel trae todos.`
        : `${numero(visibles.length)} repuestos.`}
    </p>
    <div class="envoltura-tabla">
      <table>
        <thead><tr>
          <th>#</th><th>SKU</th><th>Descripción</th><th>Índice</th><th>Clase</th><th>Fam.</th>
          <th>Stock hoy</th><th>Seguridad</th><th>Objetivo S</th><th>Revisión</th><th>Acción</th>
        </tr></thead>
        <tbody>
          ${visibles.map((it, i) => {
            const accion = planAccion(it);
            return `<tr class="${it.enRiesgo ? "fila-riesgo" : ""}">
              <td>${i + 1}</td>
              <td><strong>${escapar(it.sku)}</strong></td>
              <td>${escapar(String(it.descripcion || "").slice(0, 46))}</td>
              <td class="num">${it.indiceCriticidad.toFixed(3)}</td>
              <td><span class="insignia ${it.clase}">${it.clase}</span></td>
              <td class="num">F${it.familia}</td>
              <td class="num">${it.stockActual === null || it.stockActual === undefined ? "—" : numero(it.stockActual)}</td>
              <td class="num">${numero(it.stockSeguridad)}</td>
              <td class="num">${numero(it.nivelObjetivoS)}</td>
              <td class="num">${it.revisionDias} d</td>
              <td class="${accion.clase}">${accion.texto}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  destino.classList.remove("oculto");
  $("#btn-exportar")?.addEventListener("click", exportarExcel);
  $("#btn-licencia-2")?.addEventListener("click", abrirModalLicencia);
  destino.scrollIntoView({ behavior: "smooth", block: "start" });
}

const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------------------
// Exportacion a Excel (solo Pro)
// ---------------------------------------------------------------------------

/**
 * Algunos visores (por ejemplo el de Artifacts) bloquean las descargas directas
 * del navegador y entregan los archivos por su propia capacidad. Si esa via
 * existe se usa; si no, se descarga como en cualquier sitio normal.
 */
async function guardadorDelVisor() {
  if (typeof window.claude?.use !== "function") return null;
  try {
    const descargas = await window.claude.use("downloads");
    return descargas ? (peticion) => descargas.save(peticion) : null;
  } catch {
    return null;
  }
}

async function exportarExcel() {
  if (!estado.pro || !estado.resultado) return;
  const { items, pesos, familias, resumen } = estado.resultado;

  const hojaResumen = [
    ["CritiSpare — Informe de criticidad de repuestos"],
    ["Generado", new Date().toLocaleString("es-CL")],
    ["Archivo", estado.nombreArchivo || "datos de ejemplo"],
    ["Licencia", estado.cliente || "Pro"],
    [],
    ["Repuestos analizados", resumen.n],
    ["Clase A", resumen.porClase.A],
    ["Clase B", resumen.porClase.B],
    ["Clase C", resumen.porClase.C],
    ["Familias detectadas", resumen.k],
    ["Coeficiente de silueta", Number(resumen.silueta.toFixed(3))],
    [],
    ["Capital inmovilizado hoy", Math.round(resumen.capitalActual)],
    ["Capital con política (R,S)", Math.round(resumen.capitalPropuesto)],
    ["CAPITAL LIBERABLE", Math.round(resumen.capitalLiberable)],
    [],
    ["Repuestos bajo cobertura", resumen.enRiesgo],
    ["  de ellos clase A", resumen.riesgoClaseA],
  ];

  const hojaItems = items.map((it, i) => ({
    "#": i + 1,
    SKU: it.sku,
    Descripción: it.descripcion || "",
    Categoría: it.categoria || "",
    "Índice criticidad": Number(it.indiceCriticidad.toFixed(4)),
    Clase: it.clase,
    Familia: `F${it.familia}`,
    "Precio unitario": it.precio ?? "",
    "Consumo anual": it.consumoAnual ?? "",
    "Lead time (d)": it.leadTime ?? "",
    "Stock actual": it.stockActual ?? "",
    "Servicio objetivo": it.servicioObjetivo,
    "Revisión (d)": it.revisionDias,
    "Stock seguridad": it.stockSeguridad,
    "Nivel objetivo S": it.nivelObjetivoS,
    "Exceso (un)": it.excesoUnidades ?? "",
    "Capital liberable": Math.round(it.capitalLiberable || 0),
    "Riesgo quiebre": it.enRiesgo ? "SI" : "",
    Acción: planAccion(it).texto,
  }));

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(hojaResumen), "Resumen");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hojaItems), "Repuestos");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(familias.map((f) => ({
    Familia: `F${f.id}`, SKU: f.n,
    "Precio medio": Math.round(f.precioMedio),
    "Consumo medio": Math.round(f.consumoMedio),
    "Lead time medio": Math.round(f.leadTimeMedio),
    "Criticidad media": Number(f.criticidadMedia.toFixed(4)),
  }))), "Familias");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(pesos.map((p) => ({
    Criterio: p.etiqueta, Sentido: p.sentido, "Peso (%)": Number((p.peso * 100).toFixed(2)),
  }))), "Pesos");

  const nombre = `CritiSpare-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const estadoExport = $("#aviso-exportar");
  const guardar = await guardadorDelVisor();

  if (!guardar) {
    XLSX.writeFile(libro, nombre);
    return;
  }

  if (estadoExport) estadoExport.textContent = "Preparando el archivo…";
  try {
    const bytes = XLSX.write(libro, { bookType: "xlsx", type: "array" });
    await guardar({ filename: nombre, data: new Blob([bytes]) });
    if (estadoExport) estadoExport.textContent = `Guardado: ${nombre}`;
  } catch (error) {
    const motivos = {
      declined: "Cancelaste la descarga.",
      rate_limited: "Ya hay una descarga en curso. Intenta de nuevo en unos segundos.",
    };
    if (estadoExport) {
      estadoExport.textContent = motivos[error?.code] || "No se pudo entregar el archivo aquí.";
    }
  }
}

// ---------------------------------------------------------------------------
// Licencias
// ---------------------------------------------------------------------------

function aplicarEstadoPro(cliente) {
  estado.pro = true;
  estado.cliente = cliente;
  $("#insignia-pro").classList.remove("oculto");
  $("#btn-licencia").textContent = cliente ? `Pro: ${String(cliente).slice(0, 18)}` : "Pro activo";
}

async function activarLicencia(clave, { silencioso = false } = {}) {
  let resultado = await verificarLicencia(clave, CONFIG.CLAVE_PUBLICA, { producto: CONFIG.producto });

  // Si no es una licencia firmada por nosotros, puede ser una clave de Gumroad.
  if (!resultado.valida && CONFIG.gumroadProductId) {
    try {
      resultado = await verificarGumroad(clave, CONFIG.gumroadProductId);
    } catch {
      resultado = { valida: false, motivo: "No se pudo contactar a Gumroad. Revisa tu conexión." };
    }
  }

  if (!resultado.valida) {
    if (!silencioso) aviso("#aviso-licencia", resultado.motivo);
    else localStorage.removeItem(LLAVE_LICENCIA);
    return false;
  }

  localStorage.setItem(LLAVE_LICENCIA, clave);
  aplicarEstadoPro(resultado.cliente);
  if (!silencioso) {
    aviso("#aviso-licencia", `Licencia activa${resultado.expira ? ` hasta el ${resultado.expira}` : ""}. Ya puedes analizar sin límites.`, "exito");
    setTimeout(() => {
      $("#velo-licencia").classList.add("oculto");
      if (estado.filas.length) calcular();
    }, 1200);
  }
  return true;
}

function abrirModalLicencia() {
  aviso("#aviso-licencia", "");
  $("#velo-licencia").classList.remove("oculto");
  $("#entrada-licencia").focus();
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function conectarEventos() {
  const zona = $("#zona-carga");
  const entrada = $("#entrada-archivo");

  zona.addEventListener("click", () => entrada.click());
  zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); entrada.click(); }
  });
  entrada.addEventListener("change", (e) => e.target.files[0] && leerArchivo(e.target.files[0]));
  ["dragenter", "dragover"].forEach((evento) =>
    zona.addEventListener(evento, (e) => { e.preventDefault(); zona.classList.add("encima"); }));
  ["dragleave", "drop"].forEach((evento) =>
    zona.addEventListener(evento, (e) => { e.preventDefault(); zona.classList.remove("encima"); }));
  zona.addEventListener("drop", (e) => e.dataTransfer.files[0] && leerArchivo(e.dataTransfer.files[0]));

  $("#btn-calcular").addEventListener("click", calcular);
  $("#btn-ejemplo").addEventListener("click", cargarEjemplo);
  $("#btn-licencia").addEventListener("click", abrirModalLicencia);
  $("#btn-cerrar-licencia").addEventListener("click", () => $("#velo-licencia").classList.add("oculto"));
  $("#btn-activar").addEventListener("click", () => activarLicencia($("#entrada-licencia").value));
  $("#entrada-licencia").addEventListener("keydown", (e) => {
    if (e.key === "Enter") activarLicencia($("#entrada-licencia").value);
  });
  $("#btn-demo-licencia").addEventListener("click", () => {
    $("#entrada-licencia").value = CONFIG.licenciaDemo;
    activarLicencia(CONFIG.licenciaDemo);
  });
  $("#velo-licencia").addEventListener("click", (e) => {
    if (e.target.id === "velo-licencia") $("#velo-licencia").classList.add("oculto");
  });
}

const EJEMPLOS = {
  embotelladora: { archivo: "ejemplo-embotelladora.csv", nombre: "Planta embotelladora — 200 SKU" },
  planta: { archivo: "ejemplo-repuestos.csv", nombre: "Planta industrial — 120 SKU" },
};

/** En el sitio el ejemplo se descarga; en el paquete de un solo archivo va incrustado. */
async function textoDeEjemplo(archivo) {
  const respuesta = await fetch(archivo);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  return respuesta.text();
}

async function cargarEjemplo() {
  aviso("#aviso-carga", "");
  const ejemplo = EJEMPLOS[$("#set-ejemplo")?.value] ?? EJEMPLOS.embotelladora;
  try {
    const texto = await textoDeEjemplo(ejemplo.archivo);
    const libro = XLSX.read(texto, { type: "string" });
    const filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { defval: null });
    estado.nombreArchivo = ejemplo.nombre;
    prepararMapeo(filas);
  } catch (error) {
    aviso("#aviso-carga", `No se pudo cargar el ejemplo: ${error.message}`);
  }
}

function aplicarConfig() {
  document.title = `${CONFIG.marca} - ${CONFIG.eslogan}`;
  $("#marca").textContent = CONFIG.marca;
  $("#marca-pie").textContent = CONFIG.marca;
  $("#precio-pro").textContent = CONFIG.precio;
  $("#precio-etiqueta").textContent = CONFIG.precioEtiqueta;
  $("#limite-gratis").textContent = CONFIG.limiteGratis;
  $("#btn-comprar").href = CONFIG.linkCompra;
  if (CONFIG.linkAgenda) $("#btn-agenda").href = CONFIG.linkAgenda;
  else if (CONFIG.emailContacto) $("#btn-agenda").href = `mailto:${CONFIG.emailContacto}`;
  else $("#plan-consultoria").classList.add("oculto");
}

function iniciar() {
  aplicarConfig();
  conectarEventos();
  const guardada = localStorage.getItem(LLAVE_LICENCIA);
  if (guardada) activarLicencia(guardada, { silencioso: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();

// Expuesto para las pruebas automatizadas de la interfaz.
window.__critispare = { estado, detectarMapeo, aNumero, CAMPOS, analizar };
