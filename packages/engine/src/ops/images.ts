import * as mupdf from "mupdf";
import { EngineError } from "../errors.ts";
import { PAPER_SIZES, assertInputs, baseName, openImage, savePdf, using } from "../pdf.ts";
import type { InputFile, OutputFile, Paper } from "../protocol.ts";
import type { Report } from "./types.ts";

type Box = { x: number; y: number; width: number; height: number };

const MARGIN = 36;
/** Lado mayor de la página en modo "ajustar a la imagen": el de una hoja Carta. */
const FIT_LONG_SIDE = 792;
/** Credencial ID-1 (INE): 85.60 × 53.98 mm en puntos PDF. */
const ID1 = { width: (85.6 * 72) / 25.4, height: (53.98 * 72) / 25.4 };

function n(value: number): string {
  return value.toFixed(3);
}

/** Ajusta (contain) una imagen dentro de una caja, centrada, sin deformarla. */
function containIn(box: Box, imageWidth: number, imageHeight: number): Box {
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

function drawImage(name: string, at: Box): string {
  return `q ${n(at.width)} 0 0 ${n(at.height)} ${n(at.x)} ${n(at.y)} cm /${name} Do Q\n`;
}

function addPage(doc: mupdf.PDFDocument, size: [number, number], xobjects: Record<string, mupdf.PDFObject>, content: string): void {
  const page = doc.addPage([0, 0, size[0], size[1]], 0, { XObject: xobjects }, content);
  doc.insertPage(-1, page);
}

export function imagesToPdf(inputs: InputFile[], paper: Paper | "fit", report: Report): OutputFile[] {
  assertInputs(inputs);
  if (paper !== "fit" && !(paper in PAPER_SIZES)) throw new EngineError("input.invalid", `Tamaño de papel desconocido: ${paper}.`);

  return using(new mupdf.PDFDocument(), (doc) => {
    inputs.forEach((file, index) => {
      using(openImage(file), (image) => {
        const imageWidth = image.getWidth();
        const imageHeight = image.getHeight();
        const ref = doc.addImage(image);
        const landscape = imageWidth > imageHeight;

        let size: [number, number];
        let area: Box;
        if (paper === "fit") {
          const scale = FIT_LONG_SIDE / Math.max(imageWidth, imageHeight);
          size = [imageWidth * scale, imageHeight * scale];
          area = { x: 0, y: 0, width: size[0], height: size[1] };
        } else {
          const [w, h] = PAPER_SIZES[paper];
          size = landscape ? [h, w] : [w, h];
          area = { x: MARGIN, y: MARGIN, width: size[0] - 2 * MARGIN, height: size[1] - 2 * MARGIN };
        }

        addPage(doc, size, { Im0: ref }, drawImage("Im0", containIn(area, imageWidth, imageHeight)));
      });
      report((index + 1) / inputs.length, `Agregando imagen ${index + 1} de ${inputs.length}`);
    });
    const first = inputs[0]?.name ?? "imagenes";
    return [{ name: `${baseName(first)}.pdf`, mime: "application/pdf", bytes: savePdf(doc) }];
  });
}

/** Credencial por ambos lados en una sola hoja, a tamaño real, con guía de corte. */
export function ineSheet(front: InputFile, back: InputFile, paper: Paper, report: Report): OutputFile[] {
  assertInputs([front, back]);
  const size = PAPER_SIZES[paper];
  if (!size) throw new EngineError("input.invalid", `Tamaño de papel desconocido: ${paper}.`);
  const [pageWidth, pageHeight] = size;

  const x = (pageWidth - ID1.width) / 2;
  const frontBox: Box = { x, y: pageHeight - 72 - ID1.height, width: ID1.width, height: ID1.height };
  const backBox: Box = { x, y: frontBox.y - 36 - ID1.height, width: ID1.width, height: ID1.height };

  return using(new mupdf.PDFDocument(), (doc) => {
    const xobjects: Record<string, mupdf.PDFObject> = {};
    let content = "";

    for (const [name, file, box] of [
      ["Front", front, frontBox],
      ["Back", back, backBox],
    ] as const) {
      using(openImage(file), (image) => {
        xobjects[name] = doc.addImage(image);
        content += drawImage(name, containIn(box, image.getWidth(), image.getHeight()));
      });
      content += `q 0.6 G 0.5 w [3 3] 0 d ${n(box.x)} ${n(box.y)} ${n(box.width)} ${n(box.height)} re S Q\n`;
      report(name === "Front" ? 0.5 : 0.9, name === "Front" ? "Colocando frente" : "Colocando reverso");
    }

    addPage(doc, size, xobjects, content);
    return [{ name: "credencial-ambos-lados.pdf", mime: "application/pdf", bytes: savePdf(doc) }];
  });
}
