import * as mupdf from "mupdf";
import { EngineError } from "../errors.ts";
import { LIMITS, assertInputs, baseName, openPdf, savePdf, using } from "../pdf.ts";
import type { ArrangePurpose, ArrangedPage, InputFile, OutputFile } from "../protocol.ts";
import { parsePageRanges, parsePageSet } from "../ranges.ts";
import type { Report } from "./types.ts";

const MAX_SPLIT_OUTPUTS = 500;

function pdfOutput(name: string, bytes: ArrayBuffer): OutputFile {
  return { name, mime: "application/pdf", bytes };
}

function graftPages(target: mupdf.PDFDocument, source: mupdf.PDFDocument, pages: Iterable<number>): void {
  // Un graft map por documento origen: los recursos compartidos (fuentes, imágenes) se copian una sola vez.
  using(target.newGraftMap(), (map) => {
    for (const page of pages) map.graftPage(-1, source, page);
  });
}

export function merge(inputs: InputFile[], report: Report): OutputFile[] {
  assertInputs(inputs);
  if (inputs.length < 2) throw new EngineError("input.invalid", "Selecciona al menos dos PDFs para unir.");

  return using(new mupdf.PDFDocument(), (out) => {
    inputs.forEach((file, index) => {
      using(openPdf(file), (source) => {
        if (out.countPages() + source.countPages() > LIMITS.maxPages) {
          throw new EngineError("limits.exceeded", `El resultado superaría ${LIMITS.maxPages} páginas.`);
        }
        graftPages(out, source, Array.from({ length: source.countPages() }, (_, i) => i));
      });
      report((index + 1) / inputs.length, `Uniendo ${index + 1} de ${inputs.length}`);
    });
    const first = inputs[0]?.name ?? "documento";
    return [pdfOutput(`${baseName(first)}-unido.pdf`, savePdf(out))];
  });
}

export function split(
  input: InputFile,
  spec: { mode: "ranges"; ranges: string } | { mode: "every"; every: number },
  report: Report,
): OutputFile[] {
  assertInputs([input]);
  return using(openPdf(input), (source) => {
    const pageCount = source.countPages();
    let groups: number[][];

    if (spec.mode === "ranges") {
      groups = parsePageRanges(spec.ranges, pageCount);
    } else {
      if (!Number.isInteger(spec.every) || spec.every < 1) {
        throw new EngineError("input.invalid", "El tamaño de cada parte debe ser un entero mayor que cero.");
      }
      groups = [];
      for (let start = 0; start < pageCount; start += spec.every) {
        groups.push(Array.from({ length: Math.min(spec.every, pageCount - start) }, (_, i) => start + i));
      }
    }

    if (groups.length > MAX_SPLIT_OUTPUTS) {
      throw new EngineError("limits.exceeded", `Se generarían ${groups.length} archivos; el máximo es ${MAX_SPLIT_OUTPUTS}.`);
    }

    const base = baseName(input.name);
    return groups.map((pages, index) => {
      const bytes = using(new mupdf.PDFDocument(), (out) => {
        graftPages(out, source, pages);
        return savePdf(out);
      });
      report((index + 1) / groups.length, `Generando parte ${index + 1} de ${groups.length}`);
      const first = (pages[0] ?? 0) + 1;
      const last = (pages[pages.length - 1] ?? 0) + 1;
      return pdfOutput(first === last ? `${base}-p${first}.pdf` : `${base}-p${first}-${last}.pdf`, bytes);
    });
  });
}

export function rotate(input: InputFile, angle: 90 | 180 | 270, pages: string | undefined, report: Report): OutputFile[] {
  assertInputs([input]);
  if (angle !== 90 && angle !== 180 && angle !== 270) {
    throw new EngineError("input.invalid", "El ángulo debe ser 90, 180 o 270 grados.");
  }

  return using(openPdf(input), (doc) => {
    const pageCount = doc.countPages();
    const targets = pages === undefined || pages.trim() === "" ? null : parsePageSet(pages, pageCount);

    for (let index = 0; index < pageCount; index++) {
      if (targets && !targets.has(index)) continue;
      using(doc.loadPage(index), (page) => {
        const pageObject = page.getObject();
        const current = pageObject.getInheritable("Rotate");
        const currentAngle = current.isNumber() ? current.asNumber() : 0;
        pageObject.put("Rotate", (((currentAngle + angle) % 360) + 360) % 360);
      });
      if (index % 25 === 0) report(index / pageCount, `Rotando página ${index + 1}`);
    }
    report(1, "Guardando");
    return [pdfOutput(`${baseName(input.name)}-rotado.pdf`, savePdf(doc))];
  });
}

const QUARTER_TURNS = new Set([0, 90, 180, 270]);
const ARRANGE_SUFFIX: Record<ArrangePurpose, string> = { organize: "organizado", rotate: "rotado" };

function normalizeAngle(angle: number): number {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

function isIdentity(order: number[], pageCount: number): boolean {
  return order.length === pageCount && order.every((page, index) => page === index);
}

/**
 * Construye el documento resultante página por página: orden, eliminación, duplicado y giro individual.
 *
 * Sin duplicados se reordena en sitio (conserva marcadores, formularios y metadatos). Con duplicados se
 * copian las páginas a un documento nuevo: `rearrangePages` reutiliza el MISMO objeto de página para cada
 * copia (árbol de páginas inválido, y girar una copia giraría todas), mientras que `graftPage` crea objetos
 * independientes que comparten contenido y recursos.
 */
export function arrange(
  input: InputFile,
  pages: ArrangedPage[],
  purpose: ArrangePurpose,
  report: Report,
  warnings: string[],
): OutputFile[] {
  assertInputs([input]);
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new EngineError("input.invalid", "El documento resultante debe tener al menos una página.");
  }
  if (pages.length > LIMITS.maxPages) throw new EngineError("limits.exceeded", `Máximo ${LIMITS.maxPages} páginas.`);
  if (!(purpose in ARRANGE_SUFFIX)) throw new EngineError("input.invalid", `Propósito desconocido: ${String(purpose)}.`);

  return using(openPdf(input), (source) => {
    const pageCount = source.countPages();
    for (const page of pages) {
      if (!Number.isInteger(page.source) || page.source < 0 || page.source >= pageCount) {
        throw new EngineError("input.invalid", `La página ${Number(page.source) + 1} no existe (el documento tiene ${pageCount}).`);
      }
      if (!QUARTER_TURNS.has(page.rotate)) throw new EngineError("input.invalid", "El giro debe ser 0, 90, 180 o 270 grados.");
    }

    const order = pages.map((page) => page.source);
    const duplicated = new Set(order).size !== order.length;
    let target = source;

    report(0.2, "Reordenando páginas");
    if (duplicated) {
      target = new mupdf.PDFDocument();
      graftPages(target, source, order);
      warnings.push("Como duplicaste páginas, el resultado no conserva los marcadores ni los formularios del original.");
    } else if (!isIdentity(order, pageCount)) {
      source.rearrangePages(order);
    }

    try {
      report(0.6, "Aplicando giros");
      pages.forEach((page, index) => {
        if (page.rotate === 0) return;
        const pageObject = target.findPage(index);
        const current = pageObject.getInheritable("Rotate");
        pageObject.put("Rotate", normalizeAngle((current.isNumber() ? current.asNumber() : 0) + page.rotate));
      });
      report(0.8, "Guardando");
      return [pdfOutput(`${baseName(input.name)}-${ARRANGE_SUFFIX[purpose]}.pdf`, savePdf(target))];
    } finally {
      if (target !== source) target.destroy();
    }
  });
}

/**
 * Reordenar, eliminar, extraer y duplicar páginas con una sola lista de rangos en el orden deseado:
 * "3,1-2" pone la 3 primero; omitir una página la elimina; repetirla la duplica.
 */
export function organize(input: InputFile, pages: string, report: Report, warnings: string[]): OutputFile[] {
  assertInputs([input]);
  const order = using(openPdf(input), (doc) => parsePageRanges(pages, doc.countPages()).flat());
  return arrange(input, order.map((source) => ({ source, rotate: 0 })), "organize", report, warnings);
}
