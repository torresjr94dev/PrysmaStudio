import * as mupdf from "mupdf";
import type { InputFile } from "../src/protocol.ts";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function save(doc: mupdf.PDFDocument, options = "compress"): ArrayBuffer {
  const buffer = doc.saveToBuffer(options);
  try {
    return toArrayBuffer(buffer.asUint8Array());
  } finally {
    buffer.destroy();
  }
}

/** PDF de texto con páginas "<label>1", "<label>2"… para verificar orden tras operar. */
export function textPdf(pages: number, label: string, size: [number, number] = [612, 792]): InputFile {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 24 Tf 72 ${size[1] - 92} Td (${label}${i + 1}) Tj ET`;
    doc.insertPage(-1, doc.addPage([0, 0, size[0], size[1]], 0, { Font: { F1: font } }, content));
  }
  return { name: `${label}.pdf`, bytes: save(doc) };
}

/** PRNG determinista (xorshift32) para generar "fotos" reproducibles. */
function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

const QUADRANTS: Array<[number, number, number]> = [
  [220, 30, 30], // arriba-izquierda: rojo
  [30, 200, 30], // arriba-derecha: verde
  [30, 30, 220], // abajo-izquierda: azul
  [240, 240, 240], // abajo-derecha: blanco
];

/** Pixmap RGB con cuatro cuadrantes de color y ruido (se comporta como una foto: Flate comprime mal). */
export function quadrantPixmap(width: number, height: number): mupdf.Pixmap {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  const pixels = pixmap.getPixels();
  const random = rng(42);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const quadrant = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
      const color = QUADRANTS[quadrant] ?? [0, 0, 0];
      const offset = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) pixels[offset + c] = (color[c] ?? 0) + Math.round((random() - 0.5) * 40);
    }
  }
  return pixmap;
}

export function pngImage(width: number, height: number, name = "foto.png"): InputFile {
  const pixmap = quadrantPixmap(width, height);
  try {
    return { name, bytes: toArrayBuffer(pixmap.asPNG()) };
  } finally {
    pixmap.destroy();
  }
}

/** PDF de una página con una imagen grande sin comprimir con pérdida, ocupando toda la página. */
export function imagePdf(width = 2400, height = 1600, page: [number, number] = [612, 408]): InputFile {
  const doc = new mupdf.PDFDocument();
  const pixmap = quadrantPixmap(width, height);
  const image = new mupdf.Image(pixmap);
  const ref = doc.addImage(image);
  const content = `q ${page[0]} 0 0 ${page[1]} 0 0 cm /Im0 Do Q`;
  doc.insertPage(-1, doc.addPage([0, 0, page[0], page[1]], 0, { XObject: { Im0: ref } }, content));
  image.destroy();
  pixmap.destroy();
  return { name: "escaneo.pdf", bytes: save(doc) };
}

export function openOutput(bytes: ArrayBuffer, password?: string): mupdf.PDFDocument {
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), "application/pdf").asPDF();
  if (!doc) throw new Error("La salida no es un PDF");
  if (password !== undefined) doc.authenticatePassword(password);
  return doc;
}

export function pageText(doc: mupdf.PDFDocument, index: number): string {
  const page = doc.loadPage(index);
  const text = page.toStructuredText("").asText().trim();
  page.destroy();
  return text;
}

/** Color RGB en una posición relativa (0-1) de la página renderizada. */
export function sampleColor(doc: mupdf.PDFDocument, pageIndex: number, rx: number, ry: number): [number, number, number] {
  const page = doc.loadPage(pageIndex);
  const pixmap = page.toPixmap(mupdf.Matrix.scale(0.5, 0.5), mupdf.ColorSpace.DeviceRGB, false);
  const x = Math.floor(pixmap.getWidth() * rx);
  const y = Math.floor(pixmap.getHeight() * ry);
  const offset = y * pixmap.getStride() + x * pixmap.getNumberOfComponents();
  const pixels = pixmap.getPixels();
  const color: [number, number, number] = [pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0];
  pixmap.destroy();
  page.destroy();
  return color;
}

export function countImages(doc: mupdf.PDFDocument): number {
  let count = 0;
  for (let num = 1; num < doc.countObjects(); num++) {
    const ref = doc.newIndirect(num);
    const subtype = ref.isStream() ? ref.get("Subtype") : null;
    if (subtype?.isName() && subtype.asName() === "Image") count++;
    ref.destroy();
  }
  return count;
}

export const noProgress = (): void => undefined;
