import * as mupdf from "mupdf";
import { EngineError } from "../errors.ts";
import { LIMITS, assertInputs, baseName, openPdf, savePdf, using } from "../pdf.ts";
import type { InputFile, OutputFile } from "../protocol.ts";
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

/**
 * Reordenar, eliminar, extraer y duplicar páginas con una sola lista de rangos en el orden deseado:
 * "3,1-2" pone la 3 primero; omitir una página la elimina; repetirla la duplica.
 */
export function organize(input: InputFile, pages: string, report: Report): OutputFile[] {
  assertInputs([input]);

  return using(openPdf(input), (doc) => {
    const order = parsePageRanges(pages, doc.countPages()).flat();
    if (order.length > LIMITS.maxPages) throw new EngineError("limits.exceeded", `Máximo ${LIMITS.maxPages} páginas.`);
    report(0.3, "Reordenando páginas");
    doc.rearrangePages(order);
    report(0.8, "Guardando");
    return [pdfOutput(`${baseName(input.name)}-organizado.pdf`, savePdf(doc))];
  });
}
