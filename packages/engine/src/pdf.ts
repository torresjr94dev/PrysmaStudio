import * as mupdf from "mupdf";
import { EngineError, isEngineError } from "./errors.ts";
import type { InputFile, Paper } from "./protocol.ts";

/** Límites duros del motor. La UI aplica umbrales menores según la memoria del dispositivo. */
export const LIMITS = {
  maxInputBytes: 1024 * 1024 * 1024,
  maxInputFiles: 200,
  maxPages: 10_000,
  /** Píxeles máximos al decodificar una imagen: evita bombas de descompresión y OOM del heap WASM. */
  maxDecodePixels: 80_000_000,
} as const;

export const PAPER_SIZES: Record<Paper, [number, number]> = {
  letter: [612, 792],
  // Oficio mexicano: 21.6 × 34 cm.
  "oficio-mx": [612.28, 963.78],
};

/** Opciones de guardado por defecto: recolecta objetos huérfanos y comprime streams. */
export const SAVE_DEFAULT = "garbage=compact,compress";

// MuPDF reporta advertencias por un callback global. El worker ejecuta una operación a la vez,
// así que basta un colector de módulo que cada operación reinicia.
let warningSink: string[] = [];
mupdf.setLog({
  warning: (message) => warningSink.push(message),
  error: (message) => warningSink.push(message),
});

export function resetMupdfWarnings(): void {
  warningSink = [];
}

export function takeMupdfWarnings(): string[] {
  const taken = warningSink;
  warningSink = [];
  return taken;
}

export function assertInputs(inputs: InputFile[]): void {
  if (inputs.length === 0) throw new EngineError("input.invalid", "No se recibió ningún archivo.");
  if (inputs.length > LIMITS.maxInputFiles) {
    throw new EngineError("limits.exceeded", `Máximo ${LIMITS.maxInputFiles} archivos por operación.`);
  }
  const total = inputs.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > LIMITS.maxInputBytes) {
    throw new EngineError("limits.exceeded", "Los archivos superan el máximo que el navegador puede procesar (1 GB).");
  }
}

/**
 * Abre un PDF validando tipo, cifrado y estructura. Nunca devuelve un documento que no se pueda recorrer.
 * IMPORTANTE: el resto del motor nunca llama a PDFObject.resolve() — en mupdf.js 1.28 hacerlo y guardar
 * después corrompe streams en silencio (ver test "no pierde imágenes al re-guardar").
 */
export function openPdf(file: InputFile, password?: string): mupdf.PDFDocument {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(new Uint8Array(file.bytes), "application/pdf");
  } catch (cause) {
    throw new EngineError("pdf.corrupt", `«${file.name}» está dañado o no es un PDF.`, { cause });
  }

  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new EngineError("input.unsupported_type", `«${file.name}» no es un PDF.`);
  }

  if (pdf.needsPassword()) {
    if (password === undefined) {
      pdf.destroy();
      throw new EngineError("pdf.encrypted", `«${file.name}» está protegido con contraseña. Desbloquéalo primero.`);
    }
    if (pdf.authenticatePassword(password) === 0) {
      pdf.destroy();
      throw new EngineError("pdf.wrong_password", `La contraseña de «${file.name}» no es correcta.`);
    }
  }

  let pages: number;
  try {
    pages = pdf.countPages();
  } catch (cause) {
    pdf.destroy();
    throw new EngineError("pdf.corrupt", `«${file.name}» está dañado: no se pudieron leer sus páginas.`, { cause });
  }
  if (pages < 1) {
    pdf.destroy();
    throw new EngineError("pdf.corrupt", `«${file.name}» no tiene páginas.`);
  }
  if (pages > LIMITS.maxPages) {
    pdf.destroy();
    throw new EngineError("limits.exceeded", `«${file.name}» tiene ${pages} páginas; el máximo es ${LIMITS.maxPages}.`);
  }
  return pdf;
}

/** Serializa a un ArrayBuffer propio (copia fuera del heap WASM) y libera el buffer nativo. */
export function savePdf(doc: mupdf.PDFDocument, options: string = SAVE_DEFAULT): ArrayBuffer {
  let buffer: mupdf.Buffer | undefined;
  try {
    buffer = doc.saveToBuffer(options);
    return buffer.asUint8Array().slice().buffer;
  } catch (cause) {
    if (isEngineError(cause)) throw cause;
    throw new EngineError("internal", "No se pudo generar el PDF de salida.", { cause });
  } finally {
    buffer?.destroy();
  }
}

/** Ejecuta `fn` y libera los objetos nativos al terminar, aunque falle. */
export function using<T extends { destroy(): void }, R>(resource: T, fn: (resource: T) => R): R {
  try {
    return fn(resource);
  } finally {
    resource.destroy();
  }
}

export function baseName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  const withoutExt = clean.replace(/\.[^.]{1,5}$/, "");
  return withoutExt.length > 0 ? withoutExt.slice(0, 120) : "documento";
}

/** Abre una imagen (JPEG/PNG/etc.) validando tamaño de decodificación. */
export function openImage(file: InputFile): mupdf.Image {
  let image: mupdf.Image;
  try {
    image = new mupdf.Image(new Uint8Array(file.bytes));
  } catch (cause) {
    throw new EngineError("input.unsupported_type", `«${file.name}» no es una imagen compatible (usa JPG o PNG).`, { cause });
  }
  const width = image.getWidth();
  const height = image.getHeight();
  if (width < 1 || height < 1) {
    image.destroy();
    throw new EngineError("input.invalid", `«${file.name}» no tiene dimensiones válidas.`);
  }
  if (width * height > LIMITS.maxDecodePixels) {
    image.destroy();
    throw new EngineError("limits.exceeded", `«${file.name}» es demasiado grande (${width}×${height} px).`);
  }
  return image;
}
