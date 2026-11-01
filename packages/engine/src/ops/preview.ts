import * as mupdf from "mupdf";
import { EngineError, isEngineError } from "../errors.ts";
import { assertInputs, openPdf, using } from "../pdf.ts";
import type { InputFile, PageSize, PageThumbnail, PreviewInfo, PreviewOptions } from "../protocol.ts";

/**
 * Tope de miniaturas por documento. ~15 KB por JPEG → ~9 MB en memoria del navegador. Más allá, una
 * cuadrícula es inmanejable para una persona y el resto de páginas se muestra solo con su número.
 */
export const MAX_THUMBNAILS = 600;
const MIN_EDGE = 32;
const MAX_EDGE = 1024;
const JPEG_QUALITY = 80;

export interface PreviewSink {
  info(info: PreviewInfo): void;
  page(thumbnail: PageThumbnail): void;
}

function pageSize(doc: mupdf.PDFDocument, index: number): PageSize {
  return using(doc.loadPage(index), (page) => {
    const [x0, y0, x1, y1] = page.getBounds();
    return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  });
}

function render(doc: mupdf.PDFDocument, index: number, size: PageSize, maxEdge: number): PageThumbnail {
  const longest = Math.max(size.width, size.height, 1);
  // Páginas diminutas (etiquetas, tickets) no se amplían más de 4×: solo engordaría el JPEG.
  const scale = Math.min(maxEdge / longest, 4);
  return using(doc.loadPage(index), (page) =>
    using(page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true), (pixmap) => ({
      index,
      // slice(): copia fuera del heap WASM antes de que el Pixmap se libere.
      jpeg: pixmap.asJPEG(JPEG_QUALITY).slice().buffer,
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
    })),
  );
}

/**
 * Envía primero la información del documento (para que la UI dibuje la cuadrícula con proporciones reales)
 * y después cada miniatura según se renderiza. Una página que no se puede dibujar se omite: la UI la muestra
 * sin imagen, pero sigue siendo editable.
 */
export function preview(input: InputFile, options: PreviewOptions, sink: PreviewSink): void {
  assertInputs([input]);
  if (options.scope !== "first" && options.scope !== "all") {
    throw new EngineError("input.invalid", "Alcance de vista previa desconocido.");
  }
  const maxEdge = Math.min(MAX_EDGE, Math.max(MIN_EDGE, Math.round(Number(options.maxEdge) || 0)));

  let doc: mupdf.PDFDocument;
  try {
    doc = openPdf(input);
  } catch (error) {
    if (isEngineError(error) && error.code === "pdf.encrypted") {
      sink.info({ pageCount: 0, encrypted: true, pages: [], thumbnails: 0 });
      return;
    }
    throw error;
  }

  using(doc, (pdf) => {
    const pageCount = pdf.countPages();
    const scoped = options.scope === "first" ? 1 : pageCount;
    const pages = Array.from({ length: scoped }, (_, index) => {
      try {
        return pageSize(pdf, index);
      } catch {
        return { width: 612, height: 792 };
      }
    });
    const thumbnails = Math.min(scoped, MAX_THUMBNAILS);
    sink.info({ pageCount, encrypted: false, pages, thumbnails });

    for (let index = 0; index < thumbnails; index++) {
      const size = pages[index];
      if (!size) continue;
      let thumbnail: PageThumbnail;
      try {
        thumbnail = render(pdf, index, size, maxEdge);
      } catch {
        continue;
      }
      sink.page(thumbnail);
    }
  });
}
