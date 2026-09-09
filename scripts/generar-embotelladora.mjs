/**
 * Maestro de repuestos sintetico de una planta embotelladora de bebidas.
 *
 * Cubre la linea completa (tratamiento de agua, jaraberia, sopladora PET,
 * llenadora, capsuladora, etiquetadora, empaque, paletizado, lavadora de
 * retornables, pasteurizador) mas servicios industriales (vapor, frio, aire,
 * CIP, RILES) y automatizacion.
 *
 * Es un caso generico de la industria, no el maestro de ninguna planta real.
 * Determinista: misma semilla, mismos datos.
 *
 *   node scripts/generar-embotelladora.mjs [n] [salida.csv]
 */
import { prng } from "../docs/core/criticidad.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * Catalogo base. Campos:
 *   d  descripcion       a  area / linea        e  equipo
 *   m  marca u origen    p  precio unitario USD  l  lead time en dias
 *   c  criticidad del equipo (1-5)               v  proveedores homologados
 *   r  consumo anual tipico                      u  unidad de medida
 *
 * Criterio de criticidad: 5 = su falla detiene la linea de envasado;
 * 4 = detiene un area o deja la linea sin insumo; 3 = degrada pero hay
 * respaldo o by-pass; 2 = afecta calidad o eficiencia; 1 = sin impacto operacional.
 */
const CATALOGO = [
  // ---------------------------------------------------------------- Agua
  ["Membrana de osmosis inversa 8040 baja presion", "Tratamiento de agua", "Planta RO", "Importado", 690, 75, 4, 2, 6, "un"],
  ["Portamembrana FRP 8040 300 psi", "Tratamiento de agua", "Planta RO", "Importado", 1180, 90, 4, 2, 0.5, "un"],
  ["Cartucho filtrante bobinado 5 um 40\"", "Tratamiento de agua", "Prefiltracion RO", "Nacional", 9.5, 12, 3, 5, 320, "un"],
  ["Cartucho filtrante plisado 1 um 30\"", "Tratamiento de agua", "Pulido final", "Nacional", 26, 15, 3, 4, 140, "un"],
  ["Resina cationica fuerte para ablandador", "Tratamiento de agua", "Ablandador", "Importado", 330, 55, 3, 3, 4, "saco 25 L"],
  ["Resina anionica base fuerte", "Tratamiento de agua", "Desmineralizador", "Importado", 480, 60, 3, 2, 2, "saco 25 L"],
  ["Valvula multipuerto automatica ablandador", "Tratamiento de agua", "Ablandador", "Importado", 1650, 70, 3, 2, 0.4, "un"],
  ["Lampara germicida UV 320 W", "Tratamiento de agua", "Esterilizador UV", "Importado", 420, 45, 4, 2, 6, "un"],
  ["Funda de cuarzo para lampara UV", "Tratamiento de agua", "Esterilizador UV", "Importado", 195, 45, 4, 2, 3, "un"],
  ["Balastro electronico UV", "Tratamiento de agua", "Esterilizador UV", "Importado", 780, 60, 4, 1, 1, "un"],
  ["Bomba centrifuga multietapa 15 kW alta presion", "Tratamiento de agua", "Bombeo RO", "Importado", 6400, 105, 4, 2, 0.3, "un"],
  ["Sensor de conductividad inductivo", "Tratamiento de agua", "Control RO", "Importado", 640, 50, 3, 3, 2, "un"],
  ["Electrodo de pH con cable integrado", "Tratamiento de agua", "Control de proceso", "Importado", 285, 35, 3, 4, 12, "un"],
  ["Bomba dosificadora de diafragma 10 L/h", "Tratamiento de agua", "Dosificacion", "Importado", 1180, 55, 3, 3, 1, "un"],
  ["Diafragma PTFE para bomba dosificadora", "Tratamiento de agua", "Dosificacion", "Importado", 165, 40, 3, 3, 14, "un"],
  ["Manguera de succion PVC reforzada dosificacion", "Tratamiento de agua", "Dosificacion", "Nacional", 6.5, 8, 2, 5, 90, "m"],
  ["Medio filtrante antracita", "Tratamiento de agua", "Filtro multimedia", "Nacional", 145, 25, 3, 3, 3, "saco 25 kg"],
  ["Arena silicea filtrante 0,6 mm", "Tratamiento de agua", "Filtro multimedia", "Nacional", 38, 18, 3, 4, 6, "saco 25 kg"],
  ["Carbon activado granular vegetal", "Tratamiento de agua", "Filtro de carbon", "Importado", 210, 50, 3, 3, 5, "saco 25 kg"],

  // ------------------------------------------------------------ Jaraberia
  ["Sello mecanico sanitario simple 35 mm", "Jaraberia", "Bomba de jarabe", "Importado", 545, 60, 4, 2, 8, "un"],
  ["Bomba centrifuga sanitaria 5,5 kW inox 316", "Jaraberia", "Trasiego de jarabe", "Importado", 4900, 95, 4, 2, 0.3, "un"],
  ["Rodete inox para bomba sanitaria", "Jaraberia", "Trasiego de jarabe", "Importado", 1080, 85, 4, 2, 1, "un"],
  ["Placa de intercambiador de calor AISI 316", "Jaraberia", "Intercambiador de placas", "Importado", 178, 65, 4, 2, 24, "un"],
  ["Junta NBR para placa de intercambiador", "Jaraberia", "Intercambiador de placas", "Importado", 22, 55, 4, 3, 130, "un"],
  ["Valvula mariposa sanitaria DN65 clamp", "Jaraberia", "Distribucion de jarabe", "Importado", 245, 45, 3, 3, 16, "un"],
  ["Kit de sellos EPDM para valvula sanitaria DN65", "Jaraberia", "Distribucion de jarabe", "Importado", 34, 40, 3, 3, 95, "un"],
  ["Agitador de paletas 3 kW con reductor", "Jaraberia", "Tanque de jarabe simple", "Importado", 3800, 100, 3, 2, 0.2, "un"],
  ["Reten de eje para agitador sanitario", "Jaraberia", "Tanque de jarabe simple", "Importado", 210, 60, 3, 2, 5, "un"],
  ["Filtro de bolsa 100 um sanitario", "Jaraberia", "Filtracion de jarabe", "Nacional", 18, 14, 3, 4, 180, "un"],
  ["Caudalimetro masico Coriolis DN50", "Jaraberia", "Dosificacion de jarabe", "Importado", 14500, 130, 5, 1, 0.1, "un"],
  ["Refractometro en linea Brix", "Jaraberia", "Control de Brix", "Importado", 9800, 120, 4, 1, 0.1, "un"],
  ["Manguera sanitaria silicona 2\" con clamp", "Jaraberia", "Trasiego", "Importado", 88, 45, 3, 3, 32, "m"],
  ["Empaquetadura clamp EPDM 2\"", "Jaraberia", "Uniones sanitarias", "Nacional", 3.2, 10, 3, 5, 640, "un"],

  // -------------------------------------------------------- Carbonatacion
  ["Valvula moduladora de CO2 con posicionador", "Carbonatacion", "Carbo-cooler", "Importado", 3250, 110, 5, 1, 0.3, "un"],
  ["Sensor de CO2 disuelto en linea", "Carbonatacion", "Control de carbonatacion", "Importado", 7200, 120, 4, 1, 0.1, "un"],
  ["Bomba de vacio de anillo liquido 4 kW", "Carbonatacion", "Desaireador", "Importado", 5600, 105, 4, 2, 0.2, "un"],
  ["Boquilla de aspersion desaireador inox", "Carbonatacion", "Desaireador", "Importado", 145, 70, 4, 2, 8, "un"],
  ["Transmisor de presion sanitario 0-10 bar", "Carbonatacion", "Mezclador", "Importado", 890, 65, 4, 2, 3, "un"],

  // --------------------------------------------------------- Sopladora PET
  ["Lampara infrarroja de horno 2500 W", "Sopladora PET", "Horno de precalentamiento", "OEM", 168, 120, 5, 1, 85, "un"],
  ["Reflector ceramico de horno", "Sopladora PET", "Horno de precalentamiento", "OEM", 240, 130, 5, 1, 14, "un"],
  ["Molde de cavidad PET 500 ml", "Sopladora PET", "Estacion de soplado", "OEM", 11800, 165, 5, 1, 0.6, "un"],
  ["Fondo de molde intercambiable PET", "Sopladora PET", "Estacion de soplado", "OEM", 3400, 150, 5, 1, 1, "un"],
  ["Valvula de soplado de alta presion 40 bar", "Sopladora PET", "Estacion de soplado", "OEM", 2750, 140, 5, 1, 2, "un"],
  ["Kit de sellos para valvula de soplado", "Sopladora PET", "Estacion de soplado", "OEM", 320, 125, 5, 1, 9, "un"],
  ["Varilla de estiraje con guia", "Sopladora PET", "Estacion de soplado", "OEM", 780, 135, 5, 1, 3, "un"],
  ["Pinza de transferencia de preformas", "Sopladora PET", "Rueda de transferencia", "OEM", 395, 120, 5, 1, 18, "un"],
  ["Estrella de transferencia de botellas", "Sopladora PET", "Salida de sopladora", "OEM", 1450, 140, 5, 1, 2, "un"],
  ["Mandril de sujecion de preforma", "Sopladora PET", "Horno de precalentamiento", "OEM", 175, 120, 5, 1, 40, "un"],
  ["Filtro coalescente aire alta presion 40 bar", "Sopladora PET", "Aire de soplado", "Importado", 640, 85, 5, 2, 6, "un"],
  ["Elemento separador aceite compresor alta", "Sopladora PET", "Compresor de alta presion", "Importado", 1250, 95, 5, 2, 2, "un"],
  ["Kit mayor de reparacion compresor 40 bar", "Sopladora PET", "Compresor de alta presion", "Importado", 22500, 150, 5, 1, 0.3, "un"],
  ["Sensor de temperatura pirometro infrarrojo", "Sopladora PET", "Horno de precalentamiento", "OEM", 2100, 130, 5, 1, 0.5, "un"],

  // ------------------------------------------------------------- Llenadora
  ["Valvula de llenado electroneumatica completa", "Llenadora", "Llenadora rotativa", "OEM", 4350, 150, 5, 1, 3, "un"],
  ["Kit de juntas para valvula de llenado", "Llenadora", "Llenadora rotativa", "OEM", 78, 120, 5, 1, 160, "un"],
  ["Sonda de nivel de llenado inox", "Llenadora", "Llenadora rotativa", "OEM", 420, 130, 5, 1, 24, "un"],
  ["Centrador de botella con resorte", "Llenadora", "Llenadora rotativa", "OEM", 265, 125, 5, 1, 30, "un"],
  ["Estrella de entrada a llenadora", "Llenadora", "Transferencia de entrada", "OEM", 1680, 140, 5, 1, 1, "un"],
  ["Tornillo sinfin de temporizacion", "Llenadora", "Transferencia de entrada", "OEM", 2450, 145, 5, 1, 0.8, "un"],
  ["Guia lateral de botella UHMW", "Llenadora", "Transferencia de entrada", "Nacional", 62, 20, 4, 3, 45, "m"],
  ["Rodamiento de rodillos de mesa rotativa", "Llenadora", "Llenadora rotativa", "Importado", 1890, 110, 5, 2, 0.5, "un"],
  ["Junta rotativa de distribucion de producto", "Llenadora", "Llenadora rotativa", "OEM", 5600, 160, 5, 1, 0.3, "un"],
  ["Servomotor de accionamiento de llenadora", "Llenadora", "Accionamiento principal", "OEM", 8900, 155, 5, 1, 0.2, "un"],
  ["Anillo de desgaste de campana de llenado", "Llenadora", "Llenadora rotativa", "OEM", 46, 120, 5, 1, 190, "un"],

  // ---------------------------------------------------------- Capsuladora
  ["Cabezal de torque magnetico regulable", "Capsuladora", "Capsuladora rotativa", "OEM", 1950, 140, 5, 1, 4, "un"],
  ["Embrague magnetico de cabezal", "Capsuladora", "Capsuladora rotativa", "OEM", 880, 135, 5, 1, 6, "un"],
  ["Mordaza de sujecion de tapa", "Capsuladora", "Capsuladora rotativa", "OEM", 145, 120, 5, 1, 44, "un"],
  ["Resorte de compresion de cabezal", "Capsuladora", "Capsuladora rotativa", "OEM", 28, 115, 5, 2, 90, "un"],
  ["Orientador de tapas con soplador", "Capsuladora", "Alimentacion de tapas", "OEM", 3400, 145, 4, 1, 0.3, "un"],
  ["Riel de bajada de tapas inox", "Capsuladora", "Alimentacion de tapas", "Nacional", 320, 30, 4, 3, 4, "un"],
  ["Sensor inductivo de presencia de tapa", "Capsuladora", "Alimentacion de tapas", "Importado", 88, 35, 4, 4, 22, "un"],

  // ---------------------------------------------------------- Etiquetadora
  ["Rodillo de cola cromado", "Etiquetadora", "Etiquetadora de cola fria", "OEM", 1450, 130, 4, 1, 1, "un"],
  ["Paleta de cola de goma", "Etiquetadora", "Etiquetadora de cola fria", "OEM", 285, 120, 4, 1, 16, "un"],
  ["Cepillo de presion de etiqueta", "Etiquetadora", "Estacion de aplicacion", "OEM", 96, 110, 4, 2, 28, "un"],
  ["Esponja de aplicacion de etiqueta", "Etiquetadora", "Estacion de aplicacion", "Nacional", 24, 25, 4, 3, 120, "un"],
  ["Bomba de hotmelt con manguera calefaccionada", "Etiquetadora", "Sistema hotmelt", "Importado", 6200, 110, 4, 2, 0.2, "un"],
  ["Boquilla aplicadora de hotmelt", "Etiquetadora", "Sistema hotmelt", "Importado", 380, 75, 4, 2, 12, "un"],
  ["Resistencia calefactora de tanque hotmelt", "Etiquetadora", "Sistema hotmelt", "Importado", 245, 70, 4, 2, 8, "un"],
  ["Filtro de hotmelt 100 mesh", "Etiquetadora", "Sistema hotmelt", "Importado", 42, 60, 4, 3, 60, "un"],
  ["Cuchilla de corte de etiqueta rotativa", "Etiquetadora", "Modulo de corte", "OEM", 940, 125, 4, 1, 5, "un"],
  ["Correa dentada de transmision etiquetadora", "Etiquetadora", "Transmision", "Importado", 175, 50, 4, 3, 10, "un"],
  ["Plato giratorio de botella", "Etiquetadora", "Carrusel", "OEM", 520, 130, 4, 1, 12, "un"],

  // ------------------------------------------------------------ Transporte
  ["Cadena de charnela acetal 3\" 1 m", "Transporte", "Transportador de botellas", "Nacional", 78, 20, 4, 4, 220, "m"],
  ["Cadena de charnela inox 3,25\"", "Transporte", "Transportador de cajas", "Importado", 165, 45, 4, 3, 60, "m"],
  ["Guia de deslizamiento UHMW 40x10", "Transporte", "Transportador de botellas", "Nacional", 14, 15, 3, 5, 480, "m"],
  ["Motorreductor 0,55 kW con brida", "Transporte", "Accionamiento de transportador", "Importado", 690, 55, 3, 3, 8, "un"],
  ["Pinon de accionamiento acetal Z=21", "Transporte", "Accionamiento de transportador", "Nacional", 58, 25, 3, 4, 42, "un"],
  ["Rodamiento rigido de bolas 6205 2RS", "Transporte", "Rodillos de transporte", "Importado", 12, 18, 3, 5, 380, "un"],
  ["Fotocelda reflex M18 con reflector", "Transporte", "Control de acumulacion", "Importado", 95, 30, 3, 4, 65, "un"],
  ["Boquilla de lubricacion de cadena", "Transporte", "Lubricacion de cadenas", "Nacional", 16, 15, 2, 4, 110, "un"],
  ["Bomba dosificadora de lubricante de cadena", "Transporte", "Lubricacion de cadenas", "Importado", 1350, 60, 3, 2, 0.5, "un"],
  ["Curva de transporte con guia lateral", "Transporte", "Transportador de botellas", "Nacional", 480, 35, 3, 3, 6, "un"],

  // ------------------------------------------------------------ Empacadora
  ["Resistencia de tunel de termocontraccion", "Empacadora", "Tunel de retractil", "Importado", 185, 60, 4, 3, 18, "un"],
  ["Ventilador de recirculacion de tunel", "Empacadora", "Tunel de retractil", "Importado", 1250, 80, 4, 2, 1, "un"],
  ["Correa de malla inox de tunel", "Empacadora", "Tunel de retractil", "Importado", 2400, 95, 4, 2, 0.4, "un"],
  ["Cuchilla de sellado transversal", "Empacadora", "Envolvedora de film", "OEM", 620, 100, 4, 1, 6, "un"],
  ["Teflon adhesivo para barra de sellado", "Empacadora", "Envolvedora de film", "Nacional", 34, 20, 4, 4, 75, "m"],
  ["Rodillo desbobinador de film", "Empacadora", "Envolvedora de film", "OEM", 780, 110, 4, 1, 2, "un"],
  ["Ventosa de vacio 60 mm con fuelle", "Empacadora", "Cabezal de agrupacion", "Importado", 42, 35, 4, 3, 55, "un"],

  // ------------------------------------------------------------ Paletizado
  ["Pinza neumatica de capa completa", "Paletizado", "Paletizador", "OEM", 5400, 145, 4, 1, 0.3, "un"],
  ["Cilindro neumatico ISO 15552 63x300", "Paletizado", "Paletizador", "Importado", 265, 40, 4, 3, 14, "un"],
  ["Servo drive de eje vertical 5 kW", "Paletizado", "Paletizador", "OEM", 8600, 150, 4, 1, 0.2, "un"],
  ["Encoder absoluto multivuelta", "Paletizado", "Paletizador", "Importado", 1450, 90, 4, 2, 1, "un"],
  ["Cadena de rodillos ASA 80 simple", "Paletizado", "Transporte de pallets", "Nacional", 48, 20, 3, 4, 40, "m"],
  ["Rodillo motorizado de transporte de pallet", "Paletizado", "Transporte de pallets", "Nacional", 210, 30, 3, 3, 10, "un"],
  ["Film stretch pre-estirado 23 um", "Paletizado", "Enfardadora", "Nacional", 32, 12, 3, 5, 900, "rollo"],

  // ---------------------------------------------------------- Lavadora PRB
  ["Portabotellas de lavadora (bolsillo)", "Lavadora PRB", "Lavadora de botellas", "OEM", 68, 135, 5, 1, 240, "un"],
  ["Cadena de transporte de lavadora", "Lavadora PRB", "Lavadora de botellas", "OEM", 320, 140, 5, 1, 24, "m"],
  ["Boquilla de inyeccion interior inox", "Lavadora PRB", "Zona de enjuague", "OEM", 46, 120, 5, 1, 180, "un"],
  ["Bomba centrifuga de sosa 11 kW", "Lavadora PRB", "Circuito de sosa", "Importado", 5200, 100, 5, 2, 0.3, "un"],
  ["Sello mecanico resistente a sosa", "Lavadora PRB", "Circuito de sosa", "Importado", 720, 85, 5, 2, 5, "un"],
  ["Filtro de etiquetas rotativo", "Lavadora PRB", "Extraccion de etiquetas", "OEM", 3100, 145, 4, 1, 0.3, "un"],
  ["Serpentin de calefaccion de bano", "Lavadora PRB", "Bano de sosa", "OEM", 4800, 150, 5, 1, 0.2, "un"],
  ["Sonda de conductividad para sosa", "Lavadora PRB", "Control de concentracion", "Importado", 780, 70, 4, 2, 2, "un"],

  // -------------------------------------------------------- Pasteurizador
  ["Boquilla de aspersion de tunel pasteurizador", "Pasteurizador", "Tunel pasteurizador", "Importado", 22, 65, 4, 3, 260, "un"],
  ["Bomba de recirculacion 7,5 kW", "Pasteurizador", "Tunel pasteurizador", "Importado", 3900, 90, 4, 2, 0.3, "un"],
  ["Cadena de transporte de pasteurizador", "Pasteurizador", "Tunel pasteurizador", "OEM", 290, 130, 4, 1, 18, "m"],
  ["Valvula de control de vapor 2\"", "Pasteurizador", "Calefaccion", "Importado", 2450, 95, 4, 2, 0.5, "un"],
  ["Sonda PT100 sanitaria con vaina", "Pasteurizador", "Control de temperatura", "Importado", 195, 45, 4, 3, 14, "un"],

  // ------------------------------------------------------------ Inspeccion
  ["Camara de inspeccion de botella vacia", "Inspeccion", "Inspector de vacio", "OEM", 12500, 150, 4, 1, 0.1, "un"],
  ["Lampara estroboscopica LED de inspeccion", "Inspeccion", "Inspector de vacio", "OEM", 1650, 125, 4, 1, 1, "un"],
  ["Tarjeta de procesamiento de vision", "Inspeccion", "Inspector de nivel", "OEM", 4200, 140, 4, 1, 0.3, "un"],
  ["Rechazador neumatico de botella", "Inspeccion", "Estacion de rechazo", "Importado", 1450, 80, 4, 2, 1, "un"],
  ["Detector de metales en linea", "Inspeccion", "Control de calidad", "Importado", 8900, 120, 3, 2, 0.1, "un"],

  // ------------------------------------------------------- Sala de maquinas
  ["Quemador dual de caldera 2000 kg/h", "Vapor", "Caldera pirotubular", "Importado", 18500, 130, 5, 1, 0.1, "un"],
  ["Electrodo de encendido de quemador", "Vapor", "Caldera pirotubular", "Importado", 145, 55, 5, 2, 6, "un"],
  ["Valvula de seguridad de caldera 10 bar", "Vapor", "Caldera pirotubular", "Importado", 1250, 75, 5, 2, 0.5, "un"],
  ["Bomba de alimentacion de caldera 5,5 kW", "Vapor", "Caldera pirotubular", "Importado", 3200, 85, 5, 2, 0.3, "un"],
  ["Sonda de nivel capacitiva de caldera", "Vapor", "Caldera pirotubular", "Importado", 890, 70, 5, 2, 1, "un"],
  ["Trampa de vapor termodinamica 3/4\"", "Vapor", "Red de distribucion", "Importado", 185, 45, 3, 3, 26, "un"],
  ["Empaquetadura grafitada trenzada", "Vapor", "Valvulas de vapor", "Nacional", 68, 20, 3, 4, 45, "kg"],
  ["Valvula reductora de presion de vapor 2\"", "Vapor", "Red de distribucion", "Importado", 1980, 80, 4, 2, 0.4, "un"],

  ["Compresor de tornillo 75 kW (kit mayor)", "Aire comprimido", "Compresor de servicio", "Importado", 9800, 110, 5, 2, 0.3, "un"],
  ["Elemento separador aire-aceite", "Aire comprimido", "Compresor de servicio", "Importado", 420, 60, 5, 3, 4, "un"],
  ["Filtro de aire de admision compresor", "Aire comprimido", "Compresor de servicio", "Importado", 95, 45, 4, 3, 12, "un"],
  ["Filtro coalescente de linea 1\"", "Aire comprimido", "Tratamiento de aire", "Importado", 145, 50, 4, 3, 20, "un"],
  ["Purga automatica de condensado", "Aire comprimido", "Tratamiento de aire", "Importado", 320, 55, 3, 3, 8, "un"],
  ["Secador frigorifico de aire (kit)", "Aire comprimido", "Tratamiento de aire", "Importado", 2400, 90, 4, 2, 0.3, "un"],

  ["Compresor de amoniaco a tornillo (rotor)", "Frio", "Central de amoniaco", "Importado", 28000, 165, 5, 1, 0.1, "un"],
  ["Valvula de expansion electronica NH3", "Frio", "Central de amoniaco", "Importado", 3400, 110, 5, 1, 0.3, "un"],
  ["Sensor de fuga de amoniaco electroquimico", "Frio", "Sala de maquinas", "Importado", 1250, 85, 5, 2, 2, "un"],
  ["Bomba de glicol 7,5 kW", "Frio", "Circuito de glicol", "Importado", 3600, 80, 4, 2, 0.3, "un"],
  ["Relleno de torre de enfriamiento PVC", "Frio", "Torre de enfriamiento", "Nacional", 78, 30, 3, 3, 20, "m2"],
  ["Ventilador axial de torre 5,5 kW", "Frio", "Torre de enfriamiento", "Importado", 2100, 75, 3, 2, 0.4, "un"],
  ["Boquilla de distribucion de torre", "Frio", "Torre de enfriamiento", "Nacional", 12, 20, 3, 4, 85, "un"],

  ["Valvula mixproof de doble asiento DN80", "CIP", "Matriz de valvulas CIP", "Importado", 6800, 120, 5, 1, 0.4, "un"],
  ["Kit de sellos para valvula mixproof DN80", "CIP", "Matriz de valvulas CIP", "Importado", 420, 95, 5, 2, 12, "un"],
  ["Bomba centrifuga CIP 15 kW", "CIP", "Central CIP", "Importado", 5900, 100, 5, 2, 0.2, "un"],
  ["Cabezal de lavado rotativo 360 grados", "CIP", "Limpieza de tanques", "Importado", 1450, 85, 4, 2, 3, "un"],
  ["Sensor de conductividad CIP sanitario", "CIP", "Control CIP", "Importado", 980, 75, 4, 2, 2, "un"],
  ["Resistencia de calentamiento de solucion CIP", "CIP", "Central CIP", "Importado", 780, 70, 4, 2, 3, "un"],

  // ----------------------------------------------------------------- RILES
  ["Soplador de canal lateral 15 kW", "RILES", "Aireacion biologica", "Importado", 6200, 110, 4, 2, 0.2, "un"],
  ["Difusor de burbuja fina de membrana", "RILES", "Aireacion biologica", "Importado", 42, 70, 4, 2, 130, "un"],
  ["Sensor de oxigeno disuelto optico", "RILES", "Control de aireacion", "Importado", 2400, 95, 4, 2, 0.5, "un"],
  ["Bomba sumergible de lodos 7,5 kW", "RILES", "Recirculacion de lodos", "Importado", 4100, 90, 4, 2, 0.4, "un"],
  ["Bomba dosificadora de polimero", "RILES", "Deshidratacion", "Importado", 1650, 70, 3, 3, 0.6, "un"],
  ["Tela filtrante para filtro banda", "RILES", "Deshidratacion", "Importado", 1850, 105, 3, 2, 1, "un"],
  ["Agitador sumergible de ecualizacion", "RILES", "Estanque de ecualizacion", "Importado", 5400, 115, 3, 2, 0.2, "un"],
  ["Sonda de pH industrial para RIL", "RILES", "Control de neutralizacion", "Importado", 420, 50, 3, 3, 8, "un"],

  // -------------------------------------------------------- Automatizacion
  ["Variador de frecuencia 22 kW", "Automatizacion", "Accionamientos de linea", "Importado", 3100, 70, 4, 2, 2, "un"],
  ["Variador de frecuencia 5,5 kW", "Automatizacion", "Accionamientos de linea", "Importado", 980, 55, 4, 3, 5, "un"],
  ["CPU de PLC con puerto Profinet", "Automatizacion", "Control de linea", "Importado", 4800, 100, 5, 1, 0.3, "un"],
  ["Tarjeta de entradas analogicas 8 canales", "Automatizacion", "Control de linea", "Importado", 1180, 85, 5, 2, 1, "un"],
  ["Tarjeta de salidas digitales 16 canales", "Automatizacion", "Control de linea", "Importado", 640, 80, 5, 2, 2, "un"],
  ["Panel HMI 15\" tactil", "Automatizacion", "Interfaz de operador", "Importado", 3900, 95, 4, 2, 0.4, "un"],
  ["Fuente de poder 24 VDC 20 A", "Automatizacion", "Tableros de control", "Importado", 320, 45, 4, 3, 6, "un"],
  ["Switch industrial gestionado 8 puertos", "Automatizacion", "Red de planta", "Importado", 890, 70, 4, 2, 2, "un"],
  ["Contactor tripolar 65 A con bobina 220 V", "Automatizacion", "Tableros de fuerza", "Importado", 125, 35, 3, 4, 28, "un"],
  ["Rele termico regulable 30-40 A", "Automatizacion", "Tableros de fuerza", "Importado", 78, 30, 3, 4, 22, "un"],
  ["Encoder incremental 1024 ppr", "Automatizacion", "Sincronizacion de linea", "Importado", 480, 60, 4, 3, 6, "un"],
  ["Barrera de seguridad optoelectronica", "Automatizacion", "Seguridad de maquina", "Importado", 1650, 85, 4, 2, 1, "un"],
  ["Interruptor de seguridad de puerta con enclavamiento", "Automatizacion", "Seguridad de maquina", "Importado", 285, 50, 4, 3, 9, "un"],

  // ------------------------------------------------------------- Neumatica
  ["Electrovalvula 5/2 monoestable 24 VDC", "Neumatica", "Islas de valvulas", "Importado", 118, 40, 4, 3, 48, "un"],
  ["Isla de valvulas de 16 posiciones", "Neumatica", "Islas de valvulas", "Importado", 2650, 90, 4, 2, 0.4, "un"],
  ["Unidad de mantenimiento FRL 1/2\"", "Neumatica", "Preparacion de aire", "Importado", 195, 35, 3, 4, 12, "un"],
  ["Racor rapido recto 8 mm", "Neumatica", "Instalacion neumatica", "Nacional", 2.4, 10, 2, 5, 720, "un"],
  ["Manguera de poliuretano 8x5 mm", "Neumatica", "Instalacion neumatica", "Nacional", 1.8, 10, 2, 5, 950, "m"],
  ["Cilindro compacto ISO 21287 50x50", "Neumatica", "Actuadores de linea", "Importado", 148, 40, 3, 3, 26, "un"],
  ["Regulador de caudal con antirretorno", "Neumatica", "Actuadores de linea", "Importado", 26, 30, 2, 4, 95, "un"],

  // ----------------------------------------------------------- Laboratorio
  ["Electrodo de pH de laboratorio", "Laboratorio", "Control de calidad", "Importado", 380, 45, 2, 3, 4, "un"],
  ["Celda de medicion de turbidez", "Laboratorio", "Control de calidad", "Importado", 620, 60, 2, 2, 2, "un"],
  ["Kit de reactivos para analisis de CO2", "Laboratorio", "Control de calidad", "Importado", 240, 50, 2, 2, 12, "kit"],
  ["Membrana para filtracion microbiologica 0,45 um", "Laboratorio", "Microbiologia", "Importado", 1.9, 40, 2, 3, 2400, "un"],
];

const AREAS_LINEA_CRITICA = new Set(["Sopladora PET", "Llenadora", "Capsuladora", "Lavadora PRB"]);

/**
 * @param {number} n cantidad de SKU a generar
 * @param {number} semilla
 * @returns {object[]}
 */
export function generarEmbotelladora(n = 200, semilla = 2024) {
  const rnd = prng(semilla);
  const filas = [];

  for (let i = 0; i < n; i++) {
    const base = CATALOGO[i % CATALOGO.length];
    const [descripcion, area, equipo, marca, precio0, lead0, critEquipo, prov0, rot0, unidad] = base;
    const vuelta = Math.floor(i / CATALOGO.length);

    // Cada vuelta al catalogo produce una variante (otra medida o modelo).
    const precio = Math.round(precio0 * (0.75 + rnd() * 0.7) * 100) / 100;
    const leadTime = Math.max(5, Math.round(lead0 * (0.75 + rnd() * 0.55)));
    const proveedores = Math.max(1, prov0 - (rnd() < 0.25 ? 1 : 0));
    const consumoAnual = Math.max(0, Math.round(rot0 * (0.4 + rnd() * 1.5)));

    // Las horas de parada escalan con la criticidad del equipo, con dispersion.
    const horasParada = Math.max(1, Math.round(critEquipo * (1.5 + rnd() * 7)));

    // Politica de stock "a ojo" tipica de bodega: meses de cobertura al azar,
    // sin mirar lead time ni criticidad. De ahi salen el sobrestock y los quiebres.
    const cobertura = consumoAnual / 12;
    const sorteo = rnd();
    let stockActual;
    if (sorteo < 0.09) {
      stockActual = 0;                                              // quiebre
    } else if (sorteo < 0.2) {
      stockActual = Math.floor(cobertura * rnd() * 0.6);            // bajo cobertura
    } else if (sorteo < 0.78) {
      stockActual = Math.ceil(cobertura * (1 + rnd() * 4));         // normal
    } else {
      stockActual = Math.ceil(cobertura * (5 + rnd() * 9));         // sobrestock
    }
    // Los repuestos de capital casi no rotan: se guardan 1 o 2 unidades.
    if (consumoAnual <= 1) stockActual = rnd() < 0.35 ? 0 : Math.ceil(rnd() * 2);

    filas.push({
      sku: `RB-${String(10000 + i)}`,
      descripcion: vuelta ? `${descripcion} — variante ${vuelta + 1}` : descripcion,
      categoria: area,
      equipo,
      origen: marca,
      unidad,
      precio,
      consumoAnual,
      leadTime,
      criticidadEquipo: critEquipo,
      horasParada,
      proveedores,
      stockActual,
      // Dato de contexto, no lo usa el motor: hace que el archivo parezca lo que es,
      // un extracto de ERP con columnas de mas.
      almacen: AREAS_LINEA_CRITICA.has(area) ? "BOD-LINEA" : "BOD-CENTRAL",
    });
  }
  return filas;
}

export const COLUMNAS = [
  "sku", "descripcion", "categoria", "equipo", "origen", "unidad", "almacen",
  "precio", "consumoAnual", "leadTime", "criticidadEquipo", "horasParada",
  "proveedores", "stockActual",
];

export const ENCABEZADOS = {
  sku: "SKU", descripcion: "Descripcion", categoria: "Categoria", equipo: "Equipo",
  origen: "Origen", unidad: "Unidad", almacen: "Almacen",
  precio: "Precio unitario", consumoAnual: "Consumo anual", leadTime: "Lead time (dias)",
  criticidadEquipo: "Criticidad equipo (1-5)", horasParada: "Horas parada si falla",
  proveedores: "N proveedores", stockActual: "Stock actual",
};

export function aCSV(filas) {
  const escapar = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    COLUMNAS.map((c) => ENCABEZADOS[c]).join(","),
    ...filas.map((f) => COLUMNAS.map((c) => escapar(f[c])).join(",")),
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2]) || 200;
  const destino = resolve(AQUI, "..", process.argv[3] || "datos/embotelladora-200.csv");
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, aCSV(generarEmbotelladora(n)), "utf8");
  console.log(`OK  ${n} repuestos de ${new Set(CATALOGO.map((c) => c[1])).size} areas -> ${destino}`);
}
