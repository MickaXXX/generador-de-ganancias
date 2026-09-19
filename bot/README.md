# Copiabot — copia compras y ventas de Solana desde Telegram

Un bot de Telegram que vigila las wallets que tú elijas y replica sus operaciones
**en proporción**: si el que copias mete 1.000 dólares en un token, tú metes 4.
Cuando él vende el 40% de lo suyo, tú vendes el 40% de lo tuyo.

---

## Por qué Telegram y no WhatsApp

Lo verifiqué antes de escribir una línea. No es cuestión de gusto:

| | Telegram | WhatsApp |
|---|---|---|
| Crear el bot | Escribir a `@BotFather`, 30 segundos, gratis | Cuenta Meta Business + verificación de empresa |
| Costo | 0 | Por conversación, con pagos configurados |
| Iniciar una conversación | Cuando quiera | Solo con plantillas aprobadas por Meta, fuera de la ventana de 24 h |
| Botones para vender | Teclados en línea, nativos | Limitados y con aprobación |
| Avisar "el token se cayó 30%" | Inmediato | Choca con la ventana de 24 h |

El punto que decide es el último: un bot de trading tiene que poder escribirte **él**
a las 3 de la mañana. En WhatsApp, avisarte sin que tú hayas escrito primero requiere
una plantilla aprobada y se paga. En Telegram es una línea de código. Por eso todos
los bots de este rubro (Maestro, Trojan, BonkBot) viven en Telegram.

---

## Lo que tienes que saber antes de instalarlo

**1. Copiar automáticamente exige una llave caliente.** Para que el bot compre solo en
menos de un segundo tiene que firmar solo, y para firmar solo necesita la clave privada
en el servidor donde corre. No existe forma de copiar en automático "conectando Phantom":
ese popup de aprobación es justamente lo que el modo automático no puede esperar.

**Por eso este bot usa una billetera quemable y solo esa.** El comando
`npm run wallet:nueva` crea una billetera nueva, aparte, que solo existe para esto.
Le pasas solo lo que estés dispuesto a perder. Tu Phantom principal nunca entra aquí,
no se conecta, no se importa, no la ve nadie.

**2. La clave se guarda cifrada.** AES-256-GCM con clave derivada por scrypt desde tu
frase de paso. Nunca se escribe en el log (hay un censor que lo garantiza y un test que
lo comprueba), nunca se manda por Telegram, nunca sale del proceso.

**3. Solo tú mandas.** El bot ignora en silencio a cualquier chat que no sea tu
`TELEGRAM_OWNER_ID`. Un bot de trading abierto al público es una billetera abierta al público.

**4. Arranca en simulación y se queda ahí hasta que tú digas.** El modo por defecto
no gasta un peso: te avisa por Telegram exactamente lo que habría hecho. Déjalo así
unos días con las wallets que quieres copiar y mira si esas señales te habrían servido.

---

## Lo honesto sobre copiar

Esto es parte del producto, no letra chica:

- Copiar **no te transfiere** el precio de entrada, el tamaño de posición ni el timing
  del otro. Tú ves la operación después de que ya se movió el precio.
- Una posición que para él es el 1% de su cartera puede ser el 40% de la tuya. Por eso
  el bot tiene tope por copia, tope de posiciones abiertas y tope de pérdida diaria.
- El edge del que copias suele venir de estar adentro antes que tú, no de la señal que
  tú alcanzas a ver.
- La mayoría de quienes copian memecoins pierde plata.

El bot está hecho para que **pierdas poco cuando pierdas**: tamaño acotado, salida
automática y la venta reintentada con más slippage. No está hecho para prometerte que ganas.

---

## Instalación (10 minutos)

```bash
cd bot
npm install
cp .env.ejemplo .env
```

**1. El bot de Telegram.** Escribe a [@BotFather](https://t.me/BotFather), manda
`/newbot`, elige nombre. Te da un token: va en `TELEGRAM_BOT_TOKEN`.

**2. Tu identificación.** Escribe a [@userinfobot](https://t.me/userinfobot). Te
devuelve tu id numérico: va en `TELEGRAM_OWNER_ID`. Solo ese id podrá dar órdenes.

**3. La frase de paso.** Inventa una de al menos 8 caracteres y ponla en
`WALLET_PASSPHRASE`. Es la que cifra tu clave privada en disco.

**4. La billetera quemable.**

```bash
npm run wallet:nueva
```

Te muestra la dirección (esa es la que depositas) y una copia de seguridad de la clave
privada. **Guárdala fuera de este servidor** — en un papel, en tu gestor de contraseñas,
donde sea menos en la misma máquina. Si prefieres traer una que ya tienes:
`npm run wallet:importar` (acepta el formato que exporta Phantom).

**5. Revisión antes de arrancar.**

```bash
npm run diagnostico
```

Comprueba una por una las cosas que se rompen: el token de Telegram, la RPC, Jupiter,
la billetera y el saldo. Si algo está mal te dice qué y cómo se arregla.

**6. Arrancar.**

```bash
npm start
```

Escríbele `/ayuda` por Telegram.

---

## Uso

```
/seguir <dirección> [alias]     empezar a copiar a alguien
/lideres                        a quiénes sigo
/dejar <dirección|alias>        dejar de copiarlo

/estado                         saldo, posiciones y resultado del día
/posiciones                     lo abierto, con botones de venta
/vender <mint> [%]              vender a mano (por defecto 100%)
/vendertodo                     cerrar todo ya
/comprar <mint> <usd>           comprar a mano

/modo simulacion | real
/pausa   /reanudar
/config                         ver todos los parámetros
/set <parámetro> <valor>        cambiar uno en caliente
/wallet                         mi dirección para depositar
/historial                      últimas operaciones
```

Importante: cuando empiezas a seguir a alguien, el bot copia **desde ese momento**.
Nunca replica operaciones viejas, ni al encender después de una caída.

### De dónde sale la dirección que quieres copiar

`/seguir` necesita la dirección de Solana completa, no el usuario de fomo. fomo.family
muestra las direcciones parcialmente tapadas; servicios como FomoScan resuelven un
handle a las direcciones verificadas que esa persona controla. Sacas la dirección ahí
y la pegas aquí. El bot no depende de ningún servicio de esos para funcionar: lo único
que necesita es la dirección.

---

## Cómo decide cuánto poner

Tres modos, se cambian con `/set sizing <modo>`:

| Modo | Qué hace | Cuándo conviene |
|---|---|---|
| `fijo` | Siempre el mismo monto (`compraUsd`) | El más predecible. Empieza aquí. |
| `proporcional` | Un porcentaje de lo que puso el líder | Lo que pediste: él pone 1.000, tú 4 (`proporcion` = 0.004) |
| `patrimonio` | Un porcentaje de tu saldo | Crece y se encoge contigo |

Los tres pasan siempre por `compraMinUsd` y `compraMaxUsd`. Eso es lo que impide que un
líder que de repente mueve 100.000 dólares te arrastre a una posición de 400.

Si el líder hace un cambio de token a token (sin SOL ni USDC de por medio), no hay forma
de saber cuántos dólares movió: ahí el modo proporcional cae al monto fijo en vez de
inventar un tamaño.

## Cómo decide cuándo vender

Cuatro gatillos, cualquiera cierra la posición:

1. **El líder vende.** Se copia la *fracción*, no el monto: si soltó el 40% de lo que
   tenía, sueltas el 40% de lo tuyo. Si empezaste a seguirlo cuando ya tenía el token
   y por eso no viste su compra, se usa `fraccionVentaDesconocida` (por defecto: vender
   todo, porque quedarse adentro sin referencia es peor).
2. **Stop loss** (`stopLossPct`): piso duro.
3. **Trailing stop** (`trailingActivaPct` / `trailingCaidaPct`): desde cierta ganancia
   empieza a seguir el punto más alto y vende si cae X% desde ahí.
4. **Take profit** (`takeProfitPct`): techo duro.

Para que el trailing y el take profit hagan trabajo distinto, `takeProfitPct` tiene que
ser mayor que `trailingActivaPct`. Con los valores por defecto (40 y 60): sube a +45%,
se arma el trailing; si se da vuelta, sales con ganancia; si sigue subiendo hasta +60%,
cierras ahí.

**Sobre el "no me dejaba vender":** cada venta se reintenta tres veces subiendo el
slippage (300 → 600 → 1050 puntos base) y la propina de prioridad. Si aun así no sale,
te avisa por Telegram con el error exacto en vez de quedarse callado.

---

## Los filtros que corren antes de cada compra

- **Prueba de salida (anti honeypot):** antes de comprar, se cotiza la venta de lo que
  vas a recibir. Si no hay ruta de vuelta, no se compra. Es el filtro más barato que
  existe contra los tokens de los que no se sale.
- **Impacto de precio:** si tu propia compra mueve el precio más que `impactoMaxPct`,
  no hay liquidez suficiente.
- **Topes:** posiciones abiertas, compras por día, pérdida diaria.
- **Enfriamiento por token** y **no promediar** (salvo que lo enciendas).
- **Reserva de SOL** que nunca se gasta, para que siempre puedas pagar la comisión de
  la venta. Quedarte sin SOL para vender es la forma tonta de perder una posición.

---

## Cómo está hecho

```
src/
  config.js            configuración y validación de parámetros
  store.js             estado en un JSON, escrito de forma atómica
  log.js               registro que censura claves, tokens y frases
  solana/
    rpc.js             JSON-RPC con failover y reintentos
    swapdetect.js      detecta compras y ventas por deltas de saldo  ← el corazón
    watcher.js         vigila las wallets seguidas
    jupiter.js         cotiza, firma, envía y confirma
    wallet.js          keystore cifrado
  core/
    reglas.js          decisiones puras (tamaño, fracción, filtros, salidas)
    engine.js          orquestador
  telegram/bot.js      la interfaz
  cli/                 wallet y diagnóstico
```

**La decisión de diseño que más importa** está en `swapdetect.js`: en vez de entender
cada DEX (Raydium, Pump.fun, Meteora, Jupiter, Photon y el que salga mañana), el bot
mira cómo cambiaron los saldos del líder dentro de la transacción. Si le entró un token
y le salió SOL, compró. Punto. Eso funciona con cualquier lanzador presente y futuro,
y es lo que hace que no se rompa cada vez que aparece una plataforma nueva.

Dependencias: tres (`@solana/web3.js`, `bs58`, `grammy`). Todo lo demás es Node.

### Pruebas

```bash
npm test
```

54 pruebas, todas sin red: detección de swaps sobre transacciones de ejemplo (incluyendo
los casos que engañan: transferencias simples, renta devuelta al cerrar una cuenta, SOL
envuelto, operaciones fallidas, movimientos de otra wallet en la misma transacción),
reglas de tamaño y salida, cifrado de la billetera, censura del log y el recorrido
completo lider compra → yo copio → lider vende → yo vendo.

---

## Cuando algo falla

| Síntoma | Qué pasa |
|---|---|
| `Jupiter HTTP 429` | Te quedaste sin cuota. Pon `JUPITER_API_KEY` o sube `POLL_MS`. |
| `La RPC no responde` | La pública está saturada. Consigue una propia y ponla en `RPC_URL`. |
| `blockhash vencido` | La red está congestionada. Sube `prioridadMaxLamports`. |
| No copia nada | Mira `/lideres`: copia solo desde que lo agregaste. Y `/estado` para ver si está en pausa. |
| `La frase de paso no abre` | `WALLET_PASSPHRASE` no coincide con la del archivo. |
| Compras rechazadas | `/estado` y `/config`: casi siempre es un tope (posiciones, compras del día, pérdida diaria). |

---

## Aviso

Software para uso personal, sin garantías. Operar memecoins es de alto riesgo y puedes
perder todo lo que deposites. Ni Jupiter, ni las RPC, ni este código son servicios
regulados. Tú eres responsable de tus operaciones y de tus impuestos.
