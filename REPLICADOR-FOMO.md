# Replicador de transacciones FOMO — diseño

Objetivo: que las operaciones de un trader elegido (por ejemplo el top del
leaderboard de FOMO) se repliquen solas en una billetera propia de USD 100,
escaladas a un porcentaje del presupuesto, sin que yo tenga que mirar
notificaciones ni apretar nada.

> **Advertencia.** Esto opera con memecoins. La pérdida total del capital es un
> resultado normal, no un caso raro. Nada de este documento es asesoría
> financiera. La billetera de replicación debe ser una billetera separada, con
> solo el dinero que estoy dispuesto a perder por completo.

---

## 1. El cambio de enfoque

El instinto es automatizar la app de FOMO: leer sus notificaciones, mover su
interfaz, buscarle una API privada. Las tres cosas son frágiles, se rompen en
cada actualización y muy probablemente violan sus términos de servicio.

No hace falta nada de eso. **FOMO es no custodial y vive sobre Solana.** Eso
significa que el trader del leaderboard *es* una dirección pública de Solana, y
su operación queda escrita en un libro público mundial **antes** de que el
servidor de FOMO alcance a generar la notificación que me llegaría al teléfono.

Entonces el diseño correcto es: **no replicar la app, replicar la cadena.**

```
 Trader del leaderboard
          │  (su swap entra al ledger de Solana)
          ▼
   ┌──────────────┐
   │  1. RESOLVER │  usuario de FOMO ──► dirección de wallet   (una vez, a mano)
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  2. OIDO     │  stream on-chain suscrito a esa cuenta
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  3. TRADUCTOR│  {token, compra/venta, monto, DEX}
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  4. MANO     │  swap propio, escalado a % de MI billetera
   └──────────────┘
```

La cuenta de FOMO queda solo como visor. El motor vive afuera, es público, es
legal y es más rápido que la notificación.

### Las cuatro piezas, en concreto

**1. Resolver.** El perfil del trader en FOMO expone su dirección. Servicios
como FomoScan o FomoAPI indexan el mapeo usuario → wallet. Esto se hace una vez
y se pega en un archivo de configuración. No necesita automatizarse.

**2. Oído.** Dos niveles, y conviene empezar por el barato:

| Nivel | Mecanismo | Latencia aprox. | Costo |
|---|---|---|---|
| Arranque | WebSocket `logsSubscribe` en Helius o QuickNode | 200-400 ms | plan gratis |
| Producción | Yellowstone gRPC (plugin Geyser) | 10-40 ms | USD 50-300/mes |

Se empieza con WebSocket. Se migra a gRPC solo cuando los datos del modo sombra
demuestren que la latencia está costando dinero de verdad.

**3. Traductor.** Acá está el atajo que casi ningún tutorial menciona. En vez de
escribir un parser por cada DEX (Raydium, Orca, Meteora, Pump.fun, Jupiter, y
el que salga el mes que viene), se leen los **deltas de balance** de la propia
transacción: los campos `preTokenBalances` y `postTokenBalances` que Solana ya
entrega. Si el trader terminó con más del token X y menos SOL, compró X. Punto.

Esto es más corto, más robusto y funciona con cualquier DEX presente o futuro
sin tocar una línea de código.

**4. Mano.** Cotizar y ejecutar contra la API de swap de Jupiter, que rutea sola
por el mejor camino, más una propina de prioridad para que la transacción entre
rápido. El monto no se copia: se escala. Si el trader mueve el 4% de su
portafolio, yo muevo el 4% del mío.

---

## 2. Las ideas que hacen la diferencia

Lo anterior es la mesa. Esto es lo que separa un bot que pierde plata de uno que
tiene una chance.

### 2.1 Copiar el *estado*, no los *eventos*

Todos los bots de copy trading copian transacciones. Es frágil: si se pierde una
venta por una caída de red, quedo colgado con la bolsa y el bot no se entera
nunca.

La alternativa: definir el objetivo como **"mi cartera debe verse igual a la
suya, en porcentajes"**. Cada N segundos comparo mi composición contra la suya y
ejecuto únicamente la diferencia.

Esto es **idempotente y se auto-repara**. Si el bot se cae dos horas, al volver
converge solo. Si fallé una compra, no importa. Elimina de raíz toda la familia
de errores de "estado desincronizado", que es donde mueren estos proyectos.

Y lo mejor es que se combinan los dos: **el evento on-chain es el gatillo para
reaccionar rápido, la reconciliación de estado es la verdad.** Rápido cuando se
puede, correcto siempre.

### 2.2 Copiarle las entradas y ser mejor que él en las salidas

Replicar de forma simétrica es matemáticamente perdedor. Llego después en la
compra, o sea peor precio, y llego después en la venta, o sea peor precio otra
vez. La asimetría se acumula en contra.

La vuelta: **copio sus compras, pero no espero su venta.** Como sé qué posición
tengo, le pongo mi propio trailing stop que se dispara si el precio cae un X%
desde el máximo alcanzado.

El punto fino: él mueve cientos de miles de dólares y tarda en salir sin mover
el precio. Yo muevo veinte dólares y salgo en un solo bloque. **Mi desventaja de
tamaño en la entrada es mi ventaja de liquidez en la salida.** Es el único
terreno donde le puedo ganar al trader al que estoy copiando.

### 2.3 Índice de replicabilidad: no copiar al número uno

Esta es la idea central y es contraintuitiva.

El PnL del leaderboard es **no replicable por definición**. El que hizo 50x
entró en el segundo cero de un lanzamiento. Yo nunca voy a estar ahí.

Entonces, en vez de ordenar por ganancia, se ordena por **cuánta de esa ganancia
sobrevive a mi retraso**. El historial completo de cada wallet es público, así
que se puede calcular sobre datos reales:

> Para cada operación del trader, recalcular su resultado asumiendo que entré 3
> segundos tarde y salí 3 segundos tarde, con el slippage real del pool.
> El índice es: ganancia replicada ÷ ganancia original.

Resultados esperables:

| Perfil de trader | Índice aprox. | Conclusión |
|---|---|---|
| Sniper de lanzamientos | 0.0 - 0.1 | Imposible de copiar |
| Scalper de minutos | 0.2 - 0.5 | Marginal, los fees se lo comen |
| Swing de horas | 0.7 - 0.9 | **Este es el que sirve** |

**El mejor trader para copiar casi nunca es el primero del ranking. Es el más
lento de los buenos.** Un tipo que sostiene posiciones seis horas me deja
capturar casi todo su resultado, porque tres segundos de retraso sobre seis
horas no son nada.

Esto por sí solo vale más que toda la optimización de latencia.

### 2.4 Quórum de traders, no un ídolo

Copiar una sola wallet es un único punto de falla. Y hay un riesgo peor: que el
número uno sea un insider, esté haciendo wash trading para figurar, o
simplemente tenga su mes de suerte.

En cambio, seguir cinco wallets y **ejecutar solo cuando dos o más compran el
mismo token dentro de una ventana de diez minutos**. Ese consenso filtra casi
todo el ruido y casi todas las trampas, y no requiere ningún modelo: son cuatro
líneas de lógica.

### 2.5 Defensa contra el trader que sabe que lo copian

Los traders del leaderboard saben perfectamente que hay bots detrás. Algunos lo
explotan: compran un token ilíquido que ellos mismos controlan, esperan a que
los bots entren detrás, y venden contra esos bots.

Las defensas son baratas y salvan la cuenta entera:

- Liquidez mínima del pool antes de entrar.
- Edad mínima del pool, para descartar lanzamientos recién creados.
- Verificar que el token no tenga `mint authority` ni `freeze authority` activas.
  Si las tiene, el creador puede imprimir tokens infinitos o congelar mi
  billetera para que no pueda vender.
- Tope duro de porcentaje del presupuesto por token.

Son unas veinte líneas de código y son la diferencia entre perder un trade y
perderlo todo.

### 2.6 Modo sombra obligatorio

Antes de conectar un solo dólar, el sistema corre dos semanas completo pero sin
ejecutar: registra qué *habría* hecho, a qué precio real, con qué slippage
estimado y qué fees.

Es el mismo código sin la llamada final de ejecución, o sea que es la feature
más barata de construir y la más valiosa de todas. Lo más probable es que
revele que el trader elegido no era replicable, y eso ahorra los USD 100 antes
de arriesgarlos.

### 2.7 Cortacircuitos

- Billetera separada, exclusiva, con exactamente el presupuesto. Nunca la
  principal.
- Si el drawdown del día supera un umbral, el bot se apaga solo y avisa.
- Tamaño mínimo por operación, para que los fees no se coman la posición.
- Máximo de posiciones simultáneas.

---

## 3. Lo que va a doler

**La matemática de los USD 100.** Con ese capital, los costos de red, las
propinas de prioridad y el slippage pesan muchísimo en términos relativos. Con
veinte operaciones diarias es muy probable que los costos superen a las
ganancias sin importar qué tan bueno sea el trader copiado. Mitigación: pocas
operaciones, tamaño mínimo razonable por trade, y preferir traders de horizonte
largo, que es justo lo que recomienda el índice de replicabilidad.

**Esto ya existe.** Hay bots de Telegram de terceros que replican traders del
leaderboard de FOMO. Vale la pena probar uno una semana antes de escribir una
sola línea: calibra expectativas con datos reales y sale más barato que el
tiempo de desarrollo.

**El servidor importa.** Un VPS barato mal ubicado agrega cien milisegundos
gratis. El proceso debe correr geográficamente cerca de los validadores de
Solana, no en la casa.

**Automatizar la app de FOMO directamente es el camino equivocado.** Frágil,
probablemente contra sus términos de servicio, y expuesto a que cierren la
cuenta. La ruta on-chain usa exclusivamente datos públicos, no toca la cuenta, y
es más rápida.

---

## 4. Ruta de cuatro fines de semana

| Fin de semana | Entrega | Riesgo de capital |
|---|---|---|
| 1 | Resolver wallet del trader, escuchar por WebSocket, loguear sus swaps a un archivo | Cero |
| 2 | Traductor por deltas de balance + modo sombra corriendo | Cero |
| 3 | Índice de replicabilidad sobre el historial público, para elegir a quién copiar | Cero |
| 4 | Ejecución real por Jupiter, con cortacircuitos y billetera separada | USD 100 |

Los primeros tres fines de semana no arriesgan nada y responden la pregunta más
importante: **¿este trader es replicable?** Si la respuesta es no, el proyecto
termina ahí y salió gratis.

### Stack

Node.js, que es lo que ya se usa en este repositorio. `@solana/web3.js` para
leer la cadena, WebSocket de Helius o QuickNode para el stream, API de Jupiter
para cotizar y ejecutar, estado en un JSON local. Sin base de datos, sin
framework, sin bundler, en la misma línea del resto del proyecto.

---

## 5. El producto que sale de acá

El bot es de uso personal. Pero el **índice de replicabilidad del leaderboard**
es otra cosa: una página que ranquea a los traders de FOMO por cuánta de su
ganancia se puede capturar realmente, en vez de por PnL bruto.

Eso no lo tiene nadie, se construye con datos cien por ciento públicos de la
cadena, no necesita servidor, y es exactamente el mismo patrón de micro-SaaS
estático que ya está montado en este repositorio.

El bot es para mí. El ranking es el producto.
