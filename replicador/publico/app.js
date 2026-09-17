const $ = (id) => document.getElementById(id);
const CAMPOS = ['presupuestoSol', 'maxFraccionPorToken', 'maxPosiciones', 'trailingStop', 'maxDrawdownDiario', 'liquidezMinimaUsd'];

// Los dos ejes que de verdad importan, presentados como tres opciones.
const MODOS = {
  demo:  { cadena: 'simulada', ejecucion: 'sombra' },
  papel: { cadena: 'real',     ejecucion: 'sombra' },
  real:  { cadena: 'real',     ejecucion: 'real' },
};
const nombreModo = (cadena, ejecucion) =>
  Object.keys(MODOS).find((k) => MODOS[k].cadena === cadena && MODOS[k].ejecucion === ejecucion) ?? 'demo';

const modoElegido = () => document.querySelector('input[name="modo"]:checked')?.value ?? 'demo';

const sol = (n) => `${Number(n ?? 0).toFixed(4)} SOL`;
const pct = (n) => `${(Number(n ?? 0) * 100).toFixed(1)}%`;
const hora = (ts) => new Date(ts).toLocaleTimeString('es-CL', { hour12: false });
const clase = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

let corriendo = false;

async function api(ruta, cuerpo) {
  const r = await fetch(`/api${ruta}`, cuerpo
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }
    : { method: 'POST' });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error ?? `Error ${r.status}`);
  return datos;
}

function mostrarError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg ?? '';
}

function pintarRegistro(lineas) {
  const caja = $('registro');
  if (!lineas?.length) return;
  const pegado = caja.scrollTop + caja.clientHeight >= caja.scrollHeight - 30;
  caja.innerHTML = lineas.map((l) =>
    `<div class="linea linea--${l.nivel}"><span class="hora">${hora(l.ts)}</span><span class="txt">${
      String(l.texto).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</span></div>`).join('');
  if (pegado) caja.scrollTop = caja.scrollHeight;
}

function pintarAvisoModo(modo, hayClave) {
  const caja = $('aviso-modo');
  caja.classList.toggle('peligro', modo === 'real');
  if (modo === 'demo') {
    caja.innerHTML = '<strong>Nada de esto es real.</strong> Las operaciones salen de una cadena simulada. ' +
      'Sirve para ver cómo se comporta la app y para ajustar los filtros, no para decidir a quién copiar.';
  } else if (modo === 'papel') {
    caja.innerHTML = '<strong>Este es el modo que contesta la pregunta importante.</strong> Lee las operaciones ' +
      'reales del trader y registra qué habrías hecho, con precio y slippage estimados, sin firmar nada. ' +
      'Dejalo dos semanas antes de conectar un peso.';
  } else {
    caja.innerHTML = '<strong>Vas a gastar dinero de verdad.</strong> Usá una billetera separada, con solo lo que ' +
      'estés dispuesto a perder entero. ' + (hayClave
        ? 'La clave está cargada desde disco en esta máquina.'
        : 'Falta la clave: ponela en <code>replicador/.clave</code> o en la variable <code>CLAVE_PRIVADA</code>. Esta página no la acepta.');
  }
}

function pintar(e) {
  corriendo = !!e.corriendo;
  document.body.classList.toggle('corriendo', corriendo);
  $('btn-correr').disabled = corriendo;
  $('btn-detener').disabled = !corriendo;
  for (const id of [...CAMPOS, 'trader']) $(id).disabled = corriendo;
  $('btn-resolver').disabled = corriendo;

  const modo = nombreModo(e.cadena, e.ejecucion);
  const gastaPlata = e.ejecucion === 'real';
  const etiquetas = { demo: 'MODO DEMO — CADENA INVENTADA', papel: 'PAPEL — DATOS REALES, SIN GASTAR', real: 'DINERO REAL' };
  $('insignia-modo').textContent = etiquetas[modo];
  $('insignia-modo').className = `insignia insignia--${gastaPlata ? 'real' : 'sombra'}`;

  const radio = document.querySelector(`input[name="modo"][value="${modo}"]`);
  if (radio && !corriendo) radio.checked = true;
  for (const r of document.querySelectorAll('input[name="modo"]')) r.disabled = corriendo;
  pintarAvisoModo(modo, e.hayClave);

  // La direccion que se muestra tiene que decir la verdad sobre su origen. En
  // modo demo la wallet es inventada y decirlo importa mas que verse prolijo.
  if (e.cadenaSimulada) {
    $('estado-trader').textContent = 'Cadena simulada: las operaciones son inventadas y el trader real no se toca.';
    $('estado-trader').className = 'pista';
  } else if (e.trader) {
    $('estado-trader').textContent = `Vigilando ${e.trader}`;
    $('estado-trader').className = 'pista bien';
  }
  if (!document.activeElement?.id || ![...CAMPOS, 'trader'].includes(document.activeElement.id)) {
    if (e.traderConfigurado && !$('trader').value) $('trader').value = e.traderConfigurado;
    for (const id of CAMPOS) if (e.config?.[id] != null) $(id).value = e.config[id];
  }

  const c = e.cartera;
  if (c) {
    const rend = e.rendimiento ?? 0;
    $('m-valor').textContent = sol(c.valorTotalSol);
    $('m-rend').textContent = `${rend >= 0 ? '+' : ''}${pct(rend)} sobre ${sol(c.presupuestoSol)}`;
    $('m-rend').className = clase(rend);
    $('m-sol').textContent = sol(c.solDisponible);
    $('m-copiadas').textContent = e.contadores?.copiadas ?? 0;
    $('m-omitidas').textContent = `${e.contadores?.omitidas ?? 0} omitidas por los filtros`;
    $('m-dd').textContent = pct(e.drawdown);
    $('m-stops').textContent = `${e.contadores?.stops ?? 0} salidas por trailing stop`;

    $('tbody-posiciones').innerHTML = c.posiciones.length
      ? c.posiciones.map((p) => {
          const r = p.valorSol - p.costoSol;
          return `<tr><td title="${p.mint}">${p.mint.slice(0, 10)}…</td><td class="num">${p.costoSol.toFixed(4)}</td>` +
                 `<td class="num">${p.valorSol.toFixed(4)}</td><td class="num ${clase(r)}">${r >= 0 ? '+' : ''}${r.toFixed(4)}</td></tr>`;
        }).join('')
      : '<tr class="vacio"><td colspan="4">Ninguna posición abierta.</td></tr>';
  }

  if (e.registro?.length) pintarRegistro(e.registro);
  mostrarError(e.ultimoError);
}

// ------------------------------------------------------------------ acciones

for (const r of document.querySelectorAll('input[name="modo"]')) {
  r.addEventListener('change', () => fetch('/api/estado').then((x) => x.json()).then(pintar));
}

$('btn-resolver').addEventListener('click', async () => {
  $('estado-trader').textContent = 'Resolviendo…';
  $('estado-trader').className = 'pista';
  try {
    const r = await api('/resolver', { trader: $('trader').value });
    $('estado-trader').textContent = `${r.direccion} (vía ${r.via})`;
    $('estado-trader').className = 'pista bien';
  } catch (e) {
    $('estado-trader').textContent = e.message;
    $('estado-trader').className = 'pista mal';
  }
});

$('btn-correr').addEventListener('click', async () => {
  mostrarError(null);
  $('btn-correr').disabled = true;
  try {
    const cambios = { trader: $('trader').value, ...MODOS[modoElegido()] };
    for (const id of CAMPOS) cambios[id] = Number($(id).value);
    await api('/config', cambios);
    pintar(await api('/arrancar'));
  } catch (e) {
    mostrarError(e.message);
    $('btn-correr').disabled = false;
  }
});

$('btn-detener').addEventListener('click', async () => {
  $('btn-detener').disabled = true;
  try { pintar(await api('/detener')); } catch (e) { mostrarError(e.message); }
});

// -------------------------------------------------------------------- stream

const flujo = new EventSource('/api/eventos');
flujo.onmessage = (ev) => {
  const { tipo, datos } = JSON.parse(ev.data);
  if (tipo === 'estado') pintar(datos);
  else if (tipo === 'registro' && corriendo) {
    const caja = $('registro');
    if (caja.querySelector('.vacio')) caja.innerHTML = '';
    const pegado = caja.scrollTop + caja.clientHeight >= caja.scrollHeight - 30;
    caja.insertAdjacentHTML('beforeend',
      `<div class="linea linea--${datos.nivel}"><span class="hora">${hora(datos.ts)}</span><span class="txt">${
        String(datos.texto).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</span></div>`);
    while (caja.children.length > 200) caja.firstElementChild.remove();
    if (pegado) caja.scrollTop = caja.scrollHeight;
  }
};

fetch('/api/estado').then((r) => r.json()).then(pintar);
