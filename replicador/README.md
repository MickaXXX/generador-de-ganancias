# Replicador de transacciones de FOMO

App local con dos botones: **Correr réplica de transacciones del usuario** y
**Detener automatización**. Vigila a un trader de FOMO y replica sus
operaciones en tu billetera, escaladas a tu presupuesto.

> Esto opera con memecoins. La pérdida total del capital es un resultado
> normal, no un caso raro. Nada de esto es asesoría financiera.

## Arrancar

```bash
npm install
npm run replicador     # http://127.0.0.1:4310
```

Arranca en **modo demo**, que no toca la red ni necesita clave. Los tres modos
se eligen desde la propia interfaz.

| Modo | De dónde salen las operaciones | A dónde va el dinero | Necesita clave |
|---|---|---|---|
| Demo sin red | cadena simulada | a ningún lado | no |
| **Papel con datos reales** | operaciones reales del trader | a ningún lado | no |
| Dinero real | operaciones reales del trader | tu billetera | sí |

**El modo papel es el importante.** Es el único que contesta si el trader que
elegiste vale la pena copiar, y no cuesta nada equivocarse. Dejalo corriendo
dos semanas antes de conectar un peso.

## La clave privada

**Nunca se pega en el navegador.** No hay ningún campo ni endpoint que la
acepte, y hay una prueba automatizada que lo verifica. Se lee de esta máquina:

```bash
echo "TU_CLAVE_BASE58" > replicador/.clave    # 88 caracteres, ya está en .gitignore
# o bien
CLAVE_PRIVADA=... npm run replicador
```

El servidor escucha solo en `127.0.0.1`: no queda expuesto a tu red ni a
internet.

Usá una billetera **separada**, creada para esto, con solo el monto que estés
dispuesto a perder entero. Nunca la principal.

## A quién replicar

Pegá el perfil de FOMO (`https://fomo.family/profile/Usuario`) y apretá
**Resolver**. Si la resolución automática falla, abrí el perfil en la app de
FOMO, copiá la dirección de la billetera y pegala: siempre funciona.

## Qué hace por dentro

```
Trader  ──►  Fuente  ──►  Decodificador  ──►  Política  ──►  Ejecutor  ──►  Cartera
            on-chain      deltas de balance    filtros       Jupiter
```

- **Decodificador** (`motor/decodificador.mjs`). Lee los deltas de balance de
  la transacción en vez de parsear cada DEX. Funciona con Raydium, Orca,
  Meteora, Pump.fun y con el que salga el mes que viene, sin tocar código.
- **Escalado sin oráculo de precios.** Copia la *fracción*, no el monto: si él
  gasta el 4% de su saldo, vos gastás el 4% del tuyo; si vende el 60% de su
  posición, vendés el 60% de la tuya. Las ventas calzan exactas y no queda
  polvo.
- **Política** (`motor/politica.mjs`). Rechaza tokens cuyo creador puede
  imprimir unidades o congelar tu billetera, pools sin liquidez o recién
  creados, órdenes que no pagan sus fees, y cualquier token del que no haya
  datos. Cada rechazo queda en el registro con su motivo.
- **Trailing stop propio**. Sale sin esperar a que el trader venda. Él mueve
  mucho y tarda; vos movés poco y salís en un bloque. Es el único terreno donde
  le podés ganar.
- **Cortacircuitos**. Si el drawdown pasa el límite, se apaga solo.

## Pruebas

```bash
npm run test:replicador       # 35 pruebas del motor, la política y los datos de mercado
npm run test:replicador:e2e   # 20 verificaciones manejando la interfaz en Chromium real
```

## Lo que no está probado contra la red

La política de egreso del entorno donde se escribió esto bloquea `fomo.family`,
los RPC de Solana, Jupiter y DexScreener. Quedan sin probar en vivo, y son las
únicas partes así:

- la llamada HTTP de `EjecutorJupiter` (el armado y firmado de la transacción sí
  está verificado),
- la suscripción por WebSocket de `FuenteSolana`,
- las llamadas HTTP de `MercadoReal` (su parseo sí está cubierto con respuestas
  inyectadas),
- la resolución automática del perfil de FOMO (pegar la dirección a mano siempre
  funciona).

Antes de usar el modo real, corré una operación con el presupuesto mínimo y
verificala a mano en un explorador de bloques.
