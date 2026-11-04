// Catálogos del SAT (Anexo 20) necesarios para que la representación impresa sea legible.
// Solo los catálogos cortos; ClaveProdServ y ClaveUnidad (miles de entradas) se muestran por clave.

export const FORMA_PAGO: Record<string, string> = {
  "01": "Efectivo",
  "02": "Cheque nominativo",
  "03": "Transferencia electrónica de fondos",
  "04": "Tarjeta de crédito",
  "05": "Monedero electrónico",
  "06": "Dinero electrónico",
  "08": "Vales de despensa",
  "12": "Dación en pago",
  "13": "Pago por subrogación",
  "14": "Pago por consignación",
  "15": "Condonación",
  "17": "Compensación",
  "23": "Novación",
  "24": "Confusión",
  "25": "Remisión de deuda",
  "26": "Prescripción o caducidad",
  "27": "A satisfacción del acreedor",
  "28": "Tarjeta de débito",
  "29": "Tarjeta de servicios",
  "30": "Aplicación de anticipos",
  "31": "Intermediario pagos",
  "99": "Por definir",
};

export const METODO_PAGO: Record<string, string> = {
  PUE: "Pago en una sola exhibición",
  PPD: "Pago en parcialidades o diferido",
};

export const USO_CFDI: Record<string, string> = {
  G01: "Adquisición de mercancías",
  G02: "Devoluciones, descuentos o bonificaciones",
  G03: "Gastos en general",
  I01: "Construcciones",
  I02: "Mobiliario y equipo de oficina por inversiones",
  I03: "Equipo de transporte",
  I04: "Equipo de cómputo y accesorios",
  I05: "Dados, troqueles, moldes, matrices y herramental",
  I06: "Comunicaciones telefónicas",
  I07: "Comunicaciones satelitales",
  I08: "Otra maquinaria y equipo",
  D01: "Honorarios médicos, dentales y gastos hospitalarios",
  D02: "Gastos médicos por incapacidad o discapacidad",
  D03: "Gastos funerales",
  D04: "Donativos",
  D05: "Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)",
  D06: "Aportaciones voluntarias al SAR",
  D07: "Primas por seguros de gastos médicos",
  D08: "Gastos de transportación escolar obligatoria",
  D09: "Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones",
  D10: "Pagos por servicios educativos (colegiaturas)",
  S01: "Sin efectos fiscales",
  CP01: "Pagos",
  CN01: "Nómina",
  P01: "Por definir",
};

export const REGIMEN_FISCAL: Record<string, string> = {
  "601": "General de Ley Personas Morales",
  "603": "Personas Morales con Fines no Lucrativos",
  "605": "Sueldos y Salarios e Ingresos Asimilados a Salarios",
  "606": "Arrendamiento",
  "607": "Régimen de Enajenación o Adquisición de Bienes",
  "608": "Demás ingresos",
  "610": "Residentes en el Extranjero sin Establecimiento Permanente en México",
  "611": "Ingresos por Dividendos (socios y accionistas)",
  "612": "Personas Físicas con Actividades Empresariales y Profesionales",
  "614": "Ingresos por intereses",
  "615": "Régimen de los ingresos por obtención de premios",
  "616": "Sin obligaciones fiscales",
  "620": "Sociedades Cooperativas de Producción que optan por diferir sus ingresos",
  "621": "Incorporación Fiscal",
  "622": "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
  "623": "Opcional para Grupos de Sociedades",
  "624": "Coordinados",
  "625": "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas",
  "626": "Régimen Simplificado de Confianza",
};

export const TIPO_COMPROBANTE: Record<string, { label: string; title: string }> = {
  I: { label: "Ingreso", title: "Factura" },
  E: { label: "Egreso", title: "Nota de crédito" },
  T: { label: "Traslado", title: "Carta porte / Traslado" },
  N: { label: "Nómina", title: "Recibo de nómina" },
  P: { label: "Pago", title: "Complemento de pago" },
};

export const IMPUESTO: Record<string, string> = {
  "001": "ISR",
  "002": "IVA",
  "003": "IEPS",
};

export const EXPORTACION: Record<string, string> = {
  "01": "No aplica",
  "02": "Definitiva con clave A1",
  "03": "Temporal",
  "04": "Definitiva con clave distinta a A1 o sin enajenación",
};

export const OBJETO_IMP: Record<string, string> = {
  "01": "No objeto de impuesto",
  "02": "Sí objeto de impuesto",
  "03": "Sí objeto y no obligado al desglose",
  "04": "Sí objeto y no causa impuesto",
  "05": "Sí objeto, IVA crédito PODEBI",
};

export const TIPO_RELACION: Record<string, string> = {
  "01": "Nota de crédito de los documentos relacionados",
  "02": "Nota de débito de los documentos relacionados",
  "03": "Devolución de mercancía sobre facturas o traslados previos",
  "04": "Sustitución de los CFDI previos",
  "05": "Traslados de mercancías facturados previamente",
  "06": "Factura generada por los traslados previos",
  "07": "CFDI por aplicación de anticipo",
  "08": "Factura generada por pagos en parcialidades",
  "09": "Factura generada por pagos diferidos",
};

export const TIPO_NOMINA: Record<string, string> = {
  O: "Ordinaria",
  E: "Extraordinaria",
};

export const PERIODICIDAD_PAGO: Record<string, string> = {
  "01": "Diario",
  "02": "Semanal",
  "03": "Catorcenal",
  "04": "Quincenal",
  "05": "Mensual",
  "06": "Bimestral",
  "07": "Unidad de obra",
  "08": "Comisión",
  "09": "Precio alzado",
  "10": "Decenal",
  "99": "Otra periodicidad",
};

export const TIPO_CONTRATO: Record<string, string> = {
  "01": "Por tiempo indeterminado",
  "02": "Por obra determinada",
  "03": "Por tiempo determinado",
  "04": "Por temporada",
  "05": "Sujeto a prueba",
  "06": "Con capacitación inicial",
  "07": "Por pago de hora laborada",
  "08": "Por comisión laboral",
  "09": "Sin relación de trabajo",
  "10": "Jubilación, pensión, retiro",
  "99": "Otro contrato",
};

export const TIPO_REGIMEN: Record<string, string> = {
  "02": "Sueldos",
  "03": "Jubilados",
  "04": "Pensionados",
  "05": "Asimilados: miembros de sociedades cooperativas de producción",
  "06": "Asimilados: integrantes de sociedades y asociaciones civiles",
  "07": "Asimilados: miembros de consejos",
  "08": "Asimilados: comisionistas",
  "09": "Asimilados: honorarios",
  "10": "Asimilados: acciones",
  "11": "Asimilados: otros",
  "12": "Jubilados o pensionados",
  "13": "Indemnización o separación",
  "99": "Otro régimen",
};

export const TIPO_PERCEPCION: Record<string, string> = {
  "001": "Sueldos, salarios, rayas y jornales",
  "002": "Gratificación anual (aguinaldo)",
  "003": "Participación de los trabajadores en las utilidades (PTU)",
  "004": "Reembolso de gastos médicos, dentales y hospitalarios",
  "005": "Fondo de ahorro",
  "006": "Caja de ahorro",
  "009": "Contribuciones a cargo del trabajador pagadas por el patrón",
  "010": "Premios por puntualidad",
  "011": "Prima de seguro de vida",
  "012": "Seguro de gastos médicos mayores",
  "013": "Cuotas sindicales pagadas por el patrón",
  "014": "Subsidios por incapacidad",
  "015": "Becas para trabajadores y/o hijos",
  "019": "Horas extra",
  "020": "Prima dominical",
  "021": "Prima vacacional",
  "022": "Prima por antigüedad",
  "023": "Pagos por separación",
  "024": "Seguro de retiro",
  "025": "Indemnizaciones",
  "026": "Reembolso por funeral",
  "027": "Cuotas de seguridad social pagadas por el patrón",
  "028": "Comisiones",
  "029": "Vales de despensa",
  "030": "Vales de restaurante",
  "031": "Vales de gasolina",
  "032": "Vales de ropa",
  "033": "Ayuda para renta",
  "034": "Ayuda para artículos escolares",
  "035": "Ayuda para anteojos",
  "036": "Ayuda para transporte",
  "037": "Ayuda para gastos de funeral",
  "038": "Otros ingresos por salarios",
  "039": "Jubilaciones, pensiones o haberes de retiro",
  "044": "Jubilaciones, pensiones o haberes de retiro en parcialidades",
  "045": "Ingresos en acciones o títulos valor",
  "046": "Ingresos asimilados a salarios",
  "047": "Alimentación",
  "048": "Habitación",
  "049": "Premios por asistencia",
  "050": "Viáticos",
};

export const TIPO_DEDUCCION: Record<string, string> = {
  "001": "Seguridad social",
  "002": "ISR",
  "003": "Aportaciones a retiro, cesantía en edad avanzada y vejez",
  "004": "Otros",
  "005": "Aportaciones a fondo de vivienda",
  "006": "Descuento por incapacidad",
  "007": "Pensión alimenticia",
  "008": "Renta",
  "009": "Préstamos del INFONAVIT",
  "010": "Pago por crédito de vivienda",
  "011": "Pago de abonos INFONACOT",
  "012": "Anticipo de salarios",
  "013": "Pagos hechos con exceso al trabajador",
  "014": "Errores",
  "015": "Pérdidas",
  "016": "Averías",
  "017": "Adquisición de artículos producidos por la empresa",
  "018": "Cuotas para sociedades cooperativas y cajas de ahorro",
  "019": "Cuotas sindicales",
  "020": "Ausencia (ausentismo)",
  "021": "Cuotas obrero patronales",
  "022": "Impuestos locales",
  "023": "Aportaciones voluntarias",
  "024": "Ajuste en aguinaldo exento",
  "025": "Ajuste en aguinaldo gravado",
  "026": "Ajuste en PTU exento",
  "027": "Ajuste en PTU gravado",
  "101": "ISR retenido de ejercicio anterior",
};

export const TIPO_OTRO_PAGO: Record<string, string> = {
  "001": "Reintegro de ISR pagado en exceso",
  "002": "Subsidio para el empleo",
  "003": "Viáticos entregados al trabajador",
  "004": "Aplicación de saldo a favor por compensación anual",
  "005": "Reintegro de ISR retenido en exceso de ejercicio anterior",
  "006": "Alimentos en bienes",
  "007": "ISR ajustado por subsidio",
  "008": "Subsidio efectivamente entregado que no correspondía",
  "009": "Reembolso de otros descuentos o deducciones",
  "999": "Pagos distintos a los listados",
};

/** «03 - Transferencia electrónica de fondos»; si la clave no está en el catálogo, solo la clave. */
export function labeled(catalog: Record<string, string>, code: string | undefined): string {
  if (!code) return "";
  const label = catalog[code];
  return label ? `${code} - ${label}` : code;
}
