// Modelo tipado de un CFDI 3.3 / 4.0 y su lectura desde XML. Solo se extrae lo que la
// representación impresa necesita (Anexo 20 y regla 2.7.1.7 de la RMF) más los complementos
// que reciben los particulares: Timbre Fiscal Digital, Nómina 1.2 y Recepción de pagos 1.0 / 2.0.
import { EngineError } from "../errors.ts";
import { child, children, type XmlElement } from "./xml.ts";

export const NS = {
  cfdi3: "http://www.sat.gob.mx/cfd/3",
  cfdi4: "http://www.sat.gob.mx/cfd/4",
  tfd: "http://www.sat.gob.mx/TimbreFiscalDigital",
  nomina12: "http://www.sat.gob.mx/nomina12",
  pagos10: "http://www.sat.gob.mx/Pagos",
  pagos20: "http://www.sat.gob.mx/Pagos20",
} as const;

export interface CfdiTax {
  impuesto: string;
  tipoFactor?: string;
  tasaOCuota?: string;
  base?: string;
  importe?: string;
}

export interface CfdiConcepto {
  claveProdServ: string;
  noIdentificacion?: string;
  cantidad: string;
  claveUnidad: string;
  unidad?: string;
  descripcion: string;
  valorUnitario: string;
  importe: string;
  descuento?: string;
  objetoImp?: string;
}

export interface CfdiRelacionados {
  tipoRelacion: string;
  uuids: string[];
}

export interface CfdiTimbre {
  version: string;
  uuid: string;
  fechaTimbrado: string;
  rfcProvCertif: string;
  leyenda?: string;
  selloCFD: string;
  noCertificadoSAT: string;
  selloSAT: string;
}

export interface NominaPercepcion {
  tipo: string;
  clave: string;
  concepto: string;
  gravado: string;
  exento: string;
}

export interface NominaDeduccion {
  tipo: string;
  clave: string;
  concepto: string;
  importe: string;
}

export interface NominaOtroPago {
  tipo: string;
  clave: string;
  concepto: string;
  importe: string;
  subsidioCausado?: string;
}

export interface CfdiNomina {
  version: string;
  tipoNomina: string;
  fechaPago: string;
  fechaInicialPago: string;
  fechaFinalPago: string;
  numDiasPagados: string;
  totalPercepciones?: string;
  totalDeducciones?: string;
  totalOtrosPagos?: string;
  emisor: { registroPatronal?: string; curp?: string; rfcPatronOrigen?: string };
  receptor: {
    curp?: string;
    numSeguridadSocial?: string;
    fechaInicioRelLaboral?: string;
    antiguedad?: string;
    tipoContrato?: string;
    sindicalizado?: string;
    tipoJornada?: string;
    tipoRegimen?: string;
    numEmpleado?: string;
    departamento?: string;
    puesto?: string;
    riesgoPuesto?: string;
    periodicidadPago?: string;
    banco?: string;
    cuentaBancaria?: string;
    salarioBaseCotApor?: string;
    salarioDiarioIntegrado?: string;
    claveEntFed?: string;
  };
  percepciones: { totalSueldos?: string; totalGravado?: string; totalExento?: string; items: NominaPercepcion[] } | null;
  deducciones: { totalOtrasDeducciones?: string; totalImpuestosRetenidos?: string; items: NominaDeduccion[] } | null;
  otrosPagos: NominaOtroPago[];
}

export interface PagoDocumento {
  idDocumento: string;
  serie?: string;
  folio?: string;
  monedaDR?: string;
  numParcialidad?: string;
  impSaldoAnt?: string;
  impPagado?: string;
  impSaldoInsoluto?: string;
}

export interface CfdiPago {
  fechaPago: string;
  formaDePagoP: string;
  monedaP: string;
  tipoCambioP?: string;
  monto: string;
  numOperacion?: string;
  rfcEmisorCtaOrd?: string;
  ctaOrdenante?: string;
  rfcEmisorCtaBen?: string;
  ctaBeneficiario?: string;
  documentos: PagoDocumento[];
}

export interface Cfdi {
  version: "3.3" | "4.0";
  serie?: string;
  folio?: string;
  fecha: string;
  sello?: string;
  noCertificado?: string;
  formaPago?: string;
  metodoPago?: string;
  condicionesDePago?: string;
  subTotal: string;
  descuento?: string;
  moneda: string;
  tipoCambio?: string;
  total: string;
  tipoDeComprobante: string;
  exportacion?: string;
  lugarExpedicion: string;
  emisor: { rfc: string; nombre?: string; regimenFiscal?: string };
  receptor: {
    rfc: string;
    nombre?: string;
    domicilioFiscal?: string;
    regimenFiscal?: string;
    usoCFDI?: string;
    residenciaFiscal?: string;
    numRegIdTrib?: string;
  };
  relacionados: CfdiRelacionados[];
  conceptos: CfdiConcepto[];
  impuestos: { totalTrasladados?: string; totalRetenidos?: string; traslados: CfdiTax[]; retenciones: CfdiTax[] } | null;
  timbre: CfdiTimbre | null;
  nomina: CfdiNomina | null;
  pagos: { version: string; montoTotalPagos?: string; pagos: CfdiPago[] } | null;
}

const DECIMAL = /^-?\d{1,18}(\.\d{1,6})?$/;

function invalid(detail: string): EngineError {
  return new EngineError("input.invalid", detail);
}

function required(element: XmlElement, attr: string, where: string): string {
  const value = element.attrs[attr];
  if (value === undefined || value.trim() === "") throw invalid(`El CFDI no tiene el atributo «${attr}» en ${where}.`);
  return value.trim();
}

function optional(element: XmlElement, attr: string): string | undefined {
  const value = element.attrs[attr]?.trim();
  return value ? value : undefined;
}

function amount(element: XmlElement, attr: string, where: string): string {
  const value = required(element, attr, where);
  if (!DECIMAL.test(value)) throw invalid(`El importe «${attr}» de ${where} no es un número válido (${value}).`);
  return value;
}

function optionalAmount(element: XmlElement, attr: string, where: string): string | undefined {
  const value = optional(element, attr);
  if (value === undefined) return undefined;
  if (!DECIMAL.test(value)) throw invalid(`El importe «${attr}» de ${where} no es un número válido (${value}).`);
  return value;
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value as T[K];
}

function readTax(element: XmlElement): CfdiTax {
  const tax: CfdiTax = { impuesto: required(element, "Impuesto", "Impuestos") };
  assign(tax, "tipoFactor", optional(element, "TipoFactor"));
  assign(tax, "tasaOCuota", optional(element, "TasaOCuota"));
  assign(tax, "base", optionalAmount(element, "Base", "Impuestos"));
  assign(tax, "importe", optionalAmount(element, "Importe", "Impuestos"));
  return tax;
}

function readConcepto(element: XmlElement, index: number): CfdiConcepto {
  const where = `el concepto ${index + 1}`;
  const concepto: CfdiConcepto = {
    claveProdServ: required(element, "ClaveProdServ", where),
    cantidad: amount(element, "Cantidad", where),
    claveUnidad: required(element, "ClaveUnidad", where),
    descripcion: required(element, "Descripcion", where),
    valorUnitario: amount(element, "ValorUnitario", where),
    importe: amount(element, "Importe", where),
  };
  assign(concepto, "noIdentificacion", optional(element, "NoIdentificacion"));
  assign(concepto, "unidad", optional(element, "Unidad"));
  assign(concepto, "descuento", optionalAmount(element, "Descuento", where));
  assign(concepto, "objetoImp", optional(element, "ObjetoImp"));
  return concepto;
}

function readTimbre(element: XmlElement): CfdiTimbre {
  const where = "el Timbre Fiscal Digital";
  const timbre: CfdiTimbre = {
    version: required(element, "Version", where),
    uuid: required(element, "UUID", where).toUpperCase(),
    fechaTimbrado: required(element, "FechaTimbrado", where),
    rfcProvCertif: required(element, "RfcProvCertif", where),
    selloCFD: required(element, "SelloCFD", where),
    noCertificadoSAT: required(element, "NoCertificadoSAT", where),
    selloSAT: required(element, "SelloSAT", where),
  };
  assign(timbre, "leyenda", optional(element, "Leyenda"));
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(timbre.uuid)) {
    throw invalid(`El folio fiscal (UUID) del timbre no tiene el formato correcto (${timbre.uuid}).`);
  }
  return timbre;
}

function readNomina(element: XmlElement): CfdiNomina {
  const ns = NS.nomina12;
  const where = "el complemento de nómina";
  const emisor = child(element, ns, "Emisor");
  const receptor = child(element, ns, "Receptor");
  if (!receptor) throw invalid("El complemento de nómina no tiene el nodo Receptor.");

  const nomina: CfdiNomina = {
    version: required(element, "Version", where),
    tipoNomina: required(element, "TipoNomina", where),
    fechaPago: required(element, "FechaPago", where),
    fechaInicialPago: required(element, "FechaInicialPago", where),
    fechaFinalPago: required(element, "FechaFinalPago", where),
    numDiasPagados: required(element, "NumDiasPagados", where),
    emisor: {},
    receptor: {},
    percepciones: null,
    deducciones: null,
    otrosPagos: [],
  };
  assign(nomina, "totalPercepciones", optionalAmount(element, "TotalPercepciones", where));
  assign(nomina, "totalDeducciones", optionalAmount(element, "TotalDeducciones", where));
  assign(nomina, "totalOtrosPagos", optionalAmount(element, "TotalOtrosPagos", where));

  if (emisor) {
    assign(nomina.emisor, "registroPatronal", optional(emisor, "RegistroPatronal"));
    assign(nomina.emisor, "curp", optional(emisor, "Curp"));
    assign(nomina.emisor, "rfcPatronOrigen", optional(emisor, "RfcPatronOrigen"));
  }

  const r = nomina.receptor;
  assign(r, "curp", optional(receptor, "Curp"));
  assign(r, "numSeguridadSocial", optional(receptor, "NumSeguridadSocial"));
  assign(r, "fechaInicioRelLaboral", optional(receptor, "FechaInicioRelLaboral"));
  assign(r, "antiguedad", optional(receptor, "Antigüedad"));
  assign(r, "tipoContrato", optional(receptor, "TipoContrato"));
  assign(r, "sindicalizado", optional(receptor, "Sindicalizado"));
  assign(r, "tipoJornada", optional(receptor, "TipoJornada"));
  assign(r, "tipoRegimen", optional(receptor, "TipoRegimen"));
  assign(r, "numEmpleado", optional(receptor, "NumEmpleado"));
  assign(r, "departamento", optional(receptor, "Departamento"));
  assign(r, "puesto", optional(receptor, "Puesto"));
  assign(r, "riesgoPuesto", optional(receptor, "RiesgoPuesto"));
  assign(r, "periodicidadPago", optional(receptor, "PeriodicidadPago"));
  assign(r, "banco", optional(receptor, "Banco"));
  assign(r, "cuentaBancaria", optional(receptor, "CuentaBancaria"));
  assign(r, "salarioBaseCotApor", optionalAmount(receptor, "SalarioBaseCotApor", where));
  assign(r, "salarioDiarioIntegrado", optionalAmount(receptor, "SalarioDiarioIntegrado", where));
  assign(r, "claveEntFed", optional(receptor, "ClaveEntFed"));

  const percepciones = child(element, ns, "Percepciones");
  if (percepciones) {
    nomina.percepciones = {
      items: children(percepciones, ns, "Percepcion").map((item, index) => ({
        tipo: required(item, "TipoPercepcion", `la percepción ${index + 1}`),
        clave: required(item, "Clave", `la percepción ${index + 1}`),
        concepto: required(item, "Concepto", `la percepción ${index + 1}`),
        gravado: amount(item, "ImporteGravado", `la percepción ${index + 1}`),
        exento: amount(item, "ImporteExento", `la percepción ${index + 1}`),
      })),
    };
    assign(nomina.percepciones, "totalSueldos", optionalAmount(percepciones, "TotalSueldos", where));
    assign(nomina.percepciones, "totalGravado", optionalAmount(percepciones, "TotalGravado", where));
    assign(nomina.percepciones, "totalExento", optionalAmount(percepciones, "TotalExento", where));
  }

  const deducciones = child(element, ns, "Deducciones");
  if (deducciones) {
    nomina.deducciones = {
      items: children(deducciones, ns, "Deduccion").map((item, index) => ({
        tipo: required(item, "TipoDeduccion", `la deducción ${index + 1}`),
        clave: required(item, "Clave", `la deducción ${index + 1}`),
        concepto: required(item, "Concepto", `la deducción ${index + 1}`),
        importe: amount(item, "Importe", `la deducción ${index + 1}`),
      })),
    };
    assign(nomina.deducciones, "totalOtrasDeducciones", optionalAmount(deducciones, "TotalOtrasDeducciones", where));
    assign(nomina.deducciones, "totalImpuestosRetenidos", optionalAmount(deducciones, "TotalImpuestosRetenidos", where));
  }

  const otrosPagos = child(element, ns, "OtrosPagos");
  if (otrosPagos) {
    nomina.otrosPagos = children(otrosPagos, ns, "OtroPago").map((item, index) => {
      const pago: NominaOtroPago = {
        tipo: required(item, "TipoOtroPago", `otro pago ${index + 1}`),
        clave: required(item, "Clave", `otro pago ${index + 1}`),
        concepto: required(item, "Concepto", `otro pago ${index + 1}`),
        importe: amount(item, "Importe", `otro pago ${index + 1}`),
      };
      const subsidio = child(item, ns, "SubsidioAlEmpleo");
      if (subsidio) assign(pago, "subsidioCausado", optionalAmount(subsidio, "SubsidioCausado", where));
      return pago;
    });
  }

  return nomina;
}

function readPagos(element: XmlElement, ns: string): Cfdi["pagos"] {
  const where = "el complemento de pagos";
  const result: NonNullable<Cfdi["pagos"]> = { version: required(element, "Version", where), pagos: [] };
  const totales = child(element, ns, "Totales");
  if (totales) assign(result, "montoTotalPagos", optionalAmount(totales, "MontoTotalPagos", where));

  result.pagos = children(element, ns, "Pago").map((item, index) => {
    const at = `el pago ${index + 1}`;
    const pago: CfdiPago = {
      fechaPago: required(item, "FechaPago", at),
      formaDePagoP: required(item, "FormaDePagoP", at),
      monedaP: required(item, "MonedaP", at),
      monto: amount(item, "Monto", at),
      documentos: children(item, ns, "DoctoRelacionado").map((doc, docIndex) => {
        const docAt = `el documento relacionado ${docIndex + 1} del pago ${index + 1}`;
        const documento: PagoDocumento = { idDocumento: required(doc, "IdDocumento", docAt) };
        assign(documento, "serie", optional(doc, "Serie"));
        assign(documento, "folio", optional(doc, "Folio"));
        assign(documento, "monedaDR", optional(doc, "MonedaDR"));
        assign(documento, "numParcialidad", optional(doc, "NumParcialidad"));
        assign(documento, "impSaldoAnt", optionalAmount(doc, "ImpSaldoAnt", docAt));
        assign(documento, "impPagado", optionalAmount(doc, "ImpPagado", docAt));
        assign(documento, "impSaldoInsoluto", optionalAmount(doc, "ImpSaldoInsoluto", docAt));
        return documento;
      }),
    };
    assign(pago, "tipoCambioP", optional(item, "TipoCambioP"));
    assign(pago, "numOperacion", optional(item, "NumOperacion"));
    assign(pago, "rfcEmisorCtaOrd", optional(item, "RfcEmisorCtaOrd"));
    assign(pago, "ctaOrdenante", optional(item, "CtaOrdenante"));
    assign(pago, "rfcEmisorCtaBen", optional(item, "RfcEmisorCtaBen"));
    assign(pago, "ctaBeneficiario", optional(item, "CtaBeneficiario"));
    return pago;
  });
  return result;
}

/** Convierte el XML ya analizado en el modelo. Falla con un mensaje claro si no es un CFDI 3.3 o 4.0. */
export function readCfdi(root: XmlElement): Cfdi {
  if (root.name !== "Comprobante" || (root.ns !== NS.cfdi3 && root.ns !== NS.cfdi4)) {
    throw invalid("El archivo es XML pero no es un CFDI del SAT (no empieza con cfdi:Comprobante).");
  }
  const ns = root.ns;
  const version = root.attrs.Version ?? root.attrs.version;
  if (version !== "3.3" && version !== "4.0") {
    throw invalid(
      version === "3.2"
        ? "Es un CFDI 3.2, un formato que el SAT dejó de aceptar en 2018. Solo se admiten 3.3 y 4.0."
        : `Versión de CFDI no compatible (${version ?? "desconocida"}). Solo se admiten 3.3 y 4.0.`,
    );
  }
  if ((version === "4.0") !== (ns === NS.cfdi4)) throw invalid("La versión del CFDI no coincide con su espacio de nombres.");

  const emisor = child(root, ns, "Emisor");
  const receptor = child(root, ns, "Receptor");
  if (!emisor) throw invalid("El CFDI no tiene el nodo Emisor.");
  if (!receptor) throw invalid("El CFDI no tiene el nodo Receptor.");

  const cfdi: Cfdi = {
    version,
    fecha: required(root, "Fecha", "el comprobante"),
    subTotal: amount(root, "SubTotal", "el comprobante"),
    moneda: required(root, "Moneda", "el comprobante"),
    total: amount(root, "Total", "el comprobante"),
    tipoDeComprobante: required(root, "TipoDeComprobante", "el comprobante"),
    lugarExpedicion: required(root, "LugarExpedicion", "el comprobante"),
    emisor: { rfc: required(emisor, "Rfc", "el Emisor") },
    receptor: { rfc: required(receptor, "Rfc", "el Receptor") },
    relacionados: [],
    conceptos: [],
    impuestos: null,
    timbre: null,
    nomina: null,
    pagos: null,
  };
  assign(cfdi, "serie", optional(root, "Serie"));
  assign(cfdi, "folio", optional(root, "Folio"));
  assign(cfdi, "sello", optional(root, "Sello"));
  assign(cfdi, "noCertificado", optional(root, "NoCertificado"));
  assign(cfdi, "formaPago", optional(root, "FormaPago"));
  assign(cfdi, "metodoPago", optional(root, "MetodoPago"));
  assign(cfdi, "condicionesDePago", optional(root, "CondicionesDePago"));
  assign(cfdi, "descuento", optionalAmount(root, "Descuento", "el comprobante"));
  assign(cfdi, "tipoCambio", optional(root, "TipoCambio"));
  assign(cfdi, "exportacion", optional(root, "Exportacion"));

  assign(cfdi.emisor, "nombre", optional(emisor, "Nombre"));
  assign(cfdi.emisor, "regimenFiscal", optional(emisor, "RegimenFiscal"));
  assign(cfdi.receptor, "nombre", optional(receptor, "Nombre"));
  assign(cfdi.receptor, "domicilioFiscal", optional(receptor, "DomicilioFiscalReceptor"));
  assign(cfdi.receptor, "regimenFiscal", optional(receptor, "RegimenFiscalReceptor"));
  assign(cfdi.receptor, "usoCFDI", optional(receptor, "UsoCFDI"));
  assign(cfdi.receptor, "residenciaFiscal", optional(receptor, "ResidenciaFiscal"));
  assign(cfdi.receptor, "numRegIdTrib", optional(receptor, "NumRegIdTrib"));

  // 4.0 permite varios nodos CfdiRelacionados; 3.3 solo uno. Se leen todos.
  for (const group of children(root, ns, "CfdiRelacionados")) {
    cfdi.relacionados.push({
      tipoRelacion: required(group, "TipoRelacion", "CfdiRelacionados"),
      uuids: children(group, ns, "CfdiRelacionado").map((item) => required(item, "UUID", "CfdiRelacionado").toUpperCase()),
    });
  }

  const conceptos = child(root, ns, "Conceptos");
  if (!conceptos) throw invalid("El CFDI no tiene el nodo Conceptos.");
  cfdi.conceptos = children(conceptos, ns, "Concepto").map(readConcepto);
  if (cfdi.conceptos.length === 0) throw invalid("El CFDI no tiene ningún concepto.");

  const impuestos = child(root, ns, "Impuestos");
  if (impuestos) {
    cfdi.impuestos = {
      traslados: children(child(impuestos, ns, "Traslados") ?? impuestos, ns, "Traslado").map(readTax),
      retenciones: children(child(impuestos, ns, "Retenciones") ?? impuestos, ns, "Retencion").map(readTax),
    };
    assign(cfdi.impuestos, "totalTrasladados", optionalAmount(impuestos, "TotalImpuestosTrasladados", "Impuestos"));
    assign(cfdi.impuestos, "totalRetenidos", optionalAmount(impuestos, "TotalImpuestosRetenidos", "Impuestos"));
  }

  const complemento = child(root, ns, "Complemento");
  if (complemento) {
    const timbre = child(complemento, NS.tfd, "TimbreFiscalDigital");
    if (timbre) cfdi.timbre = readTimbre(timbre);
    const nomina = child(complemento, NS.nomina12, "Nomina");
    if (nomina) cfdi.nomina = readNomina(nomina);
    const pagos20 = child(complemento, NS.pagos20, "Pagos");
    const pagos10 = child(complemento, NS.pagos10, "Pagos");
    if (pagos20) cfdi.pagos = readPagos(pagos20, NS.pagos20);
    else if (pagos10) cfdi.pagos = readPagos(pagos10, NS.pagos10);
  }

  return cfdi;
}

/**
 * Cadena original del complemento de certificación digital del SAT (TFD 1.1), tal como la define la
 * hoja de estilo cadenaoriginal_TFD_1_1.xslt: la Leyenda solo aparece si existe.
 */
export function timbreCadenaOriginal(timbre: CfdiTimbre): string {
  const leyenda = timbre.leyenda ? `${timbre.leyenda}|` : "";
  return `||${timbre.version}|${timbre.uuid}|${timbre.fechaTimbrado}|${timbre.rfcProvCertif}|${leyenda}${timbre.selloCFD}|${timbre.noCertificadoSAT}||`;
}

/**
 * URL del código QR (Anexo 20): folio fiscal, RFC emisor y receptor, total y los últimos ocho
 * caracteres del sello del emisor. Un «&» en el RFC (razón social con «&») rompería la consulta.
 */
export function satVerificationUrl(cfdi: Cfdi, timbre: CfdiTimbre): string {
  const rfc = (value: string) => value.replaceAll("&", "%26");
  const sello = cfdi.sello ?? timbre.selloCFD;
  return `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${timbre.uuid}&re=${rfc(cfdi.emisor.rfc)}&rr=${rfc(cfdi.receptor.rfc)}&tt=${cfdi.total}&fe=${sello.slice(-8)}`;
}
