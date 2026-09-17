// Convierte la intencion del trader en MI orden, o la rechaza con un motivo.
// Cada rechazo lleva motivo legible: el registro tiene que poder explicar por
// que NO se copio algo, que es tan importante como lo que si se copio.

export const CONFIG_POR_DEFECTO = {
  presupuestoSol: 0.5,
  maxFraccionPorToken: 0.25,   // nunca mas del 25% del presupuesto en un token
  minOrdenSol: 0.02,           // bajo esto, los fees se comen la operacion
  maxPosiciones: 5,
  liquidezMinimaUsd: 25000,
  edadMinimaPoolMin: 30,
  maxDrawdownDiario: 0.20,     // cortacircuitos
  listaNegra: [],
};

const rechazo = (motivo) => ({ accion: 'omitir', motivo });

/**
 * @param intencion  salida de decodificar()
 * @param cartera    instancia de Cartera
 * @param config     ver CONFIG_POR_DEFECTO
 * @param infoToken  {liquidezUsd, edadMinutos, mintAuthority, freezeAuthority} o null
 */
export function decidir({ intencion, cartera, config, infoToken }) {
  const c = { ...CONFIG_POR_DEFECTO, ...config };

  if (intencion.lado === 'venta') {
    const p = cartera.posicion(intencion.mint);
    if (!p || p.tokens <= 0) return rechazo('no tengo posicion en ese token');

    let tokens = p.tokens * intencion.fraccion;
    // Si queda menos del 5% de la posicion, se vende entera. Dejar polvo
    // cuesta mas en fees de lo que vale.
    if (p.tokens - tokens < p.tokens * 0.05) tokens = p.tokens;
    return { accion: 'ejecutar', lado: 'venta', mint: intencion.mint, tokens, fraccion: intencion.fraccion };
  }

  // --- compras: aca es donde se pierde la plata, asi que se filtra fuerte ---

  if (c.listaNegra.includes(intencion.mint)) return rechazo('token en lista negra');

  if (!infoToken) return rechazo('sin datos del token, no se compra a ciegas');

  // Un mint authority activo significa que el creador puede imprimir tokens
  // infinitos y diluirte a cero. Un freeze authority activo significa que
  // puede congelar tu cuenta para que no puedas vender. Ambos son trampas
  // clasicas contra bots copiadores.
  if (infoToken.mintAuthority) return rechazo('el creador puede imprimir mas tokens');
  if (infoToken.freezeAuthority) return rechazo('el creador puede congelar tu billetera');

  if (infoToken.liquidezUsd < c.liquidezMinimaUsd)
    return rechazo(`liquidez ${Math.round(infoToken.liquidezUsd)} USD bajo el minimo`);
  if (infoToken.edadMinutos < c.edadMinimaPoolMin)
    return rechazo(`pool de ${Math.round(infoToken.edadMinutos)} min, demasiado nuevo`);

  const nueva = !cartera.posicion(intencion.mint);
  if (nueva && cartera.abiertas >= c.maxPosiciones)
    return rechazo(`ya hay ${c.maxPosiciones} posiciones abiertas`);

  // Escalado: la misma FRACCION que movio el, aplicada a MI saldo.
  let montoSol = cartera.solDisponible * intencion.fraccion;

  // Tope duro por token, contando lo que ya tengo puesto ahi.
  const techo = cartera.presupuestoSol * c.maxFraccionPorToken - cartera.expuestoEn(intencion.mint);
  if (techo <= 0) return rechazo('ya alcance el tope de exposicion en ese token');
  montoSol = Math.min(montoSol, techo);
  montoSol = Math.min(montoSol, cartera.solDisponible);

  if (montoSol < c.minOrdenSol)
    return rechazo(`orden de ${montoSol.toFixed(4)} SOL bajo el minimo de ${c.minOrdenSol}`);

  return { accion: 'ejecutar', lado: 'compra', mint: intencion.mint, montoSol, fraccion: intencion.fraccion };
}
