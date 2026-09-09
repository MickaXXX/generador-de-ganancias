#!/usr/bin/env python3
"""
Genera la plantilla que se le envia al cliente interesado para que devuelva su
maestro de repuestos en el formato que la herramienta reconoce sola.

Es tambien un activo comercial: "llename esta planilla y te digo cuanto capital
tienes dormido en bodega".

  python3 scripts/generar_plantilla_datos.py
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "producto" / "Plantilla-Datos-Minima.xlsx"
ULTIMA = 501

AZUL = "1F3864"
NARANJA = "C55A11"
VERDE = "375623"
BLANCO = "FFFFFF"

cabecera = Font(bold=True, color=BLANCO, size=10)
centro = Alignment(horizontal="center", vertical="center", wrap_text=True)
arriba = Alignment(vertical="top", wrap_text=True)
borde = Border(*[Side(style="thin", color="BFBFBF")] * 4)

# (columna, encabezado, obligatorio, unidad, de donde sale, si falta)
CAMPOS = [
    ("SKU", True, "texto",
     "SAP: numero de material (MARA-MATNR). Maximo: ITEMNUM. O el codigo interno de bodega.",
     "Sin esto no hay analisis. Es la llave de todo."),
    ("Descripcion", False, "texto",
     "Descripcion del material en el maestro.",
     "El analisis corre igual, pero los informes quedan ilegibles para bodega."),
    ("Categoria", False, "texto",
     "Grupo de articulos, familia o clase de material.",
     "Solo se pierde poder filtrar por categoria."),
    ("Precio unitario", True, "moneda, una sola",
     "Precio de reposicion, o valor de inventario (SAP: MBEW-VERPR / STPRS).",
     "Sin precio no hay capital ni criticidad economica. Es obligatorio."),
    ("Consumo anual", True, "unidades / ano",
     "Salidas de bodega de los ultimos 12 meses. SAP: MB51 movimientos 201/261. "
     "Maximo: MATUSETRANS. OJO: salidas, NO compras.",
     "Sin consumo no hay politica de inventario posible."),
    ("Lead time (dias)", True, "dias corridos",
     "Plazo real de entrega del proveedor. SAP: MARC-PLIFZ o el registro info de compra.",
     "Sin lead time no se puede calcular stock de seguridad."),
    ("Criticidad equipo (1-5)", False, "1 a 5",
     "Del analisis de criticidad de equipos o del RCM. Si no existe: 5 = su parada detiene "
     "produccion, 3 = afecta pero hay respaldo, 1 = sin impacto operacional.",
     "El indice se calcula igual con los demas criterios, pero pierde la mirada de proceso."),
    ("Horas parada si falla", False, "horas",
     "Tiempo de reparacion teniendo el repuesto en mano (MTTR).",
     "Se pierde la ponderacion por impacto de indisponibilidad."),
    ("N proveedores", False, "cantidad",
     "Proveedores homologados capaces de suministrarlo. 1 = punto unico de falla.",
     "Se pierde la senal de riesgo de abastecimiento."),
    ("Stock actual", False, "unidades",
     "Existencia fisica hoy. SAP: MARD-LABST. Maximo: INVBALANCES-CURBAL.",
     "EL MAS IMPORTANTE DE LOS OPCIONALES: sin el no hay capital liberable "
     "ni alerta de quiebre, que es justo el numero que convence a la gerencia."),
]

EJEMPLOS = [
    ["SP-1001", "Rodamiento rigido de bolas 6210", "Rodamientos", 85.5, 77, 12, 4, 29, 3, 19],
    ["SP-1002", "Sello mecanico cartucho API 682", "Sellos", 1850, 6, 75, 5, 40, 1, 2],
    ["SP-1003", "Membrana osmosis inversa 8040", "Tratamiento de agua", 680, 24, 65, 5, 36, 2, 0],
]

REGLAS = [
    ("Una fila por SKU", "Sin filas de subtotal, sin encabezados repetidos a mitad de tabla, "
     "sin celdas combinadas. Si un SKU aparece dos veces, consolidalo antes."),
    ("Consumo = salidas, no compras", "El error mas comun. Comprar 100 unidades no significa "
     "haberlas consumido; si usas compras, el modelo sobreestima la demanda y te hace comprar mas."),
    ("Una sola moneda", "Si el maestro mezcla USD y CLP, convierte todo antes. La herramienta no "
     "detecta monedas mezcladas y el resultado saldria sin sentido."),
    ("Ventana de 12 meses moviles", "No uses un ano calendario incompleto: subestima el consumo "
     "de todo lo estacional."),
    ("Celdas vacias, no texto", "Deja la celda en blanco. Nada de \"N/A\", \"s/i\", \"-\" ni \"por "
     "definir\": eso se lee como cero y contamina el calculo."),
    ("Numeros sin unidad adentro", "Escribe 30, no \"30 dias\". Simbolos de moneda y separadores "
     "de miles si se toleran ($ 1.234,56 se lee bien)."),
    ("Incluye los de rotacion cero", "No los filtres. Los repuestos que no se mueven hace anos son "
     "justamente los que mas capital tienen inmovilizado."),
    ("Revisa los precios en cero", "Si mas del 20% de los SKU tiene precio 0 o vacio, corrige el "
     "maestro antes de analizar: el resultado no seria defendible."),
    ("Lead time real, no el teorico", "Usa el plazo que el proveedor cumple de verdad. Si es "
     "erratico, carga el percentil 90 de los ultimos pedidos."),
    ("Cuantas filas", "Tecnicamente funciona desde 2 SKU. Los pesos por entropia se estabilizan "
     "sobre los 50 (bajo 20 oscilan hasta 8 puntos porcentuales) y las familias necesitan al "
     "menos 6. Lo ideal es mandar el maestro completo: el metodo no tiene tope."),
]


def hoja_datos(libro):
    h = libro.create_sheet("Datos")
    for i, (nombre, obligatorio, *_r) in enumerate(CAMPOS, start=1):
        celda = h.cell(row=1, column=i, value=nombre)
        celda.font = cabecera
        celda.fill = PatternFill("solid", fgColor=AZUL if obligatorio else "5B7DB1")
        celda.alignment = centro
    h.cell(row=1, column=len(CAMPOS) + 2, value="← Azul oscuro = obligatorio").font = Font(
        bold=True, size=10, color=AZUL)

    for f, ejemplo in enumerate(EJEMPLOS, start=2):
        for c, valor in enumerate(ejemplo, start=1):
            celda = h.cell(row=f, column=c, value=valor)
            celda.font = Font(italic=True, color="808080", size=10)
    aviso = h.cell(row=2, column=len(CAMPOS) + 2, value="↑ BORRA estas 3 filas de ejemplo y pega tu maestro desde la fila 2")
    aviso.font = Font(bold=True, color=NARANJA, size=10)

    anchos = [14, 40, 20, 15, 14, 15, 16, 16, 14, 13]
    for i, ancho in enumerate(anchos, start=1):
        h.column_dimensions[get_column_letter(i)].width = ancho
    h.freeze_panes = "A2"

    validacion = DataValidation(type="whole", operator="between", formula1=1, formula2=5,
                                allow_blank=True, showErrorMessage=True,
                                error="La criticidad del equipo va de 1 (sin impacto) a 5 (para la planta).",
                                errorTitle="Valor fuera de rango")
    h.add_data_validation(validacion)
    validacion.add(f"G2:G{ULTIMA}")

    no_negativos = DataValidation(type="decimal", operator="greaterThanOrEqual", formula1=0,
                                  allow_blank=True, showErrorMessage=True,
                                  error="Debe ser un numero mayor o igual a cero.",
                                  errorTitle="Valor invalido")
    h.add_data_validation(no_negativos)
    for columna in ("D", "E", "F", "H", "I", "J"):
        no_negativos.add(f"{columna}2:{columna}{ULTIMA}")
    return h


def hoja_diccionario(libro):
    h = libro.create_sheet("Diccionario")
    h["A1"] = "QUE SIGNIFICA CADA COLUMNA"
    h["A1"].font = Font(bold=True, size=16, color=AZUL)
    h["A2"] = ("Los cuatro campos obligatorios son el minimo absoluto. Los opcionales no impiden "
               "el analisis, pero cada uno que agregues lo hace mas defendible frente a gerencia.")
    h["A2"].font = Font(size=10, italic=True, color="808080")

    for i, texto in enumerate(["Columna", "¿Obligatorio?", "Unidad", "De donde sale", "Si falta"], start=1):
        celda = h.cell(row=4, column=i, value=texto)
        celda.font = cabecera
        celda.fill = PatternFill("solid", fgColor=AZUL)
        celda.alignment = centro

    for i, (nombre, obligatorio, unidad, origen, si_falta) in enumerate(CAMPOS, start=5):
        h.cell(row=i, column=1, value=nombre).font = Font(bold=True, size=10)
        celda = h.cell(row=i, column=2, value="OBLIGATORIO" if obligatorio else "opcional")
        celda.font = Font(bold=obligatorio, size=10, color=NARANJA if obligatorio else "808080")
        celda.alignment = centro
        h.cell(row=i, column=3, value=unidad).font = Font(size=10)
        h.cell(row=i, column=4, value=origen).font = Font(size=10)
        h.cell(row=i, column=5, value=si_falta).font = Font(size=10)
        for c in range(1, 6):
            h.cell(row=i, column=c).alignment = arriba
            h.cell(row=i, column=c).border = borde
        h.row_dimensions[i].height = 46

    for columna, ancho in {"A": 24, "B": 14, "C": 16, "D": 62, "E": 58}.items():
        h.column_dimensions[columna].width = ancho
    h.freeze_panes = "A5"
    return h


def hoja_checklist(libro):
    h = libro.create_sheet("Checklist")
    h["A1"] = "ANTES DE ENVIAR: 10 REVISIONES"
    h["A1"].font = Font(bold=True, size=16, color=AZUL)
    h["A2"] = "Cada una de estas es un error que hemos visto arruinar un analisis completo."
    h["A2"].font = Font(size=10, italic=True, color="808080")

    for i, texto in enumerate(["✓", "Revision", "Por que importa"], start=1):
        celda = h.cell(row=4, column=i, value=texto)
        celda.font = cabecera
        celda.fill = PatternFill("solid", fgColor=VERDE)
        celda.alignment = centro

    for i, (regla, motivo) in enumerate(REGLAS, start=5):
        celda = h.cell(row=i, column=1, value="☐")
        celda.alignment = centro
        celda.font = Font(size=13)
        h.cell(row=i, column=2, value=regla).font = Font(bold=True, size=10)
        h.cell(row=i, column=3, value=motivo).font = Font(size=10)
        for c in range(1, 4):
            h.cell(row=i, column=c).alignment = arriba
            h.cell(row=i, column=c).border = borde
        h.row_dimensions[i].height = 42

    for columna, ancho in {"A": 5, "B": 34, "C": 86}.items():
        h.column_dimensions[columna].width = ancho
    return h


def main():
    libro = Workbook()
    libro.remove(libro.active)
    hoja_datos(libro)
    hoja_diccionario(libro)
    hoja_checklist(libro)
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    libro.save(DESTINO)
    obligatorios = sum(1 for c in CAMPOS if c[1])
    print(f"OK  {DESTINO}  ({DESTINO.stat().st_size // 1024} KB, "
          f"{obligatorios} campos obligatorios y {len(CAMPOS) - obligatorios} opcionales)")


if __name__ == "__main__":
    main()
