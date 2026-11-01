import * as mupdf from "mupdf";
import { EngineError, isEngineError } from "../errors.ts";
import { LIMITS, assertInputs, baseName, openPdf, savePdf, using } from "../pdf.ts";
import type { CompressPreset, CompressTarget, InputFile, OutputFile } from "../protocol.ts";
import type { Report } from "./types.ts";

interface ImagePolicy {
  /** Resolución máxima efectiva respecto al lado mayor de la página más grande. */
  maxDpi: number;
  /** Calidad JPEG 1-100. */
  quality: number;
}

const LOSSLESS_SAVE = "garbage=deduplicate,compress,compress-fonts,compress-images";

const PRESETS: Record<CompressPreset, ImagePolicy | null> = {
  lossless: null,
  balanced: { maxDpi: 150, quality: 72 },
  max: { maxDpi: 110, quality: 55 },
};

// Escalera para "peso objetivo": de menos a más agresivo. Se detiene en el primer escalón que cumple.
const TARGET_LADDER: Array<ImagePolicy | null> = [
  null,
  { maxDpi: 200, quality: 80 },
  { maxDpi: 150, quality: 72 },
  { maxDpi: 130, quality: 64 },
  { maxDpi: 110, quality: 55 },
  { maxDpi: 96, quality: 48 },
  { maxDpi: 72, quality: 40 },
];

const MIN_TARGET_BYTES = 10 * 1024;
/** Solo se sustituye una imagen si el resultado es al menos un 10 % más pequeño. */
const MIN_GAIN_RATIO = 0.9;

function isName(obj: mupdf.PDFObject, value: string): boolean {
  return obj.isName() && obj.asName() === value;
}

function largestPageSide(doc: mupdf.PDFDocument): number {
  let largest = 0;
  for (let index = 0; index < doc.countPages(); index++) {
    using(doc.loadPage(index), (page) => {
      const [x0, y0, x1, y1] = page.getBounds();
      largest = Math.max(largest, Math.abs(x1 - x0), Math.abs(y1 - y0));
    });
  }
  return largest;
}

/** Imágenes que se pueden recodificar sin riesgo de alterar su apariencia. */
function isRecompressible(ref: mupdf.PDFObject): boolean {
  if (!ref.isStream() || !isName(ref.get("Subtype"), "Image")) return false;
  const imageMask = ref.get("ImageMask");
  if (imageMask.isBoolean() && imageMask.asBoolean()) return false;
  // Transparencias, máscaras y arrays Decode cambian cómo se compone la imagen: se dejan intactas.
  if (!ref.get("SMask").isNull() || !ref.get("Mask").isNull() || !ref.get("Decode").isNull()) return false;
  const bpc = ref.get("BitsPerComponent");
  if (!bpc.isNumber() || bpc.asNumber() !== 8) return false;
  const width = ref.get("Width");
  const height = ref.get("Height");
  if (!width.isNumber() || !height.isNumber()) return false;
  const pixels = width.asNumber() * height.asNumber();
  return pixels > 0 && pixels <= LIMITS.maxDecodePixels;
}

function recompressImage(doc: mupdf.PDFDocument, ref: mupdf.PDFObject, maxSide: number, quality: number): boolean {
  const rawLength = using(ref.readRawStream(), (raw) => raw.getLength());

  return using(doc.loadImage(ref), (image) => {
    let pixmap = image.toPixmap();
    try {
      if (pixmap.getAlpha()) return false;
      const colorspace = pixmap.getColorSpace();
      if (!colorspace) return false;

      const gray = colorspace.isGray();
      if (!gray && !colorspace.isRGB()) {
        const converted = pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
        pixmap.destroy();
        pixmap = converted;
      }

      const width = pixmap.getWidth();
      const height = pixmap.getHeight();
      const scale = Math.min(1, maxSide / Math.max(width, height));
      if (scale < 1) {
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const resized = pixmap.warp(
          [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height],
          ],
          targetWidth,
          targetHeight,
        );
        pixmap.destroy();
        pixmap = resized;
      }

      const jpeg = pixmap.asJPEG(quality, false);
      if (jpeg.byteLength >= rawLength * MIN_GAIN_RATIO) return false;

      const dict = doc.newDictionary();
      dict.put("Type", doc.newName("XObject"));
      dict.put("Subtype", doc.newName("Image"));
      dict.put("Width", doc.newInteger(pixmap.getWidth()));
      dict.put("Height", doc.newInteger(pixmap.getHeight()));
      dict.put("BitsPerComponent", doc.newInteger(8));
      dict.put("ColorSpace", doc.newName(gray ? "DeviceGray" : "DeviceRGB"));
      dict.put("Filter", doc.newName("DCTDecode"));
      ref.writeObject(dict);
      ref.writeRawStream(jpeg);
      return true;
    } finally {
      pixmap.destroy();
    }
  });
}

interface Attempt {
  bytes: ArrayBuffer;
  imagesRecompressed: number;
}

function compressOnce(input: InputFile, policy: ImagePolicy | null, warnings: string[]): Attempt {
  return using(openPdf(input), (doc) => {
    let imagesRecompressed = 0;
    if (policy) {
      const maxSide = Math.ceil((largestPageSide(doc) / 72) * policy.maxDpi);
      const objectCount = doc.countObjects();
      for (let num = 1; num < objectCount; num++) {
        const ref = doc.newIndirect(num);
        try {
          if (isRecompressible(ref) && recompressImage(doc, ref, maxSide, policy.quality)) imagesRecompressed++;
        } catch (cause) {
          if (isEngineError(cause)) throw cause;
          // Una imagen que MuPDF no sabe decodificar se conserva tal cual; el resto del documento sigue.
          warnings.push(`Se conservó sin cambios una imagen que no se pudo recodificar (objeto ${num}).`);
        } finally {
          ref.destroy();
        }
      }
      try {
        doc.subsetFonts();
      } catch {
        warnings.push("Algunas fuentes no se pudieron reducir y se conservaron completas.");
      }
    }
    return { bytes: savePdf(doc, LOSSLESS_SAVE), imagesRecompressed };
  });
}

function formatMB(bytes: number): string {
  // Por debajo de 1 MB, «0.04 MB» se lee peor que «41 KB».
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function compress(input: InputFile, target: CompressTarget, report: Report, warnings: string[]): OutputFile[] {
  assertInputs([input]);
  const name = `${baseName(input.name)}-comprimido.pdf`;
  const originalSize = input.bytes.byteLength;
  let best: Attempt;

  if (target.kind === "preset") {
    const policy = PRESETS[target.preset];
    if (policy === undefined) throw new EngineError("input.invalid", `Nivel de compresión desconocido: ${target.preset}.`);
    report(0.1, "Analizando imágenes y fuentes");
    best = compressOnce(input, policy, warnings);
  } else {
    if (!Number.isInteger(target.maxBytes) || target.maxBytes < MIN_TARGET_BYTES) {
      throw new EngineError("input.invalid", "El peso objetivo debe ser de al menos 10 KB.");
    }
    if (originalSize <= target.maxBytes) {
      warnings.push(
        `Tu PDF ya pesa ${formatMB(originalSize)}, menos que el máximo de ${formatMB(target.maxBytes)}: no hizo falta comprimirlo.`,
      );
      report(1, "Listo");
      return [{ name, mime: "application/pdf", bytes: input.bytes.slice(0) }];
    }
    let found: Attempt | null = null;
    for (const [step, policy] of TARGET_LADDER.entries()) {
      report(step / TARGET_LADDER.length, `Probando nivel ${step + 1} de ${TARGET_LADDER.length}`);
      const attemptWarnings: string[] = [];
      const attempt = compressOnce(input, policy, attemptWarnings);
      if (found === null || attempt.bytes.byteLength < found.bytes.byteLength) {
        found = attempt;
        warnings.splice(0, warnings.length, ...attemptWarnings);
      }
      if (attempt.bytes.byteLength <= target.maxBytes) break;
    }
    if (found === null) throw new EngineError("internal", "No se pudo comprimir el documento.");
    best = found;
    if (best.bytes.byteLength > target.maxBytes) {
      warnings.push(
        `No fue posible llegar a ${formatMB(target.maxBytes)} sin volver ilegible el documento. ` +
          `Lo mínimo alcanzado es ${formatMB(best.bytes.byteLength)}.`,
      );
    }
  }

  report(1, "Listo");
  if (best.bytes.byteLength >= originalSize) {
    warnings.push("El PDF ya estaba optimizado: se devuelve el original para no aumentar su peso.");
    return [{ name, mime: "application/pdf", bytes: input.bytes.slice(0) }];
  }
  return [{ name, mime: "application/pdf", bytes: best.bytes }];
}
