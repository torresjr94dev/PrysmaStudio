// Tapar datos personales: localizar CURP, RFC, NSS, correos, teléfonos y textos propios en la capa de
// texto del PDF y eliminarlos de verdad (anotaciones Redact aplicadas por MuPDF: el texto desaparece del
// contenido, las imágenes debajo se pixelan y encima queda una caja negra).
import * as mupdf from "mupdf";
import { EngineError } from "../errors.ts";
import { baseName, openPdf, savePdf, using } from "../pdf.ts";
import type { InputFile, OutputFile, RedactArea, RedactCategory, RedactMatch, RedactOptions, RedactRect, RedactScan } from "../protocol.ts";
import type { Report } from "./types.ts";

export const REDACT_LIMITS = {
  maxMatches: 5000,
  maxTerms: 50,
  minTermLength: 3,
  maxTermLength: 200,
  maxAreas: 20_000,
} as const;

// ---------- Detectores ----------

interface Hit {
  start: number;
  end: number;
  category: RedactCategory;
}

const STATES = "AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE";
const CURP = new RegExp(`(?<![A-Z\\d])[A-Z][AEIOUX][A-Z]{2}\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])[HM](?:${STATES})[B-DF-HJ-NP-TV-Z]{3}[A-Z\\d]\\d(?![A-Z\\d])`, "g");
const RFC = /(?<![A-ZÑ&\d])[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}(?![A-ZÑ&\d])/g;
/** RFC genéricos del SAT para público en general y extranjeros: no identifican a nadie. */
const GENERIC_RFC = new Set(["XAXX010101000", "XEXX010101000"]);
const NSS = /(?<!\d)\d{2}[ -]?\d{2}[ -]?\d{2}[ -]?\d{4}[ -]?\d(?!\d)/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const PHONE = /(?<![\d+])(?:\+?52[ -]?)?(?:\(\d{2,3}\)|\d{2,3})[ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;

function validDate(yymmdd: string): boolean {
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Dígito verificador del NSS del IMSS (Luhn sobre los 11 dígitos). */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10 === 0;
}

function phoneDigits(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("52") && digits.length === 12 ? 10 : digits.length;
}

/** Mayúsculas carácter a carácter: conserva la longitud (toUpperCase de «ß» daría «SS» y movería los índices). */
function upperPreservingLength(text: string): string {
  let out = "";
  for (const char of text) {
    const upper = char.toUpperCase();
    out += upper.length === char.length ? upper : char;
  }
  return out;
}

/** Minúsculas sin diacríticos, carácter a carácter, para buscar términos del usuario. */
function foldPreservingLength(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = char.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += folded.length === char.length ? folded : char;
  }
  return out;
}

function scanRegex(text: string, regex: RegExp, category: RedactCategory, accept: (match: string) => boolean = () => true): Hit[] {
  const hits: Hit[] = [];
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (accept(match[0])) hits.push({ start: match.index, end: match.index + match[0].length, category });
  }
  return hits;
}

/** Normaliza y acota los términos del usuario; los demasiado cortos se descartan (taparían de más). */
export function normalizeTerms(terms: string[]): string[] {
  const unique = new Set<string>();
  for (const term of terms) {
    const folded = foldPreservingLength(term.trim().replace(/\s+/g, " "));
    if (folded.length >= REDACT_LIMITS.minTermLength && folded.length <= REDACT_LIMITS.maxTermLength) unique.add(folded);
    if (unique.size >= REDACT_LIMITS.maxTerms) break;
  }
  return [...unique];
}

/** Coincidencias en el texto de una línea, de izquierda a derecha y sin solapamientos. */
export function detect(text: string, options: RedactOptions, terms: string[]): Hit[] {
  const wanted = new Set(options.categories);
  const upper = upperPreservingLength(text);
  const hits: Hit[] = [];
  if (wanted.has("curp")) hits.push(...scanRegex(upper, CURP, "curp"));
  if (wanted.has("rfc")) hits.push(...scanRegex(upper, RFC, "rfc", (rfc) => validDate(rfc.slice(-9, -3)) && !GENERIC_RFC.has(rfc)));
  if (wanted.has("nss")) hits.push(...scanRegex(text, NSS, "nss", (nss) => luhnValid(nss.replace(/\D/g, ""))));
  if (wanted.has("email")) hits.push(...scanRegex(text, EMAIL, "email"));
  if (wanted.has("phone")) hits.push(...scanRegex(text, PHONE, "phone", (phone) => phoneDigits(phone) === 10));
  if (terms.length > 0) {
    const folded = foldPreservingLength(text);
    for (const term of terms) {
      let from = 0;
      for (;;) {
        const at = folded.indexOf(term, from);
        if (at < 0) break;
        hits.push({ start: at, end: at + term.length, category: "custom" });
        from = at + term.length;
      }
    }
  }
  // Un CURP contiene algo con forma de RFC y un término puede pisar un correo: gana el más largo.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Hit[] = [];
  for (const hit of hits) {
    const last = merged[merged.length - 1];
    if (last && hit.start < last.end) {
      if (hit.end > last.end) last.end = hit.end;
      continue;
    }
    merged.push(hit);
  }
  return merged;
}

// ---------- Escaneo ----------

interface Line {
  text: string;
  quads: mupdf.Quad[];
}

function readLines(page: mupdf.PDFPage): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  using(page.toStructuredText(""), (stext) => {
    stext.walk({
      beginLine: () => {
        current = { text: "", quads: [] };
      },
      onChar: (char, _origin, _font, _size, quad) => {
        if (!current) return;
        // Cada carácter aporta una sola unidad de código: los índices del texto y de los cuadros coinciden
        // salvo con caracteres astrales, que se reducen a «?» para no desalinearlos.
        current.text += char.length === 1 ? char : "?";
        current.quads.push(quad);
      },
      endLine: () => {
        if (current && current.text.trim() !== "") lines.push(current);
        current = null;
      },
    });
  });
  return lines;
}

function rectOf(quads: mupdf.Quad[]): RedactRect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const quad of quads) {
    for (let i = 0; i < 8; i += 2) {
      const x = quad[i] as number;
      const y = quad[i + 1] as number;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  // Un punto de margen: los cuadros de MuPDF ciñen el glifo y un borde de tinta visible lo delataría.
  const pad = 1;
  return { x: round(x0 - pad), y: round(y0 - pad), width: round(x1 - x0 + 2 * pad), height: round(y1 - y0 + 2 * pad) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scan(input: InputFile, options: RedactOptions): RedactScan {
  const terms = normalizeTerms(options.terms);
  return using(openPdf(input), (doc) => {
    const pageCount = doc.countPages();
    const matches: RedactMatch[] = [];
    let textlessPages = 0;
    for (let index = 0; index < pageCount; index++) {
      const lines = using(doc.loadPage(index), readLines);
      if (lines.length === 0) {
        textlessPages++;
        continue;
      }
      lines.forEach((line, lineIndex) => {
        for (const hit of detect(line.text, options, terms)) {
          if (matches.length >= REDACT_LIMITS.maxMatches) return;
          const quads = line.quads.slice(hit.start, hit.end);
          if (quads.length === 0) continue;
          matches.push({
            id: `${index}:${lineIndex}:${hit.start}`,
            page: index,
            category: hit.category,
            text: line.text.slice(hit.start, hit.end),
            rects: [rectOf(quads)],
          });
        }
      });
    }
    return { matches, pageCount, textlessPages };
  });
}

// ---------- Redacción ----------

const INFO_KEYS = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"];

function stripMetadata(doc: mupdf.PDFDocument): void {
  const info = doc.getTrailer().get("Info");
  if (info.isDictionary()) for (const key of INFO_KEYS) info.delete(key);
  const root = doc.getTrailer().get("Root");
  if (root.isDictionary()) root.delete("Metadata");
}

function assertAreas(areas: RedactArea[], pageCount: number): void {
  let total = 0;
  for (const area of areas) {
    if (!Number.isInteger(area.page) || area.page < 0 || area.page >= pageCount) {
      throw new EngineError("input.invalid", `La página ${area.page + 1} no existe en el documento.`);
    }
    for (const rect of area.rects) {
      const values = [rect.x, rect.y, rect.width, rect.height];
      if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
        throw new EngineError("input.invalid", "Una de las zonas a tapar no tiene un tamaño válido.");
      }
      if (++total > REDACT_LIMITS.maxAreas) throw new EngineError("limits.exceeded", `Demasiadas zonas a tapar (máximo ${REDACT_LIMITS.maxAreas}).`);
    }
  }
  if (total === 0) throw new EngineError("input.invalid", "No hay ninguna zona que tapar.");
}

export function redact(input: InputFile, areas: RedactArea[], removeMetadata: boolean, report: Report): OutputFile[] {
  return using(openPdf(input), (doc) => {
    assertAreas(areas, doc.countPages());
    const byPage = new Map<number, RedactRect[]>();
    for (const area of areas) byPage.set(area.page, [...(byPage.get(area.page) ?? []), ...area.rects]);

    let done = 0;
    for (const [index, rects] of byPage) {
      using(doc.loadPage(index), (page) => {
        for (const rect of rects) {
          const annotation = page.createAnnotation("Redact");
          annotation.setRect([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]);
          annotation.update();
        }
        page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      });
      report(++done / (byPage.size + 1), `Tapando página ${index + 1}`);
    }
    if (removeMetadata) stripMetadata(doc);
    report(1, "Guardando");
    return [{ name: `${baseName(input.name)}-tapado.pdf`, mime: "application/pdf", bytes: savePdf(doc) }];
  });
}
