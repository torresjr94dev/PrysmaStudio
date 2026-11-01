import { test as base, expect, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import * as mupdf from "mupdf";
import { zipFiles } from "../src/lib/zip.ts";

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** PDF mínimo escrito a mano: cada página dice «<label><n>» en texto real (extraíble). */
export function makePdf(pages: number, label: string, size: [number, number] = [612, 792]): FilePayload {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 64 Tf 72 ${size[1] - 160} Td (${label}${i + 1}) Tj ET`;
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let num = 1; num < objects.length; num++) {
    offsets[num] = body.length;
    body += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let num = 1; num < objects.length; num++) body += `${String(offsets[num]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(body, "latin1") };
}

/** PNG RGB generado con zlib: cuatro cuadrantes de color (sirve para INE e imágenes a PDF). */
export function makePng(width: number, height: number, name: string): FilePayload {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      const quadrant = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
      const color = [
        [220, 40, 40],
        [40, 180, 60],
        [40, 60, 220],
        [235, 235, 235],
      ][quadrant] ?? [0, 0, 0];
      raw[offset] = color[0] ?? 0;
      raw[offset + 1] = color[1] ?? 0;
      raw[offset + 2] = color[2] ?? 0;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { name, mimeType: "image/png", buffer: png };
}

/** PDF cifrado con contraseña de apertura, generado con MuPDF. */
export function makeEncryptedPdf(password: string): FilePayload {
  const source = makePdf(2, "S");
  const doc = mupdf.Document.openDocument(source.buffer, "application/pdf").asPDF();
  if (!doc) throw new Error("no es PDF");
  const buffer = doc.saveToBuffer(`encrypt=aes-256,user-password=${password},owner-password=${password}-dueño`);
  const bytes = Buffer.from(buffer.asUint8Array());
  buffer.destroy();
  doc.destroy();
  return { name: "protegido.pdf", mimeType: "application/pdf", buffer: bytes };
}

/** DOCX mínimo válido para LibreOffice, empaquetado con el mismo escritor ZIP que usa la app. */
export async function makeDocx(lines: string[]): Promise<FilePayload> {
  const xml = (text: string) => new Blob([text], { type: "application/xml" });
  const paragraphs = lines.map((line) => `<w:p><w:r><w:t>${line.replace(/[<&>]/g, "")}</w:t></w:r></w:p>`).join("");
  const zip = await zipFiles([
    {
      name: "[Content_Types].xml",
      blob: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      blob: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      blob: xml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
      ),
    },
  ]);
  return {
    name: "carta.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await zip.arrayBuffer()),
  };
}

export interface PdfSummary {
  pages: number;
  texts: string[];
  rotations: number[];
  encrypted: boolean;
}

export async function readPdf(path: string, password?: string): Promise<PdfSummary> {
  const doc = mupdf.Document.openDocument(await readFile(path), "application/pdf").asPDF();
  if (!doc) throw new Error("La descarga no es un PDF");
  const encrypted = doc.needsPassword();
  if (encrypted && password === undefined) {
    doc.destroy();
    return { pages: 0, texts: [], rotations: [], encrypted };
  }
  if (encrypted && password !== undefined && doc.authenticatePassword(password) === 0) {
    doc.destroy();
    throw new Error("Contraseña incorrecta para el PDF descargado");
  }
  const pages = doc.countPages();
  const texts: string[] = [];
  const rotations: number[] = [];
  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i);
    texts.push(page.toStructuredText("").asText().trim());
    page.destroy();
    const rotate = doc.findPage(i).getInheritable("Rotate");
    rotations.push(rotate.isNumber() ? rotate.asNumber() : 0);
  }
  doc.destroy();
  return { pages, texts, rotations, encrypted };
}

/** Número de entradas de un ZIP leyendo el registro de fin de directorio central. */
export async function zipEntries(path: string): Promise<number> {
  const bytes = await readFile(path);
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("No es un ZIP");
  return bytes.readUInt16LE(end + 10);
}

export async function saveDownload(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error("La descarga falló");
  return path;
}

/** Suelta archivos «desde el sistema operativo» sobre un elemento (DataTransfer real con File). */
export async function dropFiles(page: Page, selector: string, files: FilePayload[]): Promise<void> {
  const payload = files.map((file) => ({ name: file.name, mimeType: file.mimeType, base64: file.buffer.toString("base64") }));
  const dataTransfer = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const bytes = Uint8Array.from(atob(item.base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: item.mimeType }));
    }
    return transfer;
  }, payload);
  const target = page.locator(selector).first();
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}

/**
 * Arrastra una ficha con el ratón real hasta el cuarto izquierdo de otra: queda ANTES de ella.
 * dnd-kit exige superar la distancia de activación y recibir movimientos intermedios; `dragTo` de
 * Playwright hace un solo salto y el sensor nunca arranca.
 */
export async function dragSort(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("La ficha no es visible");
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width * 0.25, y: to.y + to.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 4, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.move(end.x + 1, end.y + 1, { steps: 2 });
  await page.mouse.up();
  // dnd-kit deja 50 ms un listener de captura que anula el `click` que sigue a un arrastre; un clic de
  // prueba en ese lapso nunca llega a React. La capa de arrastre se desmonta después de ese margen.
  await page.locator(".drag-overlay").waitFor({ state: "detached" });
}

/**
 * Falla la prueba si la CSP bloqueó algo o hubo errores no controlados en la página.
 *
 * También anula `beforeunload`: la app lo usa para no perder trabajo sin descargar, pero Chrome headless
 * se bloquea ~25 s al cerrar cada página que lo tiene activo y congela la siguiente prueba (medido:
 * la suite ×3 pasaba de 111 s a 19 min). Las pruebas no verifican ese aviso del navegador.
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        const original = window.addEventListener.bind(window);
        window.addEventListener = ((type: string, ...rest: unknown[]) =>
          type === "beforeunload" ? undefined : (original as (...args: unknown[]) => void)(type, ...rest)) as typeof window.addEventListener;
      });
      const problems: string[] = [];
      page.on("console", (message) => {
        const text = message.text();
        if (message.type() === "error" && /Content Security Policy|Refused to/i.test(text)) problems.push(text);
      });
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      await use();
      expect(problems, problems.join("\n")).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
