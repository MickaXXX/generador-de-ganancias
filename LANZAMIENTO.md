# Plan de lanzamiento

## 1. La verdad, antes de nada

Pediste ingresos automáticos con el mínimo esfuerzo tuyo. Te debo la parte honesta
antes de la parte entretenida:

**No existe software que genere dinero desde cero sin que alguien vea algo de
valor.** Todo lo que promete «$X al día en piloto automático» sin producto y sin
audiencia es una de tres cosas: rendimiento esperado negativo (apuestas, bots de
arbitraje), violación de términos de servicio (granjas de anuncios, contenido
masivo generado), o directamente estafa. No te construí nada de eso a propósito.

Lo que sí se puede automatizar por completo es **todo menos el primer contacto**:
el producto, el cobro, la entrega, la validación de licencia y el soporte de
primer nivel corren solos 24/7. Lo que queda para ti es publicar unas cuantas
veces. En este archivo te dejo esos textos ya escritos.

**Por qué esto y no otra cosa.** Tu activo escaso no es «saber programar»: es que
tienes una metodología propia de clasificación de criticidad de repuestos, título
de ingeniería industrial, y vives en Antofagasta, donde cada planta minera
administra miles de SKU de repuestos y pierde plata simultáneamente por
sobrestock y por quiebres. Ese conocimiento vale plata. El software solo lo
empaqueta para que se venda mientras duermes.

---

## 2. Cómo está armado el ingreso

```
   Alguien busca "criticidad de repuestos" o ve tu post
                        ↓
        Sitio gratis  ·  sube su maestro  ·  0 fricción
                        ↓
   "Tienes US$430.000 dormidos y 16 repuestos críticos sin cobertura"
                        ↓
   ┌────────────────┬─────────────────────┬──────────────────────┐
   │  Kit Excel     │  CritiSpare Pro     │  Implementación      │
   │  US$29         │  US$149             │  US$1.500 – 4.000    │
   │  impulso       │  licencia anual     │  el ticket grande    │
   └────────────────┴─────────────────────┴──────────────────────┘
        automático        automático            requiere tu tiempo
```

El truco está en el paso 3: la herramienta gratuita **no muestra una demo, muestra
el problema del cliente con sus propios números**. Nadie discute un número que
salió de su propio maestro de repuestos.

---

## 3. Checklist de lanzamiento (unos 30 minutos, una sola vez)

- [ ] **Publica el sitio.** En GitHub: *Settings → Pages → Source: **GitHub Actions***.
      Queda en `https://<tu-usuario>.github.io/generador-de-ganancias/`. Costo: $0.
- [ ] **Crea tu par de claves de licencia:** `npm run licencia:par -- --forzar`.
      Pega la clave pública que imprime en `docs/config.js`.
- [ ] **Crea la cuenta de cobro.** [Gumroad](https://gumroad.com) o
      [Lemon Squeezy](https://lemonsqueezy.com): ambas cobran con tarjeta
      internacional, entregan el archivo solas y emiten claves de licencia solas.
      Son *merchant of record*: se hacen cargo de los impuestos por ti.
- [ ] **Sube dos productos:**
      1. *Kit de Criticidad de Repuestos* — US$29 — sube
         `producto/Kit-Criticidad-Repuestos.xlsx`.
      2. *CritiSpare Pro* — US$149 — activa «generar clave de licencia».
- [ ] **Pega en `docs/config.js`** el `linkCompra` y el `gumroadProductId`.
- [ ] **Pon tu correo** en `emailContacto` (ahí llega el ticket grande).
- [ ] `git push` y listo. **Desde aquí el cobro es 100% automático.**

---

## 4. Textos listos para copiar y pegar

### LinkedIn (tu mejor canal: tu red ya es industrial)

> Una planta con 4.000 repuestos en bodega suele tener entre 25% y 40% de ese
> capital inmovilizado de más. Y al mismo tiempo, repuestos clase A sin cobertura.
> Las dos cosas a la vez. No es contradictorio: es que casi nadie clasifica por
> criticidad real, se clasifica por precio.
>
> Armé una herramienta gratuita que toma tu maestro de repuestos y calcula:
> · el índice de criticidad de cada SKU con pesos objetivos (entropía + TOPSIS),
>   no con los pesos que salieron de una reunión;
> · la política (R,S) que le corresponde a cada clase;
> · cuánto capital puedes liberar y qué repuestos te van a dejar la planta parada.
>
> Corre entera en tu navegador: tu maestro NO se sube a ningún servidor. Sin
> registro, sin instalar nada.
>
> 👉 [tu link]
>
> Si trabajas en mantenimiento, confiabilidad o bodega, pruébala con tu data real
> y cuéntame qué número te dio. Tengo curiosidad por el rango que sale en la
> industria local.

### Correo a un jefe de mantenimiento (uno a uno, nunca masivo)

> Asunto: cuánto capital tiene inmovilizado la bodega de [Planta]
>
> Hola [Nombre]:
>
> Soy Mickael, ingeniero industrial en Antofagasta. Trabajé el problema de
> clasificación de criticidad de repuestos y armé una herramienta que estima, a
> partir del maestro de repuestos, cuánto capital está inmovilizado de más y qué
> repuestos críticos están bajo cobertura.
>
> Es gratis y corre en el navegador: el archivo no se sube a ninguna parte, lo
> puede probar el propio equipo de bodega en 5 minutos sin pasar por TI.
>
> [tu link]
>
> Si el número le hace sentido, le puedo mostrar cómo bajarlo a política de
> reposición por SKU.
>
> Saludos,
> Mickael

### Descripción del producto en Gumroad

> **Kit de Criticidad de Repuestos** — planilla Excel con fórmulas vivas.
>
> Pega tu maestro de repuestos y obtén, sin macros y sin instalar nada:
> · índice de criticidad por SKU (entropía de Shannon + TOPSIS);
> · clasificación ABC por impacto de Pareto real, no por precio;
> · política (R,S) por clase: stock de seguridad, nivel objetivo y punto de revisión;
> · capital liberable y alerta de repuestos bajo cobertura;
> · resumen ejecutivo listo para llevar a comité.
>
> Incluye 60 filas de ejemplo de una planta industrial y capacidad para 300 SKU.
> Parámetros ajustables: nivel de servicio, periodo de revisión, variabilidad de
> la demanda y cortes de Pareto.

---

## 5. Cuánto es realista

Tu meta era del orden de **US$1 al día ≈ US$30 al mes**. Traducido:

| Escenario | Ventas al mes | Ingreso mensual |
|---|---|---|
| Muy conservador | 1 Kit (US$29) | US$29 |
| Realista con 2 posts al mes | 2 Kits + 1 Pro | US$207 |
| Si entra 1 implementación al año | — | +US$125/mes promedio |

Es decir: **una sola venta del Kit al mes ya cumple tu objetivo**. El techo no
está en el software (que escala infinito sin costo), está en cuánta gente lo ve.

Un aviso justo: esto no arranca solo. Sin publicar nada, el ingreso esperado es
cero — no porque la herramienta sea mala, sino porque nadie sabrá que existe. El
esfuerzo mínimo real es publicar el post de arriba una vez y responder a quien
comente.

---

## 6. Qué corre solo y qué no

| Corre solo, para siempre | Necesita tu mano |
|---|---|
| El sitio (estático, gratis, sin mantención) | Publicar el post inicial |
| El cálculo completo | Responder los comentarios |
| Cobro con tarjeta 24/7 | Vender la implementación (el ticket grande) |
| Entrega del archivo al comprador | |
| Emisión y validación de la licencia | |
| Bloqueo de licencias falsas o reembolsadas | |

---

## 7. Siguientes pasos, ordenados por retorno

1. **Publica y postea.** Todo lo demás depende de esto.
2. **Mide.** Agrega analítica sin cookies (Plausible o GoatCounter) para saber
   cuántos suben un archivo de verdad.
3. **Cobra en pesos chilenos.** Si el mercado local resiste mejor Webpay/MercadoPago,
   emite la licencia a mano con `npm run licencia:emitir` — toma 10 segundos por venta.
4. **Sube el precio de la implementación.** Es donde está el margen real, y tu
   tiempo es el insumo escaso.
