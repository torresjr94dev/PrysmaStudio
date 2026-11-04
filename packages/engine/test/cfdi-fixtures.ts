import type { InputFile } from "../src/protocol.ts";

/** Base64 pseudoaleatorio y determinista con pinta de sello digital. */
export function fakeBase64(seed: number, length = 344): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let state = seed >>> 0 || 1;
  let out = "";
  while (out.length < length - 2) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out += alphabet[(state >>> 0) % 64];
  }
  return `${out}==`;
}

export const UUID = "7A2B1C3D-4E5F-4A6B-8C9D-0E1F2A3B4C5D";
export const SELLO_CFD = fakeBase64(7);
export const SELLO_SAT = fakeBase64(11);

function timbre(uuid = UUID): string {
  return `<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xsi:schemaLocation="http://www.sat.gob.mx/TimbreFiscalDigital http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" Version="1.1" UUID="${uuid}" FechaTimbrado="2026-03-15T10:22:40" RfcProvCertif="SPR190613I52" SelloCFD="${SELLO_CFD}" NoCertificadoSAT="30001000000500003456" SelloSAT="${SELLO_SAT}"/>`;
}

export function xmlInput(name: string, xml: string): InputFile {
  return { name, bytes: new TextEncoder().encode(xml).buffer as ArrayBuffer };
}

/** Factura 4.0 de ingreso con descuento, IVA trasladado y retenciones de ISR e IVA. */
export function invoice40(options: { timbrado?: boolean; conceptos?: number } = {}): string {
  const count = options.conceptos ?? 1;
  const conceptos = Array.from({ length: count }, (_, i) =>
    `<cfdi:Concepto ClaveProdServ="81111500" NoIdentificacion="SRV-${String(i + 1).padStart(2, "0")}" Cantidad="2" ClaveUnidad="E48" Unidad="Unidad de servicio" Descripcion="Desarrollo de software a la medida &amp; soporte — módulo ${i + 1} de facturación electrónica con pruebas automatizadas" ValorUnitario="500.00" Importe="1000.00" Descuento="50.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="950.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="152.00"/></cfdi:Traslados><cfdi:Retenciones><cfdi:Retencion Base="950.00" Impuesto="001" TipoFactor="Tasa" TasaOCuota="0.100000" Importe="95.00"/><cfdi:Retencion Base="950.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.106667" Importe="101.33"/></cfdi:Retenciones></cfdi:Impuestos>
    </cfdi:Concepto>`,
  ).join("\n");
  const subTotal = (1000 * count).toFixed(2);
  const descuento = (50 * count).toFixed(2);
  const iva = (152 * count).toFixed(2);
  const retenido = (196.33 * count).toFixed(2);
  const total = (905.67 * count).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Comprobante de prueba -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="A" Folio="1024" Fecha="2026-03-15T10:22:31" Sello="${SELLO_CFD}" FormaPago="03" NoCertificado="30001000000500003416" Certificado="${fakeBase64(3, 120)}" CondicionesDePago="Contado" SubTotal="${subTotal}" Descuento="${descuento}" Moneda="MXN" Total="${total}" TipoDeComprobante="I" Exportacion="01" MetodoPago="PUE" LugarExpedicion="06600">
  <cfdi:CfdiRelacionados TipoRelacion="04"><cfdi:CfdiRelacionado UUID="11111111-2222-4333-8444-555555555555"/></cfdi:CfdiRelacionados>
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="PÚBLICO EN GENERAL" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="616" UsoCFDI="S01"/>
  <cfdi:Conceptos>
    ${conceptos}
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosRetenidos="${retenido}" TotalImpuestosTrasladados="${iva}">
    <cfdi:Retenciones><cfdi:Retencion Impuesto="001" Importe="${(95 * count).toFixed(2)}"/><cfdi:Retencion Impuesto="002" Importe="${(101.33 * count).toFixed(2)}"/></cfdi:Retenciones>
    <cfdi:Traslados><cfdi:Traslado Base="${(950 * count).toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${iva}"/></cfdi:Traslados>
  </cfdi:Impuestos>
  ${options.timbrado === false ? "" : `<cfdi:Complemento>${timbre()}</cfdi:Complemento>`}
</cfdi:Comprobante>`;
}

/** Factura 3.3 mínima (espacio de nombres cfd/3, sin los atributos nuevos de 4.0). */
export function invoice33(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="3.3" Serie="B" Folio="7" Fecha="2021-11-02T08:15:00" Sello="${SELLO_CFD}" FormaPago="01" NoCertificado="30001000000400002434" Certificado="" SubTotal="100" Moneda="MXN" Total="116" TipoDeComprobante="I" MetodoPago="PUE" LugarExpedicion="64000">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Tienda de la esquina" RegimenFiscal="621"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="Público en general" UsoCFDI="P01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="50211503" Cantidad="1.5" ClaveUnidad="KGM" Unidad="Kilogramo" Descripcion="Tortillas" ValorUnitario="66.666667" Importe="100">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento>${timbre("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE")}</cfdi:Complemento>
</cfdi:Comprobante>`;
}

/** Recibo de nómina 1.2 quincenal con percepciones, deducciones y subsidio. */
export function payroll40(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:nomina12="http://www.sat.gob.mx/nomina12" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="4.0" Serie="NOM" Folio="77" Fecha="2026-01-31T12:00:00" Sello="${SELLO_CFD}" FormaPago="99" NoCertificado="30001000000500003416" Certificado="" SubTotal="12000.00" Descuento="2300.00" Moneda="MXN" Total="9700.00" TipoDeComprobante="N" Exportacion="01" MetodoPago="PUE" LugarExpedicion="44100">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="GOAM850101AB1" Nombre="MARÍA GÓMEZ ÁLVAREZ" DomicilioFiscalReceptor="44100" RegimenFiscalReceptor="605" UsoCFDI="CN01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111505" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago de nómina" ValorUnitario="12000.00" Importe="12000.00" Descuento="2300.00" ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <nomina12:Nomina Version="1.2" TipoNomina="O" FechaPago="2026-01-31" FechaInicialPago="2026-01-16" FechaFinalPago="2026-01-31" NumDiasPagados="15" TotalPercepciones="12000.00" TotalDeducciones="2300.00" TotalOtrosPagos="0.00">
      <nomina12:Emisor RegistroPatronal="A1234567890"/>
      <nomina12:Receptor Curp="GOAM850101MJCMLR09" NumSeguridadSocial="12345678901" FechaInicioRelLaboral="2020-03-01" Antigüedad="P308W" TipoContrato="01" Sindicalizado="No" TipoJornada="01" TipoRegimen="02" NumEmpleado="0042" Departamento="Tecnología" Puesto="Desarrolladora" RiesgoPuesto="1" PeriodicidadPago="04" Banco="012" CuentaBancaria="012345678901234567" SalarioBaseCotApor="800.00" SalarioDiarioIntegrado="836.00" ClaveEntFed="JAL"/>
      <nomina12:Percepciones TotalSueldos="12000.00" TotalGravado="11500.00" TotalExento="500.00">
        <nomina12:Percepcion TipoPercepcion="001" Clave="P001" Concepto="Sueldo" ImporteGravado="11500.00" ImporteExento="0.00"/>
        <nomina12:Percepcion TipoPercepcion="029" Clave="P029" Concepto="Vales de despensa" ImporteGravado="0.00" ImporteExento="500.00"/>
      </nomina12:Percepciones>
      <nomina12:Deducciones TotalOtrasDeducciones="300.00" TotalImpuestosRetenidos="2000.00">
        <nomina12:Deduccion TipoDeduccion="002" Clave="D002" Concepto="ISR" Importe="2000.00"/>
        <nomina12:Deduccion TipoDeduccion="001" Clave="D001" Concepto="IMSS" Importe="300.00"/>
      </nomina12:Deducciones>
      <nomina12:OtrosPagos>
        <nomina12:OtroPago TipoOtroPago="002" Clave="O002" Concepto="Subsidio para el empleo" Importe="0.00"><nomina12:SubsidioAlEmpleo SubsidioCausado="0.00"/></nomina12:OtroPago>
      </nomina12:OtrosPagos>
    </nomina12:Nomina>
    ${timbre("0F0F0F0F-1111-4222-8333-444444444444")}
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

/** Complemento de recepción de pagos 2.0 que liquida la factura A-1024. */
export function payment40(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="4.0" Serie="P" Folio="3" Fecha="2026-03-20T09:05:00" Sello="${SELLO_CFD}" NoCertificado="30001000000500003416" Certificado="" SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P" Exportacion="01" LugarExpedicion="06600">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="PÚBLICO EN GENERAL" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="616" UsoCFDI="CP01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Totales MontoTotalPagos="905.67"/>
      <pago20:Pago FechaPago="2026-03-20T09:00:00" FormaDePagoP="03" MonedaP="MXN" Monto="905.67" NumOperacion="REF-2026-77" RfcEmisorCtaOrd="BMI9704113PA" CtaOrdenante="012345678901234567" RfcEmisorCtaBen="BBA830831LJ2" CtaBeneficiario="098765432109876543">
        <pago20:DoctoRelacionado IdDocumento="${UUID}" Serie="A" Folio="1024" MonedaDR="MXN" EquivalenciaDR="1" NumParcialidad="1" ImpSaldoAnt="905.67" ImpPagado="905.67" ImpSaldoInsoluto="0.00" ObjetoImpDR="02"/>
      </pago20:Pago>
    </pago20:Pagos>
    ${timbre("ABCDEF01-2345-4678-89AB-CDEF01234567")}
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}
