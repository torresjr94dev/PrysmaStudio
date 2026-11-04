import { describe, expect, it } from "vitest";
import { readCfdi, satVerificationUrl, timbreCadenaOriginal } from "../src/cfdi/model.ts";
import { amountInWords, integerToWords } from "../src/cfdi/words.ts";
import { decodeXmlBytes, parseXml } from "../src/cfdi/xml.ts";
import { runOp } from "../src/engine.ts";
import { EngineError } from "../src/errors.ts";
import type { EngineErrorCode } from "../src/protocol.ts";
import { SELLO_CFD, UUID, invoice33, invoice40, payment40, payroll40, xmlInput } from "./cfdi-fixtures.ts";
import { noProgress, openOutput, pageText } from "./fixtures.ts";

function expectCode(fn: () => unknown, code: EngineErrorCode, detail?: RegExp): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    if (detail) expect((error as EngineError).detail).toMatch(detail);
    return;
  }
  throw new Error(`Se esperaba un EngineError con código ${code}`);
}

function parse(xml: string) {
  return readCfdi(parseXml(xml));
}

function render(name: string, xml: string) {
  const result = runOp({ op: "cfdiToPdf", inputs: [xmlInput(name, xml)] }, noProgress);
  expect(result.outputs).toHaveLength(1);
  const bytes = result.outputs[0]?.bytes;
  if (!bytes) throw new Error("sin salida");
  const doc = openOutput(bytes);
  const pages = Array.from({ length: doc.countPages() }, (_, i) => pageText(doc, i));
  return { result, doc, pages, text: pages.join("\n") };
}

describe("parseXml", () => {
  it("resuelve espacios de nombres por URI, no por prefijo", () => {
    const root = parseXml('<a:Comprobante xmlns:a="http://www.sat.gob.mx/cfd/4" Version="4.0"><a:Emisor Rfc="X"/></a:Comprobante>');
    expect(root.ns).toBe("http://www.sat.gob.mx/cfd/4");
    expect(root.name).toBe("Comprobante");
    expect(root.children[0]?.attrs.Rfc).toBe("X");
  });

  it("decodifica entidades y referencias numéricas, e ignora comentarios, CDATA e instrucciones", () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><r a="A &amp; B &lt;&gt; &#241; &#xF1; &quot;&apos;"><![CDATA[<x>]]><?pi x?></r>');
    expect(root.attrs.a).toBe("A & B <> ñ ñ \"'");
    expect(root.children).toHaveLength(0);
  });

  it.each([
    ["<!DOCTYPE r [<!ENTITY x 'y'>]><r/>", /DOCTYPE/],
    ["<r><a></r>", /cierre/],
    ["<r a=1/>", /comillas/],
    ["<r a='1' a='2'/>", /repetido/],
    ["<r xmlns:p='u'><q:a/></r>", /prefijo/],
    ["<r/><r/>", /raíz/],
    ["<r a='&bogus;'/>", /entidad/],
    ["", /ningún elemento/],
  ])("rechaza %s", (xml, reason) => {
    expectCode(() => parseXml(xml), "input.invalid", reason);
  });

  it("decodifica según la declaración de codificación", () => {
    const latin1 = Uint8Array.from([...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><r a="'), 0xf1, ...new TextEncoder().encode('"/>')]);
    expect(parseXml(decodeXmlBytes(latin1.buffer as ArrayBuffer)).attrs.a).toBe("ñ");
    const broken = Uint8Array.from([0x3c, 0x72, 0x20, 0x61, 0x3d, 0x22, 0xff, 0x22, 0x2f, 0x3e]);
    expectCode(() => decodeXmlBytes(broken.buffer as ArrayBuffer), "input.invalid", /UTF-8/);
  });
});

describe("readCfdi", () => {
  it("lee una factura 4.0 completa", () => {
    const cfdi = parse(invoice40());
    expect(cfdi.version).toBe("4.0");
    expect(cfdi.emisor).toEqual({ rfc: "EKU9003173C9", nombre: "ESCUELA KEMPER URGATE", regimenFiscal: "601" });
    expect(cfdi.receptor.usoCFDI).toBe("S01");
    expect(cfdi.conceptos[0]?.descripcion).toContain("& soporte");
    expect(cfdi.impuestos?.traslados[0]).toEqual({ base: "950.00", impuesto: "002", tipoFactor: "Tasa", tasaOCuota: "0.160000", importe: "152.00" });
    expect(cfdi.impuestos?.retenciones.map((tax) => tax.impuesto)).toEqual(["001", "002"]);
    expect(cfdi.relacionados).toEqual([{ tipoRelacion: "04", uuids: ["11111111-2222-4333-8444-555555555555"] }]);
    expect(cfdi.timbre?.uuid).toBe(UUID);
  });

  it("lee una factura 3.3 y los complementos de nómina y pagos", () => {
    expect(parse(invoice33()).version).toBe("3.3");
    const nomina = parse(payroll40()).nomina;
    expect(nomina?.receptor.antiguedad).toBe("P308W");
    expect(nomina?.percepciones?.items).toHaveLength(2);
    expect(nomina?.otrosPagos[0]?.subsidioCausado).toBe("0.00");
    const pagos = parse(payment40()).pagos;
    expect(pagos?.pagos[0]?.documentos[0]?.idDocumento).toBe(UUID);
  });

  it("construye la cadena original del timbre y la URL del QR", () => {
    const cfdi = parse(invoice40());
    const timbre = cfdi.timbre;
    if (!timbre) throw new Error("sin timbre");
    expect(timbreCadenaOriginal(timbre)).toBe(`||1.1|${UUID}|2026-03-15T10:22:40|SPR190613I52|${SELLO_CFD}|30001000000500003456||`);
    expect(satVerificationUrl(cfdi, timbre)).toBe(
      `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${UUID}&re=EKU9003173C9&rr=XAXX010101000&tt=905.67&fe=${SELLO_CFD.slice(-8)}`,
    );
  });

  it.each([
    ["<r/>", /no es un CFDI/],
    ['<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/3" version="3.2"/>', /3\.2/],
    ['<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="3.3"/>', /no coincide/],
    [invoice40().replace('Total="905.67"', 'Total="abc"'), /Total/],
    [invoice40().replace(/<cfdi:Emisor[^>]*\/>/, ""), /Emisor/],
    [invoice40().replace(`UUID="${UUID}"`, 'UUID="no-es-uuid"'), /UUID/],
  ])("rechaza CFDI inválidos (%#)", (xml, reason) => {
    expectCode(() => parse(xml), "input.invalid", reason);
  });
});

describe("importe con letra", () => {
  it.each([
    [0, "CERO"],
    [1, "UN"],
    [16, "DIECISÉIS"],
    [21, "VEINTIÚN"],
    [100, "CIEN"],
    [101, "CIENTO UN"],
    [999, "NOVECIENTOS NOVENTA Y NUEVE"],
    [1000, "MIL"],
    [1160, "MIL CIENTO SESENTA"],
    [21000, "VEINTIÚN MIL"],
    [1_000_000, "UN MILLÓN"],
    [2_500_000, "DOS MILLONES QUINIENTOS MIL"],
  ])("%i → %s", (value, words) => {
    expect(integerToWords(value)).toBe(words);
  });

  it("escribe pesos y centavos al estilo mexicano", () => {
    expect(amountInWords("905.67", "MXN")).toBe("NOVECIENTOS CINCO PESOS 67/100 M.N.");
    expect(amountInWords("1.00", "MXN")).toBe("UN PESO 00/100 M.N.");
    expect(amountInWords("1000000", "MXN")).toBe("UN MILLÓN DE PESOS 00/100 M.N.");
    expect(amountInWords("1000100.5", "MXN")).toBe("UN MILLÓN CIEN PESOS 50/100 M.N.");
    expect(amountInWords("12.999", "USD")).toBe("TRECE DÓLARES 00/100 USD");
    expect(amountInWords("0", "XXX")).toBe("CERO XXX 00/100 XXX");
  });
});

describe("cfdiToPdf", () => {
  it("genera la representación impresa con los datos fiscales, el importe con letra y el pie legal", () => {
    const { result, pages, text } = render("factura.xml", invoice40());
    expect(result.outputs[0]?.name).toBe("factura.pdf");
    expect(result.warnings).toEqual([]);
    expect(pages).toHaveLength(1);
    for (const needle of [
      "Factura",
      UUID,
      "EKU9003173C9",
      "ESCUELA KEMPER URGATE",
      "PÚBLICO EN GENERAL",
      "601 - General de Ley Personas Morales",
      "03 - Transferencia electrónica de fondos",
      "Desarrollo de software a la medida & soporte",
      "$905.67",
      "Retención ISR",
      "Retención IVA",
      "NOVECIENTOS CINCO PESOS 67/100 M.N.",
      "04 - Sustitución de los CFDI previos",
      "SPR190613I52",
      "Este documento es una representación impresa de un CFDI",
      "Página 1 de 1",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("pagina los conceptos repitiendo el encabezado y numera las páginas", () => {
    const { pages, text } = render("larga.xml", invoice40({ conceptos: 60 }));
    expect(pages.length).toBeGreaterThan(1);
    expect(text).toContain(`Página ${pages.length} de ${pages.length}`);
    // Todas las páginas con conceptos repiten el encabezado; la última puede ser solo totales y timbre.
    for (const page of pages.slice(0, -1)) expect(page).toContain("Descripción");
    expect(pages.at(-1)).toContain("CADENA ORIGINAL");
  });

  it("avisa cuando el CFDI no está timbrado y no pone QR", () => {
    const { result, text } = render("borrador.xml", invoice40({ timbrado: false }));
    expect(result.warnings[0]).toMatch(/no está timbrado/);
    expect(text).toContain("SIN TIMBRAR");
    expect(text).toContain("no tiene Timbre Fiscal Digital");
  });

  it("imprime nómina 1.2 con percepciones, deducciones y datos laborales", () => {
    const { text } = render("nomina.xml", payroll40());
    for (const needle of ["Recibo de nómina", "GOAM850101MJCMLR09", "Vales de despensa", "001 - Seguridad social", "Neto a recibir", "$9,700.00", "308 semanas", "04 - Quincenal"]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("imprime el complemento de pagos 2.0 con los documentos relacionados", () => {
    const { text } = render("pago.xml", payment40());
    for (const needle of ["Complemento de pago", "RECEPCIÓN DE PAGOS 2.0", "REF-2026-77", UUID, "A 1024", "$905.67"]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("imprime una factura 3.3 y acepta varios archivos a la vez", () => {
    const result = runOp({ op: "cfdiToPdf", inputs: [xmlInput("a.xml", invoice33()), xmlInput("b.xml", invoice40())] }, noProgress);
    expect(result.outputs.map((file) => file.name)).toEqual(["a.pdf", "b.pdf"]);
    const first = result.outputs[0];
    if (!first) throw new Error("sin salida");
    const doc = openOutput(first.bytes);
    expect(pageText(doc, 0)).toContain("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
    expect(pageText(doc, 0)).toContain("621 - Incorporación Fiscal");
  });

  it("explica con el nombre del archivo por qué no se pudo convertir", () => {
    expectCode(() => runOp({ op: "cfdiToPdf", inputs: [xmlInput("foto.xml", "no soy xml")] }, noProgress), "input.invalid", /«foto\.xml»/);
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 ...").buffer as ArrayBuffer;
    expectCode(() => runOp({ op: "cfdiToPdf", inputs: [{ name: "x.pdf", bytes: pdfBytes }] }, noProgress), "input.invalid", /«x\.pdf»/);
  });
});
