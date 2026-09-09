#!/usr/bin/env python3
"""
Genera el producto digital vendible: "Kit de Criticidad de Repuestos".

Es una planilla con formulas VIVAS que reproducen el mismo metodo del sitio
(entropia de Shannon -> TOPSIS -> ABC de Pareto -> politica (R,S)). El comprador
pega su maestro en la hoja Datos y todo lo demas se recalcula solo.

  python3 scripts/generar_kit_excel.py [filas_demo]
"""
import json
import sys
import subprocess
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "producto" / "Kit-Criticidad-Repuestos.xlsx"
CAPACIDAD = 300          # filas de formulas disponibles para el comprador
PRIMERA = 2              # primera fila de datos
ULTIMA = PRIMERA + CAPACIDAD - 1

AZUL = "1F3864"
AZUL_CLARO = "D9E2F3"
NARANJA = "C55A11"
GRIS = "F2F2F2"
BLANCO = "FFFFFF"

titulo = Font(bold=True, size=14, color=AZUL)
cabecera = Font(bold=True, color=BLANCO, size=10)
relleno_cab = PatternFill("solid", fgColor=AZUL)
relleno_sec = PatternFill("solid", fgColor=AZUL_CLARO)
relleno_gris = PatternFill("solid", fgColor=GRIS)
centro = Alignment(horizontal="center", vertical="center", wrap_text=True)
borde = Border(*[Side(style="thin", color="BFBFBF")] * 4)

# Criterios: (nombre, columna en Datos, sentido)
CRITERIOS = [
    ("Precio unitario", "D", "beneficio"),
    ("Consumo anual", "E", "beneficio"),
    ("Lead time (dias)", "F", "beneficio"),
    ("Criticidad equipo", "G", "beneficio"),
    ("Horas parada", "H", "beneficio"),
    ("N proveedores", "I", "costo"),
]
# Bloques de columnas en la hoja Criticidad.
COL_CRUDO = "CDEFGH"      # copia de los criterios
COL_MM = "JKLMNO"         # normalizacion min-max (+eps) para la entropia
COL_PLN = "QRSTUV"        # terminos p*ln(p)
COL_V = ["X", "Y", "Z", "AA", "AB", "AC"]   # matriz ponderada de TOPSIS
COL_T = ["BG", "BH", "BI", "BJ", "BK", "BL"]  # criterios en su escala de comparacion
# Precio y consumo se comparan en ordenes de magnitud: en un maestro real abarcan
# varios ceros de diferencia y, sin logaritmo, ese sesgo se cuenta dos veces
# (la entropia premia la dispersion y la normalizacion vectorial la vuelve a premiar).
ESCALA_LOG = {0, 1}
FILA_IDEAL_POS = ULTIMA + 2
FILA_IDEAL_NEG = ULTIMA + 3
EPS = "0.000000001"


def estilar_cabecera(hoja, fila, hasta_col):
    for c in range(1, hasta_col + 1):
        celda = hoja.cell(row=fila, column=c)
        celda.font = cabecera
        celda.fill = relleno_cab
        celda.alignment = centro
    hoja.freeze_panes = hoja.cell(row=fila + 1, column=1)


def hoja_instrucciones(libro):
    h = libro.create_sheet("Instrucciones")
    h.column_dimensions["A"].width = 4
    h.column_dimensions["B"].width = 112
    lineas = [
        ("KIT DE CRITICIDAD DE REPUESTOS", "titulo"),
        ("Clasificacion multicriterio y politica de inventario (R,S) en una sola planilla.", "normal"),
        ("", "normal"),
        ("COMO SE USA", "seccion"),
        ("1. Ve a la hoja «Datos» y reemplaza las filas de ejemplo por tu maestro de repuestos.", "normal"),
        ("2. Completa al menos: SKU, precio unitario, consumo anual y lead time en dias.", "normal"),
        ("3. Listo. Las hojas «Criticidad» y «Resumen» se recalculan solas.", "normal"),
        ("4. En «Parametros» puedes ajustar el nivel de servicio y el periodo de revision de cada clase.", "normal"),
        ("", "normal"),
        ("QUE CALCULA", "seccion"),
        ("Pesos por entropia de Shannon: el peso de cada criterio sale de la informacion que aporta", "normal"),
        ("tu propia data, no de una opinion. Un criterio que no discrimina entre repuestos, no pesa.", "normal"),
        ("", "normal"),
        ("Indice de criticidad TOPSIS: cada repuesto recibe un valor entre 0 y 1 segun su distancia", "normal"),
        ("a la solucion ideal y a la anti-ideal. Es comparable entre plantas y a lo largo del tiempo.", "normal"),
        ("", "normal"),
        ("Clasificacion ABC de Pareto: se ordena por criticidad x valor de consumo anual. La clase A", "normal"),
        ("concentra el 80% del impacto, la B hasta el 95% y la C el resto.", "normal"),
        ("", "normal"),
        ("Politica (R,S): para cada clase se fija un nivel de servicio y un periodo de revision, y de", "normal"),
        ("ahi salen el stock de seguridad, el nivel objetivo S, el exceso de stock y el capital liberable.", "normal"),
        ("", "normal"),
        ("SUPUESTOS QUE DEBES REVISAR", "seccion"),
        ("· La demanda se modela como normal con CV configurable (0,5 por defecto). Para repuestos de", "normal"),
        ("  rotacion muy baja (menos de 3 salidas al año) conviene un modelo de Poisson o Croston.", "normal"),
        ("· El lead time se supone deterministico. Si tu proveedor es erratico, subelo al percentil 90.", "normal"),
        ("· El año se modela con 360 dias operativos (ajustable en «Parametros»).", "normal"),
        ("", "normal"),
        ("LIMITE DE FILAS", "seccion"),
        (f"La planilla trae formulas hasta la fila {ULTIMA}. Para maestros mas grandes, copia la ultima", "normal"),
        ("fila de «Criticidad» hacia abajo y extiende los rangos, o usa la version web sin limite.", "normal"),
    ]
    fila = 2
    for texto, tipo in lineas:
        celda = h.cell(row=fila, column=2, value=texto)
        if tipo == "titulo":
            celda.font = Font(bold=True, size=18, color=AZUL)
        elif tipo == "seccion":
            celda.font = Font(bold=True, size=11, color=NARANJA)
        else:
            celda.font = Font(size=10)
        fila += 1
    return h


def hoja_datos(libro, demo):
    h = libro.create_sheet("Datos")
    encabezados = ["SKU", "Descripcion", "Categoria", "Precio unitario", "Consumo anual",
                   "Lead time (dias)", "Criticidad equipo (1-5)", "Horas parada si falla",
                   "N proveedores", "Stock actual"]
    for i, texto in enumerate(encabezados, start=1):
        h.cell(row=1, column=i, value=texto)
    estilar_cabecera(h, 1, len(encabezados))

    claves = ["sku", "descripcion", "categoria", "precio", "consumoAnual", "leadTime",
              "criticidadEquipo", "horasParada", "proveedores", "stockActual"]
    for f, fila in enumerate(demo, start=PRIMERA):
        for c, clave in enumerate(claves, start=1):
            h.cell(row=f, column=c, value=fila.get(clave))

    anchos = [12, 38, 15, 15, 14, 15, 16, 16, 14, 13]
    for i, ancho in enumerate(anchos, start=1):
        h.column_dimensions[get_column_letter(i)].width = ancho
    for f in range(PRIMERA, ULTIMA + 1):
        for c in (4, 5, 6, 7, 8, 9, 10):
            h.cell(row=f, column=c).number_format = "#,##0.00" if c == 4 else "#,##0"

    validacion = DataValidation(type="whole", operator="between", formula1=1, formula2=5,
                                allow_blank=True, showErrorMessage=True,
                                error="La criticidad del equipo va de 1 a 5.")
    h.add_data_validation(validacion)
    validacion.add(f"G{PRIMERA}:G{ULTIMA}")
    return h


def hoja_parametros(libro):
    h = libro.create_sheet("Parametros")
    h["A1"] = "PARAMETROS DEL MODELO"
    h["A1"].font = titulo
    filas = [("CV de la demanda", 0.5, "Variabilidad del consumo. 0,3 pareja · 0,5 tipico · 1,0+ erratica"),
             ("Dias operativos al año", 360, "Base para convertir el consumo anual en demanda diaria")]
    for i, (nombre, valor, nota) in enumerate(filas, start=3):
        h.cell(row=i, column=1, value=nombre).font = Font(bold=True, size=10)
        celda = h.cell(row=i, column=2, value=valor)
        celda.fill = PatternFill("solid", fgColor="FFF2CC")
        celda.border = borde
        h.cell(row=i, column=3, value=nota).font = Font(size=9, italic=True, color="808080")

    h["A6"] = "POLITICA POR CLASE"
    h["A6"].font = Font(bold=True, size=11, color=NARANJA)
    for i, texto in enumerate(["Clase", "Nivel de servicio", "Revision (dias)"], start=1):
        celda = h.cell(row=7, column=i, value=texto)
        celda.font = cabecera
        celda.fill = relleno_cab
        celda.alignment = centro
    for i, (clase, servicio, revision) in enumerate([("A", 0.99, 7), ("B", 0.95, 15), ("C", 0.90, 30)], start=8):
        h.cell(row=i, column=1, value=clase).alignment = centro
        h.cell(row=i, column=2, value=servicio).number_format = "0%"
        h.cell(row=i, column=3, value=revision)
        for c in range(1, 4):
            h.cell(row=i, column=c).border = borde

    h["A12"] = "CORTES DE PARETO"
    h["A12"].font = Font(bold=True, size=11, color=NARANJA)
    h["A13"] = "Hasta % acumulado -> clase A"
    h["B13"] = 0.80
    h["A14"] = "Hasta % acumulado -> clase B"
    h["B14"] = 0.95
    h["A15"] = "Tope de SKU en clase A"
    h["B15"] = 0.20
    h["A16"] = "Tope de SKU en clase A+B"
    h["B16"] = 0.50
    h["C15"] = "El ABC por valor se acota con estas proporciones: sin tope, un portafolio poco"
    h["C15"].font = Font(size=9, italic=True, color="808080")
    h["C16"] = "concentrado manda media bodega a clase A y la politica deja de ser accionable."
    h["C16"].font = Font(size=9, italic=True, color="808080")
    for fila in (13, 14, 15, 16):
        h.cell(row=fila, column=2).number_format = "0%"
        h.cell(row=fila, column=2).fill = PatternFill("solid", fgColor="FFF2CC")

    h.column_dimensions["A"].width = 30
    h.column_dimensions["B"].width = 18
    h.column_dimensions["C"].width = 66
    return h


def hoja_criticidad(libro):
    h = libro.create_sheet("Criticidad")
    n = "$BE$10"  # cantidad de repuestos con datos

    encabezados = {
        "A": "SKU", "B": "Descripcion",
        "C": "Precio", "D": "Consumo", "E": "Lead time", "F": "Crit. equipo",
        "G": "Horas parada", "H": "N prov.",
        "J": "mm Precio", "K": "mm Consumo", "L": "mm Lead", "M": "mm Crit",
        "N": "mm Horas", "O": "mm Prov",
        "Q": "pln Precio", "R": "pln Consumo", "S": "pln Lead", "T": "pln Crit",
        "U": "pln Horas", "V": "pln Prov",
        "X": "v Precio", "Y": "v Consumo", "Z": "v Lead", "AA": "v Crit",
        "AB": "v Horas", "AC": "v Prov",
        "AE": "D+", "AF": "D-", "AG": "Indice criticidad", "AH": "Impacto",
        "AI": "% acumulado", "AJ": "Clase",
        "AK": "Servicio", "AL": "Revision (d)", "AM": "z", "AN": "Demanda diaria",
        "AO": "Stock seguridad", "AP": "Nivel objetivo S", "AQ": "Stock actual",
        "AR": "Exceso (un)", "AS": "Capital liberable", "AT": "Riesgo", "AU": "Accion",
    }
    for columna, texto in encabezados.items():
        celda = h[f"{columna}1"]
        celda.value = texto
        celda.font = cabecera
        celda.fill = relleno_cab
        celda.alignment = centro
    h.freeze_panes = "C2"

    for f in range(PRIMERA, ULTIMA + 1):
        vacio = f'Datos!A{f}=""'
        h[f"A{f}"] = f'=IF({vacio},"",Datos!A{f})'
        h[f"B{f}"] = f'=IF({vacio},"",Datos!B{f})'

        # Copia de criterios, con 0 para las celdas que el usuario dejo en blanco.
        for destino, (_, origen, _s) in zip(COL_CRUDO, CRITERIOS):
            h[f"{destino}{f}"] = f'=IF({vacio},"",IFERROR(MAX(0,N(Datos!{origen}{f})),0))'

        # Escala de comparacion de cada criterio (logaritmica donde corresponde).
        for i, destino in enumerate(COL_T):
            origen = COL_CRUDO[i]
            expresion = f"LN(1+{origen}{f})" if i in ESCALA_LOG else f"{origen}{f}"
            h[f"{destino}{f}"] = f'=IF({vacio},"",{expresion})'

        # Normalizacion min-max (+eps) para poder tomar logaritmo.
        for destino, origen in zip(COL_MM, COL_T):
            rango = f"{origen}${PRIMERA}:{origen}${ULTIMA}"
            h[f"{destino}{f}"] = (
                f'=IF({vacio},"",IF(MAX({rango})-MIN({rango})<0.000000001,0.5,'
                f'({origen}{f}-MIN({rango}))/(MAX({rango})-MIN({rango})))+{EPS})'
            )

        # Terminos p*ln(p) de la entropia de Shannon.
        for destino, origen in zip(COL_PLN, COL_MM):
            rango = f"{origen}${PRIMERA}:{origen}${ULTIMA}"
            h[f"{destino}{f}"] = (
                f'=IF({vacio},"",({origen}{f}/SUM({rango}))*LN({origen}{f}/SUM({rango})))'
            )

        # Matriz ponderada: normalizacion vectorial x peso por entropia.
        for i, destino in enumerate(COL_V):
            origen = COL_T[i]
            rango = f"{origen}${PRIMERA}:{origen}${ULTIMA}"
            peso = f"$BE${2 + i}"
            h[f"{destino}{f}"] = (
                f'=IF({vacio},"",IF(SUMSQ({rango})=0,0,{origen}{f}/SQRT(SUMSQ({rango})))*{peso})'
            )

        h[f"AE{f}"] = f'=IF({vacio},"",SQRT(SUMXMY2(X{f}:AC{f},$X${FILA_IDEAL_POS}:$AC${FILA_IDEAL_POS})))'
        h[f"AF{f}"] = f'=IF({vacio},"",SQRT(SUMXMY2(X{f}:AC{f},$X${FILA_IDEAL_NEG}:$AC${FILA_IDEAL_NEG})))'
        h[f"AG{f}"] = f'=IF({vacio},"",IF(AE{f}+AF{f}<0.000000001,0.5,AF{f}/(AE{f}+AF{f})))'
        # Exposicion economica = valor de consumo anual + valor de una unidad. El
        # segundo termino rescata al repuesto de capital que no rota en años: su
        # valor de consumo es cero y con el criterio de solo-consumo caia a clase C.
        h[f"AH{f}"] = f'=IF({vacio},"",AG{f}*MAX(C{f}*(D{f}+1),1))'
        rango_impacto = f"$AH${PRIMERA}:$AH${ULTIMA}"
        # Acumulado EXCLUSIVO: cuanto reunen los repuestos que superan a este.
        h[f"AI{f}"] = (
            f'=IF({vacio},"",SUMIF({rango_impacto},">"&AH{f},{rango_impacto})/SUM({rango_impacto}))'
        )
        # Posicion en el ranking de impacto (0 = el mas importante).
        h[f"AV{f}"] = f'=IF({vacio},"",COUNTIF({rango_impacto},">"&AH{f}))'
        # ABC hibrido: regla de Pareto por valor, acotada por proporcion de clase.
        # Se toma la clase mas restrictiva de las dos.
        h[f"AJ{f}"] = (
            f'=IF({vacio},"",'
            f'IF(OR(AI{f}>=Parametros!$B$14,AV{f}>=$BE$12),"C",'
            f'IF(OR(AI{f}>=Parametros!$B$13,AV{f}>=$BE$11),"B","A")))'
        )

        h[f"AK{f}"] = f'=IF({vacio},"",VLOOKUP(AJ{f},Parametros!$A$8:$C$10,2,FALSE))'
        h[f"AL{f}"] = f'=IF({vacio},"",VLOOKUP(AJ{f},Parametros!$A$8:$C$10,3,FALSE))'
        h[f"AM{f}"] = f'=IF({vacio},"",NORMSINV(AK{f}))'
        h[f"AN{f}"] = f'=IF({vacio},"",D{f}/Parametros!$B$4)'
        proteccion = f"(AL{f}+E{f})"
        sigma = f"(AN{f}*Parametros!$B$3)"
        h[f"AO{f}"] = f'=IF({vacio},"",MAX(0,ROUNDUP(AM{f}*{sigma}*SQRT({proteccion}),0)))'
        h[f"AP{f}"] = f'=IF({vacio},"",MAX(1,ROUNDUP(AN{f}*{proteccion}+AM{f}*{sigma}*SQRT({proteccion}),0)))'
        h[f"AQ{f}"] = f'=IF({vacio},"",IF(Datos!J{f}="","",Datos!J{f}))'
        h[f"AR{f}"] = f'=IF(OR({vacio},AQ{f}=""),"",MAX(0,AQ{f}-AP{f}))'
        h[f"AS{f}"] = f'=IF(OR({vacio},AQ{f}=""),"",AR{f}*C{f})'
        h[f"AT{f}"] = f'=IF(OR({vacio},AQ{f}=""),"",IF(AQ{f}<AO{f},"SI",""))'
        h[f"AU{f}"] = (
            f'=IF({vacio},"",IF(AT{f}="SI","Reponer ahora",'
            f'IF(AND(AQ{f}<>"",AR{f}>0),"Bajar "&TEXT(AR{f},"#,##0")&" un.","En rango")))'
        )

    # --- Bloque de entropia y pesos -----------------------------------------
    h["BA1"] = "Criterio"
    h["BB1"] = "Sentido"
    h["BC1"] = "Entropia e"
    h["BD1"] = "Divergencia"
    h["BE1"] = "Peso"
    for c in ("BA", "BB", "BC", "BD", "BE"):
        h[f"{c}1"].font = cabecera
        h[f"{c}1"].fill = relleno_cab
        h[f"{c}1"].alignment = centro

    for i, (nombre, _origen, sentido) in enumerate(CRITERIOS):
        fila = 2 + i
        pln = COL_PLN[i]
        h[f"BA{fila}"] = nombre
        h[f"BB{fila}"] = sentido
        h[f"BC{fila}"] = f'=IF({n}<2,1,-1/LN({n})*SUM({pln}${PRIMERA}:{pln}${ULTIMA}))'
        h[f"BD{fila}"] = f"=MAX(0,1-BC{fila})"
        h[f"BE{fila}"] = f'=IF(SUM($BD$2:$BD$7)<0.000000001,1/6,BD{fila}/SUM($BD$2:$BD$7))'
        h[f"BE{fila}"].number_format = "0.0%"

    h["BD10"] = "Repuestos con datos"
    h["BD10"].font = Font(bold=True, size=10)
    h["BE10"] = f"=COUNT(Datos!D{PRIMERA}:D{ULTIMA})"
    h["BD11"] = "Tope de clase A (SKU)"
    h["BD11"].font = Font(bold=True, size=10)
    h["BE11"] = "=MAX(1,ROUND($BE$10*Parametros!$B$15,0))"
    h["BD12"] = "Tope de clase A+B (SKU)"
    h["BD12"].font = Font(bold=True, size=10)
    h["BE12"] = "=MAX($BE$11,ROUND($BE$10*Parametros!$B$16,0))"

    # --- Soluciones ideal y anti-ideal --------------------------------------
    h[f"W{FILA_IDEAL_POS}"] = "Ideal +"
    h[f"W{FILA_IDEAL_NEG}"] = "Ideal -"
    for i, columna in enumerate(COL_V):
        rango = f"{columna}${PRIMERA}:{columna}${ULTIMA}"
        beneficio = CRITERIOS[i][2] == "beneficio"
        h[f"{columna}{FILA_IDEAL_POS}"] = f"={'MAX' if beneficio else 'MIN'}({rango})"
        h[f"{columna}{FILA_IDEAL_NEG}"] = f"={'MIN' if beneficio else 'MAX'}({rango})"

    # --- Formato -------------------------------------------------------------
    for columna, ancho in {"A": 12, "B": 34, "AG": 15, "AJ": 8, "AK": 10, "AL": 12,
                           "AO": 15, "AP": 15, "AQ": 12, "AR": 12, "AS": 16, "AT": 8,
                           "AU": 20, "BA": 20, "BB": 12, "BC": 12, "BD": 18, "BE": 10}.items():
        h.column_dimensions[columna].width = ancho
    # Las columnas intermedias son de calculo: se agrupan y ocultan.
    for columna in list(COL_MM) + list(COL_PLN) + COL_V + COL_T + ["AE", "AF", "AH", "AI", "AM", "AN", "AV"]:
        h.column_dimensions[columna].outlineLevel = 1
        h.column_dimensions[columna].hidden = True

    for f in range(PRIMERA, ULTIMA + 1):
        h[f"AG{f}"].number_format = "0.000"
        h[f"AK{f}"].number_format = "0%"
        h[f"AS{f}"].number_format = "#,##0"
        h[f"AJ{f}"].alignment = centro
        h[f"AT{f}"].alignment = centro

    rango_clase = f"AJ{PRIMERA}:AJ{ULTIMA}"
    h.conditional_formatting.add(rango_clase, CellIsRule(
        operator="equal", formula=['"A"'], fill=PatternFill("solid", fgColor="FFC7CE"), font=Font(bold=True)))
    h.conditional_formatting.add(rango_clase, CellIsRule(
        operator="equal", formula=['"B"'], fill=PatternFill("solid", fgColor="FFEB9C")))
    h.conditional_formatting.add(rango_clase, CellIsRule(
        operator="equal", formula=['"C"'], fill=PatternFill("solid", fgColor="DDEBF7")))
    h.conditional_formatting.add(f"AT{PRIMERA}:AT{ULTIMA}", CellIsRule(
        operator="equal", formula=['"SI"'], fill=PatternFill("solid", fgColor="FF6B6B"),
        font=Font(bold=True, color=BLANCO)))
    return h


def hoja_resumen(libro):
    h = libro.create_sheet("Resumen", 0)
    h["B2"] = "RESUMEN EJECUTIVO"
    h["B2"].font = Font(bold=True, size=18, color=AZUL)
    h["B3"] = "Se recalcula solo al cambiar la hoja Datos."
    h["B3"].font = Font(size=10, italic=True, color="808080")

    rango_clase = f"Criticidad!$AJ${PRIMERA}:$AJ${ULTIMA}"
    filas = [
        ("PORTAFOLIO", None, None),
        ("Repuestos con datos", f"=COUNT(Datos!D{PRIMERA}:D{ULTIMA})", "#,##0"),
        ("Clase A (paran la planta)", f'=COUNTIF({rango_clase},"A")', "#,##0"),
        ("Clase B", f'=COUNTIF({rango_clase},"B")', "#,##0"),
        ("Clase C", f'=COUNTIF({rango_clase},"C")', "#,##0"),
        ("", None, None),
        ("CAPITAL", None, None),
        ("Capital inmovilizado hoy",
         f"=SUMPRODUCT(Criticidad!$C${PRIMERA}:$C${ULTIMA},N(Criticidad!$AQ${PRIMERA}:$AQ${ULTIMA}))", "#,##0"),
        ("Capital liberable (sobrestock)",
         f"=SUM(Criticidad!$AS${PRIMERA}:$AS${ULTIMA})", "#,##0"),
        ("% del capital que sobra", "@PORCENTAJE", "0.0%"),
        ("", None, None),
        ("RIESGO", None, None),
        ("Repuestos bajo cobertura", f'=COUNTIF(Criticidad!$AT${PRIMERA}:$AT${ULTIMA},"SI")', "#,##0"),
        ("  de ellos clase A",
         f'=COUNTIFS(Criticidad!$AT${PRIMERA}:$AT${ULTIMA},"SI",{rango_clase},"A")', "#,##0"),
        ("Repuestos a reponer ahora", f'=COUNTIF(Criticidad!$AU${PRIMERA}:$AU${ULTIMA},"Reponer ahora")', "#,##0"),
    ]
    fila = 5
    fila_capital = fila_liberable = None
    for etiqueta, formula, formato in filas:
        # Las referencias se resuelven al vuelo para que no se desalineen si se
        # agregan o quitan lineas del resumen.
        if formula == "@PORCENTAJE":
            formula = f"=IF(C{fila_capital}=0,0,C{fila_liberable}/C{fila_capital})"
        if formula is None:
            if etiqueta:
                celda = h.cell(row=fila, column=2, value=etiqueta)
                celda.font = Font(bold=True, size=11, color=NARANJA)
        else:
            h.cell(row=fila, column=2, value=etiqueta).font = Font(size=10)
            celda = h.cell(row=fila, column=3, value=formula)
            celda.number_format = formato
            celda.font = Font(bold=True, size=11)
            celda.fill = relleno_gris
            celda.border = borde
            if etiqueta.startswith("Capital inmovilizado"):
                fila_capital = fila
            elif etiqueta.startswith("Capital liberable"):
                fila_liberable = fila
        fila += 1

    h["B21"] = "PESO OBJETIVO DE CADA CRITERIO (entropia de Shannon)"
    h["B21"].font = Font(bold=True, size=11, color=NARANJA)
    for i in range(6):
        h.cell(row=22 + i, column=2, value=f"=Criticidad!BA{2 + i}").font = Font(size=10)
        celda = h.cell(row=22 + i, column=3, value=f"=Criticidad!BE{2 + i}")
        celda.number_format = "0.0%"
        celda.border = borde

    h.column_dimensions["A"].width = 3
    h.column_dimensions["B"].width = 40
    h.column_dimensions["C"].width = 20
    return h


def main():
    filas_demo = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    demo = json.loads(subprocess.run(
        ["node", "-e",
         f"import('./scripts/generar-demo.mjs').then(m=>console.log(JSON.stringify(m.generarRepuestos({filas_demo},7))))"],
        cwd=RAIZ, capture_output=True, text=True, check=True).stdout)

    libro = Workbook()
    libro.remove(libro.active)
    hoja_instrucciones(libro)
    hoja_datos(libro, demo)
    hoja_criticidad(libro)
    hoja_parametros(libro)
    hoja_resumen(libro)
    libro.move_sheet("Resumen", offset=-4)

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    libro.save(DESTINO)
    print(f"OK  {DESTINO}  ({DESTINO.stat().st_size // 1024} KB, {filas_demo} filas de ejemplo, "
          f"formulas hasta la fila {ULTIMA})")


if __name__ == "__main__":
    main()
