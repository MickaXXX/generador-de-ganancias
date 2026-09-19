// Cliente JSON-RPC minimo con failover entre endpoints y reintentos con espera creciente.
// Se usa fetch nativo (Node 22) para no depender de nada mas.
import { log } from '../log.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export class Rpc {
  constructor(urls) {
    this.urls = Array.isArray(urls) ? urls.filter(Boolean) : [urls];
    if (this.urls.length === 0) throw new Error('Hace falta al menos una RPC_URL.');
    this.indice = 0;
    this.id = 0;
  }

  get url() { return this.urls[this.indice]; }

  rotar() {
    if (this.urls.length > 1) {
      this.indice = (this.indice + 1) % this.urls.length;
      log.aviso(`Cambiando de RPC a ${new URL(this.url).host}`);
    }
  }

  async llamar(metodo, params = [], { intentos = 4, timeoutMs = 20000 } = {}) {
    let ultimoError;
    for (let intento = 0; intento < intentos; intento++) {
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), timeoutMs);
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method: metodo, params }),
          signal: control.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          ultimoError = new Error(`RPC ${metodo}: HTTP ${res.status}`);
          this.rotar();
          await espera(400 * 2 ** intento);
          continue;
        }
        const cuerpo = await res.json();
        if (cuerpo.error) {
          // Los errores de programa no se reintentan: son deterministas.
          const err = new Error(`RPC ${metodo}: ${cuerpo.error.message}`);
          err.datos = cuerpo.error;
          throw err;
        }
        return cuerpo.result;
      } catch (e) {
        if (e?.datos) throw e;
        ultimoError = e;
        this.rotar();
        await espera(400 * 2 ** intento);
      } finally {
        clearTimeout(reloj);
      }
    }
    throw ultimoError ?? new Error(`RPC ${metodo}: fallo desconocido`);
  }

  firmasDe(direccion, opciones) {
    return this.llamar('getSignaturesForAddress', [direccion, { limit: 20, ...opciones }]);
  }

  transaccion(firma) {
    return this.llamar('getTransaction', [firma, {
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    }]);
  }

  async saldoSol(direccion) {
    const r = await this.llamar('getBalance', [direccion, { commitment: 'confirmed' }]);
    return (r?.value ?? 0) / 1e9;
  }

  // Devuelve [{ mint, cantidad, decimales, bruto }] de las cuentas de token del dueno.
  async tokensDe(direccion) {
    const r = await this.llamar('getTokenAccountsByOwner', [
      direccion,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    return (r?.value ?? []).map((c) => {
      const info = c.account.data.parsed.info;
      return {
        mint: info.mint,
        cuenta: c.pubkey,
        bruto: BigInt(info.tokenAmount.amount),
        decimales: info.tokenAmount.decimals,
        cantidad: Number(info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount ?? 0),
      };
    }).filter((t) => t.bruto > 0n);
  }

  async decimalesDe(mint) {
    const r = await this.llamar('getTokenSupply', [mint, { commitment: 'confirmed' }]);
    return r?.value?.decimals ?? null;
  }

  async ultimoBloque() {
    const r = await this.llamar('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    return r.value; // { blockhash, lastValidBlockHeight }
  }

  alturaBloque() {
    return this.llamar('getBlockHeight', [{ commitment: 'confirmed' }]);
  }

  enviarTransaccion(base64) {
    return this.llamar('sendTransaction', [base64, {
      encoding: 'base64',
      skipPreflight: true,
      maxRetries: 0,
      preflightCommitment: 'confirmed',
    }], { intentos: 2 });
  }

  async estadoFirma(firma) {
    const r = await this.llamar('getSignatureStatuses', [[firma], { searchTransactionHistory: false }]);
    return r?.value?.[0] ?? null;
  }
}
