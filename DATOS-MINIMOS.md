# Datos mínimos que debe tener el cliente

Esto es lo que le pides a un interesado para poder analizarle su bodega. La
plantilla lista para enviar está en **`producto/Plantilla-Datos-Minima.xlsx`**
(sus encabezados son reconocidos automáticamente por la herramienta: el cliente
no configura nada, y tú tampoco).

---

## El mínimo absoluto: 4 columnas

Sin estas cuatro no hay análisis posible.

| Columna | Unidad | Dónde suele estar |
|---|---|---|
| **SKU / código** | texto | SAP: `MARA-MATNR`. Maximo: `ITEMNUM`. O el código interno de bodega. |
| **Precio unitario** | una sola moneda | Precio de reposición o valor de inventario. SAP: `MBEW-VERPR` / `STPRS`. |
| **Consumo anual** | unidades/año | Salidas de bodega de los últimos 12 meses. SAP: MB51, movimientos 201/261. Maximo: `MATUSETRANS`. |
| **Lead time** | días corridos | Plazo real del proveedor. SAP: `MARC-PLIFZ` o el registro info de compra. |

## Los 6 opcionales (cada uno suma)

| Columna | Qué aporta | Si falta |
|---|---|---|
| **Stock actual** | **El más importante de todos.** Es el que produce el número que convence a gerencia. | Sin capital liberable ni alerta de quiebre. El análisis pierde su punta comercial. |
| **Criticidad del equipo (1-5)** | La mirada de proceso: 5 = su parada detiene producción, 1 = sin impacto. Sale del análisis de criticidad o del RCM. | El índice se calcula igual con los otros criterios. |
| **Horas de parada si falla** | MTTR con el repuesto en mano. Pondera el impacto de indisponibilidad. | Se pierde esa ponderación. |
| **N.º de proveedores** | 1 proveedor = punto único de falla. Es criterio de *costo*: menos proveedores, más crítico. | Se pierde la señal de riesgo de abastecimiento. |
| **Descripción** | Que bodega entienda el informe. | El análisis corre, pero el resultado es ilegible para quien lo ejecuta. |
| **Categoría / familia** | Permite filtrar y comparar por grupo. | Solo se pierde ese corte. |

---

## Cuántas filas hacen falta

Medido sobre el motor, comparando contra un maestro de 2.000 SKU:

| SKU en el archivo | Desvío de los pesos | Veredicto |
|---|---|---|
| 5 | 8,1 pp | No sirve: los pesos son ruido |
| 10 | 5,1 pp | Muy inestable |
| 20 | 2,2 pp | Aceptable para una demo |
| 50 | 1,8 pp | Ya es defendible |
| 100 | 1,0 pp | Bueno |
| 500+ | 0,6 pp | Óptimo |

Técnicamente corre desde 2 filas, y las familias por k-means necesitan al menos
6. Pero **pide siempre el maestro completo**: el método no tiene tope superior,
y filtrar la muestra sesga justamente lo que buscas.

---

## Las 10 revisiones antes de analizar

Cada una es un error que arruina un análisis entero. Van también como checklist
imprimible en la plantilla.

1. **Una fila por SKU.** Sin subtotales, sin encabezados repetidos a mitad de
   tabla, sin celdas combinadas. SKU duplicado: consolidar antes.
2. **Consumo = salidas, no compras.** El error más común y el más caro: comprar
   100 unidades no es haberlas consumido. Si usas compras, el modelo sobreestima
   la demanda y te hace comprar todavía más.
3. **Una sola moneda.** Si el maestro mezcla USD y CLP, convierte antes. La
   herramienta no detecta monedas mezcladas.
4. **12 meses móviles**, no un año calendario incompleto: subestima todo lo
   estacional.
5. **Celdas vacías, no texto.** Nada de `N/A`, `s/i`, `-`: eso se lee como cero.
6. **Números sin unidad adentro.** `30`, no `"30 días"`. Los símbolos de moneda y
   separadores de miles sí se toleran (`$ 1.234,56` se lee bien, en formato
   chileno o inglés).
7. **Incluye los de rotación cero.** No los filtres: son precisamente los que
   tienen más capital inmovilizado.
8. **Revisa los precios en cero.** Si más del 20% de los SKU tiene precio 0 o
   vacío, corrige el maestro primero; el resultado no sería defendible.
9. **Lead time real, no el teórico.** Si el proveedor es errático, carga el
   percentil 90 de los últimos pedidos.
10. **No anonimices los códigos** si vas a implementar después: sin el SKU real,
    el plan de acción no se puede ejecutar en bodega.

---

## Cómo usarlo para vender

La plantilla no es un trámite, es el gancho. El mensaje que funciona:

> «Mándame estas 4 columnas de tu maestro de repuestos y te digo cuánto capital
> tienes inmovilizado de más y qué repuestos críticos están bajo cobertura. Si
> además me mandas el stock actual, te lo doy en pesos.»

Es una petición chica (cuatro columnas que salen de un reporte estándar del ERP)
a cambio de una respuesta grande y específica sobre *su* planta. Y como el
cálculo corre en el navegador, puedes agregar la frase que desarma la objeción de
TI: **el archivo no se sube a ninguna parte.**
