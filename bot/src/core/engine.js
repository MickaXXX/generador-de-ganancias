// El motor: recibe senales del vigilante, decide, ejecuta y deja registro.
// Las operaciones se hacen de a una (cola) para que dos senales simultaneas no
// gasten el mismo saldo dos veces.
import { SOL, USDC } from '../config.js';
import { calcularTamanoUsd, fraccionVenta, filtrarCompra, evaluarSalida } from './reglas.js';
import { valorBaseUsd } from '../solana/swapdetect.js';
import { log } from '../log.js';

const fracABigInt = (bruto, fraccion) => {
  const escala = 1_000_000n;
  const f = BigInt(Math.round(Math.min(Math.max(fraccion, 0), 1) * 1_000_000));
  return (bruto * f) / escala;
};

export class Motor {
  constructor({ rpc, jupiter, almacen, par, avisar }) {
    this.rpc = rpc;
    this.jupiter = jupiter;
    this.almacen = almacen;
    this.par = par;                 // Keypair, o null si solo hay simulacion
    this.avisar = avisar ?? (async () => {});
    this.cola = Promise.resolve();
  }

  get p() { return this.almacen.p; }
  get simulando() { return this.p.modo !== 'real' || !this.par; }
  get publica() { return this.par ? this.par.publicKey.toBase58() : null; }

  /** Encola una tarea para que las operaciones nunca se pisen entre si. */
  enFila(tarea) {
    const siguiente = this.cola.then(tarea, tarea);
    this.cola = siguiente.catch((e) => log.error('Tarea en cola fallida:', e));
    return siguiente;
  }

  // ---------------------------------------------------------------- senales

  async procesarSenal(senal) {
    return this.enFila(async () => {
      if (senal.tipo === 'compra') return this.copiarCompra(senal);
      if (senal.tipo === 'venta') return this.copiarVenta(senal);
    });
  }

  async copiarCompra(senal) {
    // Anotamos lo que el lider acumulo, aunque nosotros no copiemos: sirve para saber
    // que fraccion vendio despues.
    this.almacen.anotarLider(senal.lider, senal.mint, senal.cantidad);

    const precioSol = await this.jupiter.precioSolUsd().catch(() => 0);
    const montoLiderUsd = valorBaseUsd(senal.base, precioSol);
    const saldoUsd = await this.saldoDisponibleUsd(precioSol);

    const tamano = calcularTamanoUsd({ p: this.p, montoLiderUsd, saldoUsd });
    if (tamano.usd <= 0) {
      log.aviso(`No se copia la compra de ${senal.alias}: ${tamano.razon}`);
      await this.avisar(`⚠️ No copie la compra de *${senal.alias}*: ${tamano.razon}`);
      return;
    }

    await this.comprar({
      mint: senal.mint,
      usd: tamano.usd,
      lider: senal.alias,
      montoLiderUsd,
      decimalesConocidos: senal.decimales,
    });
  }

  async copiarVenta(senal) {
    const previa = this.almacen.posicionLider(senal.lider, senal.mint);
    this.almacen.anotarLider(senal.lider, senal.mint, -senal.cantidad);

    if (!this.p.venderSiVendeLider) return;
    const posicion = this.almacen.datos.posiciones[senal.mint];
    if (!posicion) return; // no tenemos ese token

    const { fraccion, estimada } = fraccionVenta({
      cantidadVendida: senal.cantidad,
      cantidadPreviaLider: previa,
      porDefecto: this.p.fraccionVentaDesconocida,
    });
    if (fraccion <= 0) return;

    const detalle = estimada
      ? 'no vi su compra, uso la fraccion por defecto'
      : `vendio el ${(fraccion * 100).toFixed(0)}% de lo suyo`;
    await this.vender({
      mint: senal.mint,
      fraccion,
      razon: `${senal.alias} vendio (${detalle})`,
    });
  }

  // ---------------------------------------------------------------- compras

  async comprar({ mint, usd, lider = 'manual', montoLiderUsd = null, decimalesConocidos = null }) {
    const p = this.p;
    const precioSol = await this.jupiter.precioSolUsd();
    if (!precioSol) throw new Error('No pude conocer el precio de SOL.');

    const lamports = BigInt(Math.floor((usd / precioSol) * 1e9));
    if (lamports <= 0n) return;

    let cotizacion;
    try {
      cotizacion = await this.jupiter.cotizar({
        entrada: SOL, salida: mint, cantidad: lamports, slippageBps: p.slippageBps,
      });
    } catch (e) {
      await this.avisar(`⚠️ Sin ruta de compra para \`${mint.slice(0, 8)}…\`: ${e.message}`);
      return;
    }

    const impactoPct = Number(cotizacion.priceImpactPct ?? 0) * 100;
    // Contraprueba de salida: si no se puede cotizar la venta de lo que vamos a recibir,
    // es un token del que no se sale. Ese es el filtro anti honeypot mas barato que existe.
    const vuelta = await this.jupiter.cotizarSuave({
      entrada: mint, salida: SOL, cantidad: cotizacion.outAmount, slippageBps: p.slippageVentaBps,
    });

    const dia = this.almacen.hoy();
    const yaTengo = Boolean(this.almacen.datos.posiciones[mint]);
    const ultima = this.almacen.datos.posiciones[mint]?.abiertaEn;
    const decision = filtrarCompra({
      p,
      estado: {
        posicionesAbiertas: Object.keys(this.almacen.datos.posiciones).length,
        comprasHoy: dia.compras,
        pnlHoyUsd: dia.pnlUsd,
        yaTengoEsteToken: yaTengo,
        minutosDesdeUltimaCompra: ultima ? (Date.now() - ultima) / 60000 : null,
        impactoPct,
        hayRutaDeVenta: Boolean(vuelta),
        listaNegra: false,
      },
    });
    if (!decision.ok) {
      log.aviso(`Compra descartada (${mint.slice(0, 6)}): ${decision.razon}`);
      await this.avisar(`⚠️ No compre \`${mint.slice(0, 8)}…\`: ${decision.razon}`);
      return;
    }

    const simbolo = (await this.jupiter.simboloDe(mint)) || `${mint.slice(0, 4)}…`;
    const decimales = decimalesConocidos ?? (await this.rpc.decimalesDe(mint).catch(() => null)) ?? 6;

    if (this.simulando) {
      const cruda = BigInt(cotizacion.outAmount);
      this.registrarCompra({ mint, simbolo, decimales, cruda, costoUsd: usd, lider, firma: null, simulada: true });
      await this.avisar(
        `🧪 *SIMULACION* — compra copiada de *${lider}*\n` +
        `${simbolo} \`${mint.slice(0, 8)}…\`\n` +
        `Puse: ${usd.toFixed(2)} USD${montoLiderUsd ? ` (el puso ${montoLiderUsd.toFixed(0)})` : ''}\n` +
        `Recibo: ${(Number(cruda) / 10 ** decimales).toLocaleString('es')} ${simbolo}\n` +
        `Impacto: ${impactoPct.toFixed(2)}%`
      );
      return;
    }

    const antes = await this.cantidadCruda(mint);
    const res = await this.jupiter.ejecutar({
      cotizacion, par: this.par, prioridadMaxLamports: p.prioridadMaxLamports,
    });
    if (!res.ok) {
      await this.avisar(`❌ Compra de ${simbolo} fallida: ${res.error}\n\`${res.firma ?? '-'}\``);
      this.almacen.anotarEvento({ tipo: 'compra-fallida', mint, simbolo, error: res.error });
      return;
    }

    // Lo que realmente entro a la billetera, no lo que prometia la cotizacion.
    let recibido = 0n;
    for (let i = 0; i < 5 && recibido <= 0n; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      recibido = (await this.cantidadCruda(mint)) - antes;
    }
    if (recibido <= 0n) recibido = BigInt(cotizacion.outAmount);

    this.registrarCompra({ mint, simbolo, decimales, cruda: recibido, costoUsd: usd, lider, firma: res.firma, simulada: false });
    await this.avisar(
      `🟢 *Compra copiada* de *${lider}*\n` +
      `${simbolo} \`${mint.slice(0, 8)}…\`\n` +
      `Puse: ${usd.toFixed(2)} USD${montoLiderUsd ? ` (el puso ${montoLiderUsd.toFixed(0)})` : ''}\n` +
      `Recibi: ${(Number(recibido) / 10 ** decimales).toLocaleString('es')} ${simbolo}\n` +
      `[Ver en Solscan](https://solscan.io/tx/${res.firma})`
    );
  }

  registrarCompra({ mint, simbolo, decimales, cruda, costoUsd, lider, firma, simulada }) {
    const previa = this.almacen.datos.posiciones[mint];
    if (previa) {
      previa.cruda = (BigInt(previa.cruda) + cruda).toString();
      previa.costoUsd += costoUsd;
      previa.abiertaEn = Date.now();
    } else {
      this.almacen.datos.posiciones[mint] = {
        mint, simbolo, decimales,
        cruda: cruda.toString(),
        costoUsd,
        picoUsd: costoUsd,
        abiertaEn: Date.now(),
        lider,
        simulada,
        firmaCompra: firma,
      };
    }
    this.almacen.hoy().compras += 1;
    this.almacen.anotarEvento({ tipo: 'compra', mint, simbolo, usd: costoUsd, lider, firma, simulada });
    this.almacen.guardar();
  }

  // ----------------------------------------------------------------- ventas

  async vender({ mint, fraccion = 1, razon = 'manual' }) {
    const p = this.p;
    const posicion = this.almacen.datos.posiciones[mint];
    if (!posicion) return { ok: false, error: 'no hay posicion abierta en ese token' };

    let bruto = BigInt(posicion.cruda);
    if (!this.simulando) {
      // La verdad esta en la cadena, no en nuestro archivo.
      const real = await this.cantidadCruda(mint);
      if (real < bruto) bruto = real;
      if (bruto <= 0n) {
        this.cerrarPosicion(mint, 0, 'la billetera ya no tiene ese token');
        return { ok: false, error: 'la billetera ya no tiene ese token' };
      }
    }
    const aVender = fraccion >= 1 ? bruto : fracABigInt(bruto, fraccion);
    if (aVender <= 0n) return { ok: false, error: 'cantidad a vender demasiado chica' };

    if (this.simulando) {
      const valor = await this.jupiter.valorUsd({ mint, cantidadCruda: aVender, slippageBps: p.slippageVentaBps });
      const recibido = valor ?? 0;
      this.aplicarVenta({ mint, vendido: aVender, recibidoUsd: recibido, razon, firma: null });
      await this.avisar(
        `🧪 *SIMULACION* — venta de ${posicion.simbolo}\n` +
        `Motivo: ${razon}\nRecibiria: ${recibido.toFixed(2)} USD`
      );
      return { ok: true, usd: recibido };
    }

    // Reintentos con mas slippage: la causa numero uno de "no me deja vender" es un
    // slippage corto para un token que se mueve rapido.
    const escalas = [1, 2, 3.5];
    let ultimoError = null;
    for (const escala of escalas) {
      const slippage = Math.min(Math.round(p.slippageVentaBps * escala), 5000);
      let cotizacion;
      try {
        cotizacion = await this.jupiter.cotizar({ entrada: mint, salida: SOL, cantidad: aVender, slippageBps: slippage });
      } catch (e) {
        ultimoError = e.message;
        continue;
      }
      const res = await this.jupiter.ejecutar({
        cotizacion, par: this.par, prioridadMaxLamports: Math.round(p.prioridadMaxLamports * escala),
      });
      if (res.ok) {
        const precioSol = await this.jupiter.precioSolUsd().catch(() => 0);
        const recibidoUsd = (Number(cotizacion.outAmount) / 1e9) * precioSol;
        const resultado = this.aplicarVenta({ mint, vendido: aVender, recibidoUsd, razon, firma: res.firma });
        await this.avisar(
          `🔴 *Venta* de ${posicion.simbolo}\n` +
          `Motivo: ${razon}\n` +
          `Recibi: ${recibidoUsd.toFixed(2)} USD\n` +
          `Resultado: ${resultado.pnlUsd >= 0 ? '+' : ''}${resultado.pnlUsd.toFixed(2)} USD (${resultado.pnlPct.toFixed(1)}%)\n` +
          `[Ver en Solscan](https://solscan.io/tx/${res.firma})`
        );
        return { ok: true, usd: recibidoUsd };
      }
      ultimoError = res.error;
      log.aviso(`Venta fallida con slippage ${slippage}: ${res.error}`);
    }

    await this.avisar(
      `❗️ *No pude vender ${posicion.simbolo}* despues de 3 intentos.\n` +
      `Ultimo error: ${ultimoError}\n` +
      `Prueba a mano: /vender ${mint} 100`
    );
    this.almacen.anotarEvento({ tipo: 'venta-fallida', mint, error: ultimoError, razon });
    return { ok: false, error: ultimoError };
  }

  aplicarVenta({ mint, vendido, recibidoUsd, razon, firma }) {
    const posicion = this.almacen.datos.posiciones[mint];
    const bruto = BigInt(posicion.cruda);
    const parte = bruto > 0n ? Number(vendido) / Number(bruto) : 1;
    const costoParte = posicion.costoUsd * Math.min(parte, 1);
    const pnlUsd = recibidoUsd - costoParte;
    const pnlPct = costoParte > 0 ? (pnlUsd / costoParte) * 100 : 0;

    const queda = bruto - vendido;
    if (queda <= 0n || parte >= 0.98) {
      delete this.almacen.datos.posiciones[mint];
    } else {
      posicion.cruda = queda.toString();
      posicion.costoUsd -= costoParte;
      posicion.picoUsd = Math.max(0, (posicion.picoUsd ?? 0) - costoParte);
    }

    this.almacen.hoy().pnlUsd += pnlUsd;
    this.almacen.anotarEvento({
      tipo: 'venta', mint, simbolo: posicion.simbolo, usd: recibidoUsd, pnlUsd, razon, firma,
      simulada: this.simulando,
    });
    this.almacen.guardar();
    return { pnlUsd, pnlPct };
  }

  cerrarPosicion(mint, recibidoUsd, razon) {
    const posicion = this.almacen.datos.posiciones[mint];
    if (!posicion) return;
    delete this.almacen.datos.posiciones[mint];
    this.almacen.anotarEvento({ tipo: 'cierre', mint, simbolo: posicion.simbolo, usd: recibidoUsd, razon });
    this.almacen.guardar();
  }

  // ------------------------------------------------------------- utilidades

  async cantidadCruda(mint) {
    if (!this.publica) return 0n;
    const cuentas = await this.rpc.tokensDe(this.publica).catch(() => []);
    return cuentas.filter((c) => c.mint === mint).reduce((a, c) => a + c.bruto, 0n);
  }

  async saldoSol() {
    if (!this.publica) return 0;
    return this.rpc.saldoSol(this.publica).catch(() => 0);
  }

  async saldoDisponibleUsd(precioSolConocido = null) {
    const precio = precioSolConocido ?? (await this.jupiter.precioSolUsd().catch(() => 0));
    if (this.simulando && !this.publica) return 1e9; // en simulacion sin billetera no hay tope
    const sol = await this.saldoSol();
    return Math.max(0, sol - this.p.reservaSol) * precio;
  }

  /** Posiciones con su valor de mercado actual (lo que dan si se venden ahora). */
  async posicionesConValor() {
    const salida = [];
    for (const posicion of Object.values(this.almacen.datos.posiciones)) {
      const valorUsd = await this.jupiter.valorUsd({
        mint: posicion.mint,
        cantidadCruda: posicion.cruda,
        slippageBps: this.p.slippageVentaBps,
      });
      const pnlUsd = valorUsd == null ? null : valorUsd - posicion.costoUsd;
      salida.push({
        ...posicion,
        valorUsd,
        pnlUsd,
        pnlPct: valorUsd == null || !posicion.costoUsd ? null : (pnlUsd / posicion.costoUsd) * 100,
      });
    }
    return salida;
  }

  /** Una pasada de take profit / stop loss / trailing sobre todo lo abierto. */
  async revisarSalidas() {
    for (const posicion of Object.values({ ...this.almacen.datos.posiciones })) {
      const valorUsd = await this.jupiter.valorUsd({
        mint: posicion.mint,
        cantidadCruda: posicion.cruda,
        slippageBps: this.p.slippageVentaBps,
      });
      if (valorUsd == null) continue;
      const veredicto = evaluarSalida({ p: this.p, posicion, valorUsd });
      if (veredicto.nuevoPico !== posicion.picoUsd) {
        posicion.picoUsd = veredicto.nuevoPico;
        this.almacen.guardar();
      }
      if (veredicto.vender) {
        log.info(`Salida automatica de ${posicion.simbolo}: ${veredicto.razon}`);
        await this.enFila(() => this.vender({ mint: posicion.mint, fraccion: 1, razon: veredicto.razon }));
      }
    }
  }
}

export { USDC };
