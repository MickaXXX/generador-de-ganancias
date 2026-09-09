/**
 * ================== EL UNICO ARCHIVO QUE TIENES QUE EDITAR ==================
 *
 * 1. Crea el producto en Gumroad (o Lemon Squeezy) y pega aqui su link.
 * 2. Si quieres vender por transferencia / MercadoPago, emite licencias con
 *    `npm run licencia:emitir` y pega tu clave publica en CLAVE_PUBLICA.
 * 3. Sube el repo a GitHub Pages. Listo: la venta corre sola 24/7.
 * ===========================================================================
 */
export const CONFIG = {
  marca: "CritiSpare",
  eslogan: "Cuanto capital duerme en tu bodega de repuestos",

  // --- Comercial ---------------------------------------------------------
  precio: "US$149",
  precioEtiqueta: "pago unico - licencia anual para toda tu planta",
  // Reemplaza por el link de tu producto en Gumroad / Lemon Squeezy.
  linkCompra: "https://gumroad.com/l/critispare",
  // ID del producto en Gumroad para validar licencias automaticamente.
  // Dejalo vacio si por ahora solo emites licencias firmadas a mano.
  gumroadProductId: "",
  emailContacto: "",
  linkAgenda: "", // ej. Calendly, para vender consultoria (el ticket grande)

  // --- Limite de la version gratuita -------------------------------------
  limiteGratis: 50,

  // --- Licencias firmadas (sin servidor) ---------------------------------
  // Reemplazala corriendo: npm run licencia:par -- --forzar
  // OJO: al reemplazarla, la licencia de demo deja de funcionar.
  CLAVE_PUBLICA: {
    kty: "EC",
    crv: "P-256",
    x: "82eX3TSZtoltQ0vdNA-4ZgBlorPbFeC-LxBV4n2916w",
    y: "oTOt93yKe8Q_VEXnG2qUJf5uSFjqjNm0k-okUf5bLj8",
  },
  producto: "critispare-pro",

  // Licencia de demostracion (para que veas funcionar el modo Pro).
  licenciaDemo:
    "eyJjIjoiRGVtbyBDcml0aVNwYXJlIiwiZXhwIjoiMjAzNi0wOS0wNiIsInAiOiJjcml0aXNwYXJlLXBybyIsImlkIjoiNXlIV0NKalMifQ" +
    ".AI4C_LR5ENELrOSQ1QEiqgrGlxZXKQ46mfNWFiYvYBFpiOMqqCe0dhsfZ4HuCTLmSWLcqhEIzg8OqAGBvNr9FA",

  // --- Supuestos del modelo (ajustables desde la interfaz) ---------------
  cvDemanda: 0.5,
  moneda: "USD",
};
