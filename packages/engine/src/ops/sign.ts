// Firma PAdES (ETSI.CAdES.detached) de un PDF con la e.firma del SAT, 100 % en el navegador.
// El flujo es el clásico: se inserta un campo de firma con /ByteRange y /Contents de relleno, se guarda
// (incremental, para no invalidar firmas previas), se localizan ambos en los bytes, se calcula el SHA-256
// de todo menos /Contents, se construye el CMS y se escribe en hexadecimal dentro del hueco.
import * as mupdf from "mupdf";
import { pdfString, sanitize } from "../cfdi/render.ts";
import { bytesToHex, owned } from "../efirma/asn1.ts";
import { buildSignedData } from "../efirma/cms.ts";
import { openCredentials, type Credentials } from "../efirma/credentials.ts";
import { EngineError } from "../errors.ts";
import { SAVE_DEFAULT, baseName, openPdf, savePdf, using } from "../pdf.ts";
import type { CertificateInfo, InputFile, OutputFile, SignStamp } from "../protocol.ts";
import type { Report } from "./types.ts";

export interface SignInputs {
  certificate: InputFile;
  privateKey: InputFile;
  password: string;
}

export interface SignOptions {
  reason: string;
  stamp: SignStamp | null;
}

/** Hueco para el CMS: certificado del SAT (~1.5 KB) + firma RSA-2048 + atributos caben de sobra. */
const CONTENTS_BYTES = 8192;
/** Marcador de /ByteRange: 10 dígitos, el ancho máximo que se reescribe en sitio (archivos < 10 GB). */
const BYTE_RANGE_PLACEHOLDER = 2147483647;
const MAX_REASON = 200;

const STAMP = { width: 212, margin: 28, padding: 8 } as const;

const ascii = new TextEncoder();

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  if (first === undefined) return -1;
  const last = haystack.length - needle.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Fecha PDF (D:AAAAMMDDHHmmSS+HH'mm') en la hora local del equipo. */
function pdfDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${sign}${hours}'${minutes}'`;
}

function humanDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const zone = `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())} (${zone})`;
}

interface Measurer {
  (text: string, bold: boolean, size: number): number;
}

function measurer(regular: mupdf.Font, bold: mupdf.Font): Measurer {
  const cache = new Map<string, number>();
  return (text, isBold, size) => {
    const face = isBold ? bold : regular;
    let width = 0;
    for (const char of text) {
      const key = `${isBold ? "b" : "r"}${char}`;
      let advance = cache.get(key);
      if (advance === undefined) {
        advance = face.advanceGlyph(face.encodeCharacter(char.codePointAt(0) ?? 0x3f), 0);
        cache.set(key, advance);
      }
      width += advance;
    }
    return width * size;
  };
}

/** Recorta con «…» para que quepa en `width` puntos. */
function fit(text: string, bold: boolean, size: number, width: number, measure: Measurer): string {
  if (measure(text, bold, size) <= width) return text;
  let cut = text.length;
  while (cut > 1 && measure(`${text.slice(0, cut)}…`, bold, size) > width) cut--;
  return `${text.slice(0, cut)}…`;
}

interface StampLine {
  text: string;
  size: number;
  bold: boolean;
  gray: number;
  /** Separación respecto a la línea anterior, en puntos. */
  lead: number;
}

/** Recuadro con el titular, su RFC y la fecha: el aspecto visible de la firma. */
function stampAppearance(info: CertificateInfo, date: Date, reason: string, measure: Measurer): { content: string; height: number } {
  const inner = STAMP.width - 2 * STAMP.padding;
  const lines: StampLine[] = [
    { text: "Firmado electrónicamente con e.firma por", size: 6.5, bold: false, gray: 0.4, lead: 0 },
    { text: fit(sanitize(info.subjectName), true, 9, inner, measure), size: 9, bold: true, gray: 0, lead: 11 },
    { text: `RFC: ${info.rfc ?? "no disponible"}`, size: 7.5, bold: false, gray: 0, lead: 10 },
    { text: `Fecha: ${humanDate(date)}`, size: 7.5, bold: false, gray: 0, lead: 10 },
  ];
  if (reason) lines.push({ text: fit(sanitize(`Motivo: ${reason}`), false, 7.5, inner, measure), size: 7.5, bold: false, gray: 0, lead: 10 });
  lines.push({ text: `Certificado ${info.serialNumber}`, size: 6, bold: false, gray: 0.4, lead: 9 });

  const height = 2 * STAMP.padding + lines.reduce((sum, line) => sum + line.lead, 0) + 7;
  const parts: string[] = [
    "q 1 g 0.62 G 0.6 w",
    `0.3 0.3 ${(STAMP.width - 0.6).toFixed(2)} ${(height - 0.6).toFixed(2)} re B`,
    // Franja lateral discreta, con el gris de la casa.
    `0.3 g 0 0 2.4 ${height.toFixed(2)} re f`,
    "Q BT",
  ];
  let y = height - STAMP.padding;
  for (const line of lines) {
    y -= line.lead;
    const baseline = y - 6.5;
    parts.push(`${line.gray} g /${line.bold ? "HeBo" : "Helv"} ${line.size} Tf 1 0 0 1 ${STAMP.padding} ${baseline.toFixed(2)} Tm ${pdfString(sanitize(line.text))} Tj`);
  }
  parts.push("ET");
  return { content: parts.join("\n"), height };
}

interface Placeholders {
  byteRangeStart: number;
  byteRangeLength: number;
  contentsStart: number;
}

/** Localiza /ByteRange y /Contents del campo recién escrito. Deben ser únicos: si no, algo salió mal. */
function findPlaceholders(bytes: Uint8Array, from: number): Placeholders {
  const byteRangeKey = ascii.encode("/ByteRange");
  const pattern = new RegExp(`^\\s*\\[\\s*0\\s+${BYTE_RANGE_PLACEHOLDER}\\s+${BYTE_RANGE_PLACEHOLDER}\\s+${BYTE_RANGE_PLACEHOLDER}\\s*\\]`);
  const latin1 = new TextDecoder("latin1");
  let found: Placeholders | null = null;
  let at = indexOfBytes(bytes, byteRangeKey, from);
  while (at >= 0) {
    const tail = latin1.decode(bytes.subarray(at + byteRangeKey.length, at + byteRangeKey.length + 64));
    const match = pattern.exec(tail);
    if (match) {
      if (found) throw new EngineError("internal", "El documento contiene más de un campo de firma pendiente.");
      const byteRangeStart = at + byteRangeKey.length + (match[0].length - match[0].trimStart().length);
      const objectEnd = indexOfBytes(bytes, ascii.encode("endobj"), at);
      const objectStart = Math.max(0, at - 4096);
      const window = latin1.decode(bytes.subarray(objectStart, objectEnd < 0 ? bytes.length : objectEnd));
      const contents = new RegExp(`/Contents\\s*<0{${CONTENTS_BYTES * 2}}>`).exec(window);
      if (!contents) throw new EngineError("internal", "No se encontró el hueco de la firma en el PDF guardado.");
      const contentsStart = objectStart + contents.index + contents[0].indexOf("<");
      found = { byteRangeStart, byteRangeLength: match[0].trimStart().length, contentsStart };
    }
    at = indexOfBytes(bytes, byteRangeKey, at + 1);
  }
  if (!found) throw new EngineError("internal", "No se encontró el campo de firma en el PDF guardado.");
  return found;
}

function signatureFieldName(doc: mupdf.PDFDocument, pageCount: number): { name: string; signed: number } {
  const names = new Set<string>();
  let signed = 0;
  for (let index = 0; index < pageCount; index++) {
    using(doc.loadPage(index), (page) => {
      for (const widget of page.getWidgets()) {
        if (widget.getFieldType() !== "signature") continue;
        names.add(widget.getName());
        if (!widget.getObject().get("V").isNull()) signed++;
      }
    });
  }
  let counter = signed + 1;
  while (names.has(`Firma${counter}`)) counter++;
  return { name: `Firma${counter}`, signed };
}

/** Registra el widget como campo del formulario y marca el documento como firmado (SigFlags). */
function registerField(doc: mupdf.PDFDocument, widgetRef: mupdf.PDFObject): void {
  const root = doc.getTrailer().get("Root");
  let acroForm = root.get("AcroForm");
  if (acroForm.isNull()) {
    acroForm = doc.newDictionary();
    acroForm.put("Fields", doc.newArray());
    root.put("AcroForm", doc.addObject(acroForm));
    acroForm = root.get("AcroForm");
  }
  let fields = acroForm.get("Fields");
  if (!fields.isArray()) {
    fields = doc.newArray();
    acroForm.put("Fields", fields);
    fields = acroForm.get("Fields");
  }
  fields.push(widgetRef);
  const flags = acroForm.get("SigFlags");
  acroForm.put("SigFlags", (flags.isNumber() ? flags.asNumber() : 0) | 3);
}

/** Rectángulo en espacio de página (ya girado, como lo ve el lector); mupdf lo pasa a espacio de usuario. */
function rectFor(page: mupdf.PDFPage, stamp: SignStamp, height: number): mupdf.Rect {
  const [x0, y0, x1, y1] = page.getBounds();
  const left = stamp.corner.endsWith("left") ? x0 + STAMP.margin : x1 - STAMP.margin - STAMP.width;
  const top = stamp.corner.startsWith("top") ? y0 + STAMP.margin : y1 - STAMP.margin - height;
  return [left, top, left + STAMP.width, top + height];
}

export async function sign(input: InputFile, inputs: SignInputs, options: SignOptions, report: Report): Promise<OutputFile[]> {
  const reason = options.reason.trim().slice(0, MAX_REASON);
  report(0.02, "Abriendo la e.firma");
  const credentials: Credentials = await openCredentials(new Uint8Array(inputs.certificate.bytes), new Uint8Array(inputs.privateKey.bytes), inputs.password);
  const info = credentials.certificate.info;
  const now = new Date();

  report(0.15, "Preparando el documento");
  const prepared = using(openPdf(input), (doc) => {
    const pageCount = doc.countPages();
    const { name, signed } = signatureFieldName(doc, pageCount);
    const incremental = doc.canBeSavedIncrementally();
    if (signed > 0 && !incremental) {
      throw new EngineError("pdf.signed", `«${input.name}» ya tiene ${signed === 1 ? "una firma" : `${signed} firmas`} y hubo que repararlo al abrirlo: firmarlo las invalidaría.`);
    }

    const signature = doc.newDictionary();
    signature.put("Type", doc.newName("Sig"));
    signature.put("Filter", doc.newName("Adobe.PPKLite"));
    signature.put("SubFilter", doc.newName("ETSI.CAdES.detached"));
    const byteRange = doc.newArray();
    byteRange.push(0);
    byteRange.push(BYTE_RANGE_PLACEHOLDER);
    byteRange.push(BYTE_RANGE_PLACEHOLDER);
    byteRange.push(BYTE_RANGE_PLACEHOLDER);
    signature.put("ByteRange", byteRange);
    signature.put("Contents", doc.newByteString(new Uint8Array(CONTENTS_BYTES)));
    signature.put("M", doc.newString(pdfDate(now)));
    signature.put("Name", doc.newString(info.subjectName));
    if (reason) signature.put("Reason", doc.newString(reason));
    signature.put("Prop_Build", { App: { Name: "PrysmaStudio" } });
    const signatureRef = doc.addObject(signature);

    const pageIndex = options.stamp?.page === "first" ? 0 : pageCount - 1;
    using(doc.loadPage(pageIndex), (page) => {
      const widget = page.createAnnotation("Widget");
      const object = widget.getObject();
      object.put("FT", doc.newName("Sig"));
      object.put("T", doc.newString(name));
      object.put("F", 132);
      object.put("V", signatureRef);
      if (options.stamp) {
        const rotateObj = doc.findPage(pageIndex).getInheritable("Rotate");
        const rotation = rotateObj.isNumber() ? ((rotateObj.asNumber() % 360) + 360) % 360 : 0;
        const regular = new mupdf.Font("Helvetica");
        const bold = new mupdf.Font("Helvetica-Bold");
        try {
          const { content, height } = stampAppearance(info, now, reason, measurer(regular, bold));
          widget.setRect(rectFor(page, options.stamp, height));
          const resources = { Font: { Helv: doc.addSimpleFont(regular, "Latin"), HeBo: doc.addSimpleFont(bold, "Latin") } };
          // La matriz deshace el /Rotate de la página: el lector gira la página y el sello queda derecho.
          widget.setAppearance(null, null, mupdf.Matrix.rotate(rotation), [0, 0, STAMP.width, height], resources, content);
        } finally {
          regular.destroy();
          bold.destroy();
        }
      } else {
        object.put("Rect", [0, 0, 0, 0]);
      }
      registerField(doc, object);
    });

    report(0.4, "Guardando el documento");
    return { bytes: new Uint8Array(savePdf(doc, incremental ? "incremental" : SAVE_DEFAULT)), incremental };
  });

  report(0.6, "Firmando");
  const bytes = prepared.bytes;
  const { byteRangeStart, byteRangeLength, contentsStart } = findPlaceholders(bytes, prepared.incremental ? input.bytes.byteLength : 0);
  const contentsEnd = contentsStart + 2 + CONTENTS_BYTES * 2;
  const ranges = [0, contentsStart, contentsEnd, bytes.length - contentsEnd];
  const byteRangeText = `[0 ${ranges[1]} ${ranges[2]} ${ranges[3]}]`;
  if (byteRangeText.length > byteRangeLength) throw new EngineError("internal", "El PDF es demasiado grande para el campo /ByteRange.");
  bytes.set(ascii.encode(byteRangeText.padEnd(byteRangeLength, " ")), byteRangeStart);

  const signedPart = new Uint8Array(bytes.length - (contentsEnd - contentsStart));
  signedPart.set(bytes.subarray(0, contentsStart), 0);
  signedPart.set(bytes.subarray(contentsEnd), contentsStart);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signedPart));
  const cms = await buildSignedData(digest, credentials.certificate, async (data) => new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", credentials.key, owned(data))));
  if (cms.length > CONTENTS_BYTES) throw new EngineError("internal", "La firma no cabe en el espacio reservado.");
  bytes.set(ascii.encode(bytesToHex(cms)), contentsStart + 1);

  report(1, "Listo");
  return [{ name: `${baseName(input.name)}-firmado.pdf`, mime: "application/pdf", bytes: bytes.buffer }];
}
