import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import { runOp } from "../src/engine.ts";
import type { InputFile, SignStamp } from "../src/protocol.ts";
import { PASSWORD, expectCode, fixture, hasOpenssl, opensslVerify } from "./efirma-helpers.ts";

const noProgress = () => undefined;

function makePdf(pages: number, options: { rotate?: number; encrypt?: boolean } = {}): InputFile {
  const doc = new mupdf.PDFDocument();
  for (let i = 0; i < pages; i++) {
    doc.insertPage(-1, doc.addPage([0, 0, 612, 792], (options.rotate ?? 0) as mupdf.Rotate, { Font: { F1: doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin") } }, `BT /F1 24 Tf 72 700 Td (Pagina ${i + 1}) Tj ET`));
  }
  const bytes = doc.saveToBuffer(options.encrypt ? "encrypt=aes-256,user-password=abc,owner-password=abc" : "compress").asUint8Array().slice().buffer;
  doc.destroy();
  return { name: "contrato.pdf", bytes };
}

interface Signature {
  byteRange: [number, number, number, number];
  cms: Uint8Array;
  signed: Uint8Array;
  dictionary: string;
}

/** Firmas del PDF (en orden de aparición) con el CMS recortado a su longitud DER real. */
function signaturesOf(bytes: Uint8Array): Signature[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const out: Signature[] = [];
  for (const match of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const byteRange = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as [number, number, number, number];
    const objectStart = text.lastIndexOf(" obj", match.index);
    const objectEnd = text.indexOf("endobj", match.index);
    const dictionary = text.slice(objectStart, objectEnd);
    const contents = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(dictionary);
    if (!contents) throw new Error("Firma sin /Contents");
    const hex = contents[1] ?? "";
    const raw = Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
    // Longitud DER del SEQUENCE exterior (forma larga): recorta los ceros de relleno.
    const lengthBytes = (raw[1] ?? 0) & 0x7f;
    let length = 0;
    for (let i = 0; i < lengthBytes; i++) length = length * 256 + (raw[2 + i] ?? 0);
    const cms = raw.subarray(0, 2 + lengthBytes + length);
    const signed = new Uint8Array(byteRange[1] + byteRange[3]);
    signed.set(bytes.subarray(byteRange[0], byteRange[0] + byteRange[1]), 0);
    signed.set(bytes.subarray(byteRange[2], byteRange[2] + byteRange[3]), byteRange[1]);
    out.push({ byteRange, cms, signed, dictionary });
  }
  return out;
}

function signOp(input: InputFile, overrides: { certificate?: string; privateKey?: string; password?: string; reason?: string; stamp?: SignStamp | null } = {}) {
  return runOp(
    {
      op: "sign",
      input,
      certificate: { name: "fiel.cer", bytes: fixture(overrides.certificate ?? "fiel.cer").buffer },
      privateKey: { name: "fiel.key", bytes: fixture(overrides.privateKey ?? "fiel.key").buffer },
      password: overrides.password ?? PASSWORD,
      reason: overrides.reason ?? "",
      stamp: overrides.stamp === undefined ? { page: "last", corner: "bottom-right" } : overrides.stamp,
    },
    noProgress,
  );
}

/** Contenido del sello (stream de apariencia del widget) de una página, o "" si no hay sello. */
function stampOf(bytes: ArrayBuffer, index: number): string {
  const doc = new mupdf.PDFDocument(bytes);
  const page = doc.loadPage(index);
  const appearance = page.getWidgets()[0]?.getObject().get("AP");
  const stream = appearance && !appearance.isNull() ? appearance.get("N") : undefined;
  const text = stream && stream.isStream() ? new TextDecoder("latin1").decode(stream.readStream().asUint8Array()) : "";
  page.destroy();
  doc.destroy();
  return text;
}

/** ¿Hay píxeles oscuros (el sello) en la región [x0,y0,x1,y1] de la página renderizada a escala 1? */
function darkPixelsIn(bytes: ArrayBuffer, index: number, region: [number, number, number, number]): number {
  const doc = new mupdf.PDFDocument(bytes);
  const page = doc.loadPage(index);
  const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const pixels = pixmap.getPixels();
  const width = pixmap.getWidth();
  let dark = 0;
  for (let y = region[1]; y < region[3]; y++) for (let x = region[0]; x < region[2]; x++) if ((pixels[(y * width + x) * 3] ?? 255) < 128) dark++;
  pixmap.destroy();
  page.destroy();
  doc.destroy();
  return dark;
}

describe("firmar con e.firma", () => {
  it("firma de forma incremental, el ByteRange cubre todo el archivo y OpenSSL verifica el CMS", async () => {
    const input = makePdf(2);
    const original = new Uint8Array(input.bytes.slice(0));
    const { outputs } = await signOp(input, { reason: "Conformidad con el contrato" });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.name).toBe("contrato-firmado.pdf");
    const bytes = new Uint8Array(outputs[0]?.bytes ?? new ArrayBuffer(0));
    // Incremental: el archivo original queda intacto al principio.
    expect(bytes.subarray(0, original.length)).toEqual(original);

    const [signature, ...rest] = signaturesOf(bytes);
    expect(rest).toHaveLength(0);
    if (!signature) throw new Error("sin firma");
    const [start, length, resume, tail] = signature.byteRange;
    expect(start).toBe(0);
    expect(resume + tail).toBe(bytes.length);
    expect(resume - length).toBe(2 + 8192 * 2);
    expect(signature.dictionary).toContain("/SubFilter/ETSI.CAdES.detached");
    expect(signature.dictionary).toContain("/Reason(Conformidad con el contrato)");
    expect(signature.dictionary).toMatch(/\/M\(D:\d{14}[+-]\d{2}'\d{2}'\)/);

    const doc = new mupdf.PDFDocument(bytes);
    expect(doc.getTrailer().get("Root").get("AcroForm").get("SigFlags").asNumber()).toBe(3);
    const widgets = doc.loadPage(1).getWidgets();
    expect(widgets.map((widget) => widget.getFieldType())).toEqual(["signature"]);
    expect(widgets[0]?.getName()).toBe("Firma1");
    doc.destroy();

    // El sello visible está en la última página (abajo a la derecha) con nombre, RFC y fecha, y se dibuja.
    const stamp = stampOf(outputs[0]?.bytes ?? new ArrayBuffer(0), 1);
    expect(stamp).toContain("(MARIA GOMEZ LOPEZ) Tj");
    expect(stamp).toContain("(RFC: GOLM850101AB1) Tj");
    expect(stamp).toContain("(Motivo: Conformidad con el contrato) Tj");
    expect(stamp).toContain("(Certificado 00001000000700005000) Tj");
    expect(stampOf(outputs[0]?.bytes ?? new ArrayBuffer(0), 0)).toBe("");
    expect(darkPixelsIn(outputs[0]?.bytes ?? new ArrayBuffer(0), 1, [372, 690, 584, 764])).toBeGreaterThan(200);
    expect(darkPixelsIn(outputs[0]?.bytes ?? new ArrayBuffer(0), 1, [28, 690, 240, 764])).toBe(0);

    if (!hasOpenssl()) return;
    const verified = opensslVerify(signature.cms, signature.signed);
    expect(verified.ok, verified.output).toBe(true);
    expect(verified.signer).toEqual(fixture("fiel.cer"));
  });

  it("una segunda firma conserva válida la primera", async () => {
    const first = await signOp(makePdf(1), { stamp: null });
    const firstBytes = new Uint8Array(first.outputs[0]?.bytes ?? new ArrayBuffer(0));
    const [before] = signaturesOf(firstBytes);
    const second = await signOp({ name: "contrato-firmado.pdf", bytes: firstBytes.slice().buffer }, { stamp: { page: "first", corner: "top-left" } });
    const bytes = new Uint8Array(second.outputs[0]?.bytes ?? new ArrayBuffer(0));
    expect(second.outputs[0]?.name).toBe("contrato-firmado-firmado.pdf");
    const signatures = signaturesOf(bytes);
    expect(signatures).toHaveLength(2);
    expect(signatures[0]?.byteRange).toEqual(before?.byteRange);
    expect(signatures[0]?.cms).toEqual(before?.cms);
    const doc = new mupdf.PDFDocument(bytes);
    expect(doc.loadPage(0).getWidgets().map((widget) => widget.getName()).sort()).toEqual(["Firma1", "Firma2"]);
    doc.destroy();
    if (!hasOpenssl()) return;
    for (const signature of signatures) expect(opensslVerify(signature.cms, signature.signed).ok).toBe(true);
  });

  it("firma invisible: sin sello y sin texto añadido", async () => {
    const { outputs } = await signOp(makePdf(1), { stamp: null });
    const bytes = outputs[0]?.bytes ?? new ArrayBuffer(0);
    expect(stampOf(bytes, 0)).toBe("");
    expect(darkPixelsIn(bytes, 0, [0, 200, 612, 792])).toBe(0);
    const doc = new mupdf.PDFDocument(bytes);
    const widget = doc.loadPage(0).getWidgets()[0];
    expect(widget?.getObject().get("Rect").asJS()).toEqual([0, 0, 0, 0]);
    expect(widget?.getObject().get("AP").isNull()).toBe(true);
    doc.destroy();
  });

  it("en una página girada el sello queda dentro de la página y con matriz de giro", async () => {
    const { outputs } = await signOp(makePdf(1, { rotate: 90 }), { stamp: { page: "first", corner: "bottom-right" } });
    const doc = new mupdf.PDFDocument(outputs[0]?.bytes ?? new ArrayBuffer(0));
    const widget = doc.loadPage(0).getWidgets()[0];
    if (!widget) throw new Error("sin widget");
    const rect = widget.getObject().get("Rect");
    const values = [0, 1, 2, 3].map((i) => rect.get(i).asNumber());
    for (const value of values) expect(value).toBeGreaterThanOrEqual(0);
    expect(Math.max(values[0] ?? 0, values[2] ?? 0)).toBeLessThanOrEqual(612);
    expect(Math.max(values[1] ?? 0, values[3] ?? 0)).toBeLessThanOrEqual(792);
    // En espacio de usuario (sin girar) el recuadro es más alto que ancho.
    expect(Math.abs((values[3] ?? 0) - (values[1] ?? 0))).toBeGreaterThan(Math.abs((values[2] ?? 0) - (values[0] ?? 0)));
    const matrix = widget.getObject().get("AP").get("N").get("Matrix");
    expect([0, 1, 2, 3].map((i) => Math.round(matrix.get(i).asNumber()))).toEqual([0, 1, -1, 0]);
    doc.destroy();
    expect(stampOf(outputs[0]?.bytes ?? new ArrayBuffer(0), 0)).toContain("(RFC: GOLM850101AB1) Tj");
    // Página carta girada 90°: se ve apaisada (792 × 612); el sello va abajo a la derecha de esa vista.
    expect(darkPixelsIn(outputs[0]?.bytes ?? new ArrayBuffer(0), 0, [552, 510, 764, 584])).toBeGreaterThan(200);
  });

  it("errores tipados: contraseña, pareja, CSD, vencido y PDF cifrado", async () => {
    await expectCode(() => signOp(makePdf(1), { password: "mala" }), "efirma.wrong_password");
    await expectCode(() => signOp(makePdf(1), { certificate: "otra.cer" }), "efirma.mismatch");
    await expectCode(() => signOp(makePdf(1), { certificate: "csd.cer" }), "efirma.not_fiel");
    await expectCode(() => signOp(makePdf(1), { certificate: "vencido.cer" }), "efirma.certificate_expired");
    await expectCode(() => signOp(makePdf(1, { encrypt: true })), "pdf.encrypted");
  });
});
