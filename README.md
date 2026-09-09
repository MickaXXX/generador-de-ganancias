# CritiSpare — motor de criticidad de repuestos + micro-SaaS

Herramienta que convierte un maestro de repuestos (Excel o CSV) en tres respuestas
que cualquier jefe de mantenimiento o de bodega necesita y casi nadie tiene:

1. **Cuánto capital está dormido** en sobrestock, en pesos.
2. **Qué repuestos críticos están bajo cobertura** y pueden parar la planta.
3. **Qué política de inventario (R,S)** le corresponde a cada SKU.

Todo el cálculo ocurre en el navegador del usuario: **los datos nunca se suben a
ningún servidor**. Eso elimina el principal bloqueo de venta en la industria
(«no puedo mandar el maestro de mi planta a una nube gringa») y a la vez elimina
el costo de infraestructura: el sitio es estático y se aloja gratis.

---

## Qué hay aquí

| Ruta | Qué es |
|---|---|
| `docs/` | El sitio completo. Es la raíz de GitHub Pages. |
| `docs/core/criticidad.js` | El motor: entropía de Shannon → TOPSIS → k-means → ABC → (R,S). Sin dependencias. |
| `docs/core/licencia.js` | Verificación de licencias firmadas (ECDSA P-256) y de Gumroad. |
| `docs/config.js` | **El único archivo que necesitas editar** para vender. |
| `producto/Kit-Criticidad-Repuestos.xlsx` | El producto digital vendible: el mismo método en fórmulas vivas de Excel. |
| `scripts/licencia.mjs` | Emite licencias firmadas desde la línea de comandos. |
| `datos/` | Maestros de ejemplo: 200 SKU de una planta embotelladora (CSV y Excel). |
| `test/` | Pruebas del motor, de licencias, de la interfaz en navegador real y del Excel. |
| `LANZAMIENTO.md` | El plan comercial: qué hacer, en qué orden, con los textos ya escritos. |

---

## Método

El punto de venta no es «una calculadora más», es que **los pesos no los pone
nadie a dedo**:

1. **Pesos por entropía de Shannon.** Cada criterio (precio, consumo, lead time,
   criticidad del equipo, horas de parada, número de proveedores) recibe un peso
   proporcional a la información que aporta *en esa data*. Un criterio que no
   discrimina entre repuestos pesa cero. Esto mata la discusión de comité.
2. **TOPSIS.** Índice de criticidad entre 0 y 1 por distancia a la solución ideal
   y a la anti-ideal. Comparable entre plantas y a lo largo del tiempo.
3. **Familias por k-means.** El portafolio se segmenta por perfil de precio,
   rotación y lead time (en escala logarítmica, porque los repuestos tienen colas
   muy largas). El número de familias se elige maximizando el coeficiente de
   silueta, no a ojo.
4. **ABC híbrido** sobre criticidad × exposición económica, y **política (R,S)**
   por clase: nivel de servicio, periodo de revisión, stock de seguridad, nivel
   objetivo S, exceso y capital liberable.

Dos decisiones del método que no son obvias, y que salieron de probar el motor
con un maestro real de embotelladora (200 SKU, rango de 286× en consumo y 54× en
precio):

- **Precio y consumo se comparan en escala logarítmica.** Sin eso, el sesgo de
  esos criterios se cuenta dos veces —la entropía premia la dispersión y la
  normalización vectorial de TOPSIS la vuelve a premiar— y el ranking termina
  encabezado por el consumible más barato de la planta en vez de por el repuesto
  OEM de proveedor único.
- **La exposición económica es `precio × (consumo + 1)`, no `precio × consumo`.**
  Ese `+1` es el valor de una unidad en riesgo, y es lo que rescata al repuesto
  de capital: un rotor de US$28.000 que no sale de bodega en años tiene valor de
  consumo cero y con el criterio de solo-consumo caía a clase C, siendo
  justamente el que más capital inmoviliza y el que puede parar la planta meses.
- **El corte de Pareto se acota por proporción de clase** (20% / 30% / 50%). Un
  portafolio de repuestos rara vez es Pareto puro: si el top 20% reúne solo la
  mitad del impacto, el corte del 80% mandaría media bodega a clase A con nivel
  de servicio 99% y revisión semanal. La herramienta muestra la concentración
  real para que quien decide sepa en qué caso está.

---

## Uso local

```bash
npm install          # solo para las pruebas; el sitio no necesita build
npm run servir       # http://localhost:8080
```

El sitio es HTML, CSS y JavaScript plano. No hay bundler, ni framework, ni
dependencias en tiempo de ejecución: SheetJS va incrustado en `docs/vendor/`
para que la herramienta **funcione incluso sin internet**, detrás del firewall
de una planta.

## Pruebas

```bash
npm test             # 49 pruebas del motor y del sistema de licencias
npm run test:e2e     # flujo completo en Chromium real, con la red externa cortada
npm run test:excel   # compara las fórmulas del Excel contra el motor JS (necesita LibreOffice)
```

`npm run test:excel` es la prueba más importante del producto vendible: recalcula
la planilla con LibreOffice y verifica que dé **exactamente** el mismo resultado
que el motor del sitio, repuesto por repuesto. Corre dos veces: con el maestro
genérico y con el de embotelladora, que es el caso duro por su rango dinámico.

Los maestros de ejemplo se regeneran con `npm run demo` (CSV) y
`npm run base:embotelladora` (Excel presentable). Son deterministas: misma
semilla, mismos datos.

## Emitir licencias

```bash
npm run licencia:par                                   # una sola vez: crea tu par de claves
npm run licencia:emitir -- --cliente "Minera X" --dias 365
```

La clave privada queda en `.claves/` (ignorada por git). El sitio solo lleva la
clave pública, así que **cualquiera puede verificar una licencia y nadie puede
fabricarla**, sin necesidad de servidor ni base de datos.

> La `CLAVE_PUBLICA` que viene en `config.js` es de demostración. Al correr
> `npm run licencia:par -- --forzar` la reemplazas por la tuya y la licencia de
> demo deja de funcionar (que es justo lo que quieres antes de vender).

## Publicar

`docs/` es la raíz del sitio. En GitHub: **Settings → Pages → Source: GitHub
Actions**. El workflow `.github/workflows/pages.yml` publica en cada push a
`main`. Costo de alojamiento: cero.

---

Ver **[LANZAMIENTO.md](LANZAMIENTO.md)** para el plan comercial paso a paso.
