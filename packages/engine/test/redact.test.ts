import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import { runOp, runScan } from "../src/engine.ts";
import { EngineError } from "../src/errors.ts";
import { detect, normalizeTerms } from "../src/ops/redact.ts";
import type { EngineErrorCode, InputFile, RedactOptions } from "../src/protocol.ts";
import { noProgress, openOutput, pageText } from "./fixtures.ts";

const ALL: RedactOptions = { categories: ["curp", "rfc", "nss", "email", "phone"], terms: [] };

function hits(text: string, options: RedactOptions = ALL) {
  return detect(text, options, normalizeTerms(options.terms)).map((hit) => [hit.category, text.slice(hit.start, hit.end)]);
}

/** PDF con líneas de texto Helvetica (WinAnsi) por página, metadatos de autor y giro opcional. */
function linesPdf(pages: string[][], rotate: 0 | 90 | 180 | 270 = 0, name = "expediente.pdf"): InputFile {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  for (const lines of pages) {
    const content = lines.length === 0 ? "" : `BT /F1 12 Tf 72 720 Td ${lines.map((line) => `(${line}) Tj 0 -20 Td`).join(" ")} ET`;
    doc.insertPage(-1, doc.addPage([0, 0, 612, 792], rotate, { Font: { F1: font } }, content));
  }
  const info = doc.newDictionary();
  info.put("Author", doc.newString("Maria Gomez"));
  info.put("Title", doc.newString("Expediente"));
  doc.getTrailer().put("Info", doc.addObject(info));
  const buffer = doc.saveToBuffer("compress");
  try {
    return { name, bytes: buffer.asUint8Array().slice().buffer };
  } finally {
    buffer.destroy();
    doc.destroy();
  }
}

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

/** Color en el centro de un rectángulo (espacio de página girada), renderizando a escala 1. */
function colorAt(doc: mupdf.PDFDocument, pageIndex: number, rect: { x: number; y: number; width: number; height: number }): [number, number, number] {
  const page = doc.loadPage(pageIndex);
  const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const x = Math.floor(rect.x + rect.width / 2);
  const y = Math.floor(rect.y + rect.height / 2);
  const offset = y * pixmap.getStride() + x * pixmap.getNumberOfComponents();
  const pixels = pixmap.getPixels();
  const color: [number, number, number] = [pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0];
  pixmap.destroy();
  page.destroy();
  return color;
}

describe("detect", () => {
  it("reconoce CURP, RFC de persona física y moral, NSS, correo y teléfono", () => {
    expect(hits("CURP GOAM850101MJCMLR09 RFC GOAM850101AB1 y EKU9003173C9")).toEqual([
      ["curp", "GOAM850101MJCMLR09"],
      ["rfc", "GOAM850101AB1"],
      ["rfc", "EKU9003173C9"],
    ]);
    expect(hits("NSS 12345678903 / 12 34 56 7890 3")).toEqual([
      ["nss", "12345678903"],
      ["nss", "12 34 56 7890 3"],
    ]);
    expect(hits("escribe a maria.gomez@ejemplo.com.mx hoy")).toEqual([["email", "maria.gomez@ejemplo.com.mx"]]);
    expect(hits("Tel. 55 1234 5678, +52 33 9876-5432 y (81) 1234 5678")).toEqual([
      ["phone", "55 1234 5678"],
      ["phone", "+52 33 9876-5432"],
      ["phone", "(81) 1234 5678"],
    ]);
  });

  it("descarta lo que parece pero no es: fechas imposibles, RFC genéricos, NSS sin dígito válido, teléfonos cortos", () => {
    expect(hits("GOAM851301AB1 GOAM850132AB1 XAXX010101000 XEXX010101000")).toEqual([]);
    expect(hits("12345678904")).toEqual([]);
    expect(hits("folio 1234 5678 y 123456789012")).toEqual([]);
    expect(hits("GOAM850101AB1X")).toEqual([]);
  });

  it("solo busca las categorías pedidas y no duplica un CURP como RFC", () => {
    expect(hits("GOAM850101MJCMLR09 GOAM850101AB1", { categories: ["rfc"], terms: [] })).toEqual([["rfc", "GOAM850101AB1"]]);
    expect(hits("GOAM850101MJCMLR09", { categories: ["curp", "rfc"], terms: [] })).toEqual([["curp", "GOAM850101MJCMLR09"]]);
  });

  it("encuentra términos propios sin distinguir mayúsculas ni acentos y descarta los demasiado cortos", () => {
    const options: RedactOptions = { categories: [], terms: ["maria gomez", "ab", " Calle   Luna "] };
    expect(normalizeTerms(options.terms)).toEqual(["maria gomez", "calle luna"]);
    expect(hits("Nombre: MARÍA GÓMEZ, Calle Luna 5", options)).toEqual([
      ["custom", "MARÍA GÓMEZ"],
      ["custom", "Calle Luna"],
    ]);
  });
});

describe("scan", () => {
  it("localiza coincidencias por página con rectángulos dentro de la hoja y cuenta las páginas sin texto", () => {
    const pdf = linesPdf([["Nombre: Maria Gomez", "CURP: GOAM850101MJCMLR09"], [], ["RFC GOAM850101AB1 y correo ana@ejemplo.mx"]]);
    const scan = runScan(pdf, { categories: ["curp", "rfc"], terms: ["maria gomez"] });
    expect(scan.pageCount).toBe(3);
    expect(scan.textlessPages).toBe(1);
    expect(scan.matches.map((match) => [match.page, match.category, match.text])).toEqual([
      [0, "custom", "Maria Gomez"],
      [0, "curp", "GOAM850101MJCMLR09"],
      [2, "rfc", "GOAM850101AB1"],
    ]);
    for (const match of scan.matches) {
      const [rect] = match.rects;
      if (!rect) throw new Error("sin rectángulo");
      expect(rect.x).toBeGreaterThan(60);
      expect(rect.y).toBeGreaterThan(50);
      expect(rect.x + rect.width).toBeLessThan(612);
      expect(rect.y + rect.height).toBeLessThan(120);
      expect(rect.height).toBeGreaterThan(8);
    }
    expect(new Set(scan.matches.map((match) => match.id)).size).toBe(3);
  });

  it("rechaza PDF cifrados o dañados como el resto de operaciones", () => {
    expectCode(() => runScan({ name: "x.pdf", bytes: new Uint8Array([1, 2, 3]).buffer }, ALL), "pdf.corrupt");
  });
});

describe("redact", () => {
  it.each([0, 90] as const)("elimina solo lo seleccionado, deja el resto y pinta la zona de negro (giro %i)", (rotate) => {
    const pdf = linesPdf([["Nombre: Maria Gomez", "CURP: GOAM850101MJCMLR09 RFC: GOAM850101AB1"]], rotate);
    const scan = runScan(pdf, ALL);
    const curp = scan.matches.find((match) => match.category === "curp");
    if (!curp) throw new Error("no se encontró el CURP");
    const { outputs } = runOp({ op: "redact", input: linesPdf([["Nombre: Maria Gomez", "CURP: GOAM850101MJCMLR09 RFC: GOAM850101AB1"]], rotate), areas: [{ page: 0, rects: curp.rects }], stripMetadata: false }, noProgress);
    expect(outputs[0]?.name).toBe("expediente-tapado.pdf");
    const doc = openOutput(outputs[0]?.bytes ?? new ArrayBuffer(0));
    const text = pageText(doc, 0);
    expect(text).not.toContain("GOAM850101MJCMLR09");
    expect(text).toContain("Maria Gomez");
    expect(text).toContain("GOAM850101AB1");
    const [rect] = curp.rects;
    if (!rect) throw new Error("sin rectángulo");
    expect(colorAt(doc, 0, rect)).toEqual([0, 0, 0]);
    // Lo tapado no sobrevive como anotación ni vuelve a encontrarse al escanear el resultado.
    expect(runScan({ name: "r.pdf", bytes: outputs[0]?.bytes ?? new ArrayBuffer(0) }, ALL).matches.map((match) => match.category)).toEqual(["rfc"]);
    expect(doc.getMetaData("info:Author")).toBe("Maria Gomez");
  });

  it("quita autor y título cuando se pide", () => {
    const scan = runScan(linesPdf([["CURP GOAM850101MJCMLR09"]]), ALL);
    const { outputs } = runOp({ op: "redact", input: linesPdf([["CURP GOAM850101MJCMLR09"]]), areas: scan.matches.map((match) => ({ page: match.page, rects: match.rects })), stripMetadata: true }, noProgress);
    const doc = openOutput(outputs[0]?.bytes ?? new ArrayBuffer(0));
    expect(doc.getMetaData("info:Author")).toBeUndefined();
    expect(doc.getMetaData("info:Title")).toBeUndefined();
  });

  it("valida las zonas: página inexistente, tamaño nulo o ninguna zona", () => {
    const rect = { x: 10, y: 10, width: 50, height: 10 };
    expectCode(() => runOp({ op: "redact", input: linesPdf([["x"]]), areas: [{ page: 3, rects: [rect] }], stripMetadata: false }, noProgress), "input.invalid", /página 4/);
    expectCode(() => runOp({ op: "redact", input: linesPdf([["x"]]), areas: [{ page: 0, rects: [{ ...rect, width: 0 }] }], stripMetadata: false }, noProgress), "input.invalid", /tamaño/);
    expectCode(() => runOp({ op: "redact", input: linesPdf([["x"]]), areas: [], stripMetadata: false }, noProgress), "input.invalid", /ninguna zona/);
  });
});
