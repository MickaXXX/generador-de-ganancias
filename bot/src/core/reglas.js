// Reglas puras: cuanto copiar, que fraccion vender, si una compra pasa los filtros y
// si una posicion abierta ya toco su salida. Sin red y sin estado: por eso se pueden
// probar en segundos y por eso son las que menos van a fallar.

/**
 * Cuantos dolares poner en una copia.
 * @param {number|null} montoLiderUsd  lo que gasto el lider, si se pudo medir
 * @param {number} saldoUsd            nuestro saldo disponible en dolares
 */
export function calcularTamanoUsd({ p, montoLiderUsd, saldoUsd }) {
  let bruto;
  if (p.sizing === 'proporcional') {
    if (montoLiderUsd == null) {
      // No se pudo medir al lider (swap token contra token): caemos al monto fijo
      // en vez de inventar un tamano.
      bruto = p.compraUsd;
    } else {
      bruto = montoLiderUsd * p.proporcion;
    }
  } else if (p.sizing === 'patrimonio') {
    bruto = saldoUsd * (p.patrimonioPct / 100);
  } else {
    bruto = p.compraUsd;
  }

  const acotado = Math.min(Math.max(bruto, p.compraMinUsd), p.compraMaxUsd);
  if (acotado > saldoUsd) {
    return { usd: 0, razon: `saldo insuficiente: hacen falta ${acotado.toFixed(2)} USD y hay ${saldoUsd.toFixed(2)}` };
  }
  return { usd: acotado, razon: null };
}

/**
 * Que fraccion de NUESTRA posicion vender cuando el lider vende.
 * La idea es copiar el gesto, no el monto: si el lider suelta el 40% de lo que tenia,
 * nosotros soltamos el 40% de lo que tenemos.
 */
export function fraccionVenta({ cantidadVendida, cantidadPreviaLider, porDefecto = 1 }) {
  if (!cantidadPreviaLider || cantidadPreviaLider <= 0) {
    return { fraccion: Math.min(Math.max(porDefecto, 0), 1), estimada: true };
  }
  const cruda = cantidadVendida / cantidadPreviaLider;
  // Un 97% es "vendio todo" con ruido de decimales.
  const fraccion = cruda >= 0.97 ? 1 : Math.min(Math.max(cruda, 0), 1);
  return { fraccion, estimada: false };
}

/** Filtros que una compra tiene que pasar antes de gastar un peso. */
export function filtrarCompra({ p, estado }) {
  const {
    posicionesAbiertas, comprasHoy, pnlHoyUsd, yaTengoEsteToken,
    minutosDesdeUltimaCompra, impactoPct, hayRutaDeVenta, listaNegra,
  } = estado;

  if (p.pausado) return { ok: false, razon: 'el bot esta en pausa' };
  if (listaNegra) return { ok: false, razon: 'token en lista negra' };
  if (posicionesAbiertas >= p.maxPosiciones) return { ok: false, razon: `ya hay ${posicionesAbiertas} posiciones abiertas (tope ${p.maxPosiciones})` };
  if (comprasHoy >= p.maxComprasDia) return { ok: false, razon: `ya se hicieron ${comprasHoy} compras hoy (tope ${p.maxComprasDia})` };
  if (pnlHoyUsd <= -Math.abs(p.perdidaDiaMaxUsd)) return { ok: false, razon: `se alcanzo la perdida diaria maxima (${p.perdidaDiaMaxUsd} USD)` };
  if (yaTengoEsteToken && !p.promediar) return { ok: false, razon: 'ya tienes este token y promediar esta apagado' };
  if (minutosDesdeUltimaCompra != null && minutosDesdeUltimaCompra < p.cooldownMintMin) {
    return { ok: false, razon: `este token se compro hace ${Math.round(minutosDesdeUltimaCompra)} min (espera ${p.cooldownMintMin})` };
  }
  if (impactoPct != null && impactoPct > p.impactoMaxPct) {
    return { ok: false, razon: `impacto de precio ${impactoPct.toFixed(2)}% sobre el limite de ${p.impactoMaxPct}%` };
  }
  if (hayRutaDeVenta === false) {
    return { ok: false, razon: 'no hay ruta para vender este token (posible honeypot)' };
  }
  return { ok: true, razon: null };
}

/**
 * Decide si una posicion abierta debe cerrarse ahora. Los tres limites conviven:
 *  - stop loss: piso duro, se revisa primero.
 *  - trailing:  una vez armado (la ganancia toco trailingActivaPct), vende si el valor
 *               cae trailingCaidaPct desde el punto mas alto. Protege lo ganado.
 *  - take profit: techo duro, cierra si o si.
 * Para que los dos ultimos sirvan, takeProfitPct debe ser mayor que trailingActivaPct:
 * el trailing acompana la subida y el take profit es donde se cierra pase lo que pase.
 */
export function evaluarSalida({ p, posicion, valorUsd }) {
  const costo = posicion.costoUsd;
  if (!costo || costo <= 0 || valorUsd == null) return { vender: false, nuevoPico: posicion.picoUsd ?? valorUsd ?? 0 };

  const nuevoPico = Math.max(posicion.picoUsd ?? costo, valorUsd);
  const pnlPct = ((valorUsd - costo) / costo) * 100;
  const pnlPicoPct = ((nuevoPico - costo) / costo) * 100;

  if (p.stopLossPct > 0 && pnlPct <= -p.stopLossPct) {
    return { vender: true, fraccion: 1, razon: `stop loss (${pnlPct.toFixed(1)}%)`, nuevoPico, pnlPct };
  }

  const trailingArmado = p.trailingActivaPct > 0 && p.trailingCaidaPct > 0 && pnlPicoPct >= p.trailingActivaPct;
  if (trailingArmado) {
    const caidaPct = ((nuevoPico - valorUsd) / nuevoPico) * 100;
    if (caidaPct >= p.trailingCaidaPct) {
      return { vender: true, fraccion: 1, razon: `trailing stop (pico +${pnlPicoPct.toFixed(1)}%, cayo ${caidaPct.toFixed(1)}%)`, nuevoPico, pnlPct, trailingArmado: true };
    }
  }

  if (p.takeProfitPct > 0 && pnlPct >= p.takeProfitPct) {
    return { vender: true, fraccion: 1, razon: `take profit (+${pnlPct.toFixed(1)}%)`, nuevoPico, pnlPct, trailingArmado };
  }

  return { vender: false, nuevoPico, pnlPct, trailingArmado };
}
