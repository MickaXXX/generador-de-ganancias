// De donde salen las operaciones del trader. Misma interfaz en ambos casos:
// arrancar(alRecibirTx), detener().

import { CadenaSimulada } from './simulador.mjs';

/** Cadena simulada. Para el modo sombra sin red y para las pruebas. */
export class FuenteSimulada {
  constructor({ semilla = 42, msPorTick = 400, segundosPorTick = 30 } = {}) {
    this.cadena = new CadenaSimulada({ semilla });
    this.msPorTick = msPorTick;
    this.segundosPorTick = segundosPorTick;
    this.timer = null;
    this.trader = this.cadena.trader;
    this.simulada = true;
  }

  precio(mint) { return this.cadena.tokens.get(mint)?.precio ?? 0; }
  infoToken(mint) { return this.cadena.infoToken(mint); }
  precios(_mints) { return this.cadena.precios(); }

  arrancar(alRecibirTx) {
    this.timer = setInterval(() => {
      const tx = this.cadena.paso(this.segundosPorTick);
      if (tx) alRecibirTx(tx);
    }, this.msPorTick);
    if (this.timer.unref) this.timer.unref();
  }

  detener() { clearInterval(this.timer); this.timer = null; }
}

/**
 * Cadena real. Se suscribe por WebSocket a los logs de la wallet del trader y
 * pide la transaccion completa apenas aparece la firma.
 *
 * logsSubscribe da 200-400 ms, que alcanza para traders de horizonte largo,
 * que son justo los unicos que conviene copiar. Si el modo sombra demuestra
 * que la latencia esta costando plata, se cambia esta clase por Yellowstone
 * gRPC (10-40 ms) sin tocar nada mas del motor.
 */
export class FuenteSolana {
  constructor({ conexion, trader }) {
    this.conexion = conexion;
    this.trader = trader;
    this.suscripcion = null;
    this.vistas = new Set();
    this.simulada = false;
  }

  async arrancar(alRecibirTx) {
    const { PublicKey } = await import('@solana/web3.js');
    const clave = new PublicKey(this.trader);
    this.suscripcion = this.conexion.onLogs(clave, async (log) => {
      if (log.err || this.vistas.has(log.signature)) return;
      this.vistas.add(log.signature);
      try {
        const tx = await this.conexion.getTransaction(log.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        });
        if (tx) alRecibirTx(tx);
      } catch { /* la transaccion aun no se propaga; el reconciliador la recupera */ }
    }, 'confirmed');
  }

  async detener() {
    if (this.suscripcion != null) await this.conexion.removeOnLogsListener(this.suscripcion);
    this.suscripcion = null;
  }
}
