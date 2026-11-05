// Representación impresa de un CFDI como PDF, dibujada directamente con operadores de contenido
// PDF sobre MuPDF (sin HTML ni canvas: corre en el worker y el texto queda seleccionable).
// Tipografía base-14 (Helvetica / Courier) con codificación WinAnsi: no se incrusta ninguna fuente.
import * as mupdf from "mupdf";
import qrcode from "qrcode-generator";
import { savePdf, using } from "../pdf.ts";
import {
  EXPORTACION,
  FORMA_PAGO,
  IMPUESTO,
  METODO_PAGO,
  OBJETO_IMP,
  PERIODICIDAD_PAGO,
  REGIMEN_FISCAL,
  TIPO_COMPROBANTE,
  TIPO_CONTRATO,
  TIPO_DEDUCCION,
  TIPO_NOMINA,
  TIPO_OTRO_PAGO,
  TIPO_PERCEPCION,
  TIPO_REGIMEN,
  TIPO_RELACION,
  USO_CFDI,
  labeled,
} from "./catalogs.ts";
import { satVerificationUrl, timbreCadenaOriginal, type Cfdi, type CfdiTax } from "./model.ts";
import { amountInWords } from "./words.ts";

// ---------- Página y estilo ----------

const PAGE: [number, number] = [612, 792];
const MARGIN = 40;
const CONTENT_W = PAGE[0] - 2 * MARGIN;
const FOOTER_TOP = 70;
const LINE = 1.32;

type FontKey = "R" | "B" | "M";
const SIZE = { title: 15, h: 9.5, body: 8.5, small: 7.3, micro: 5.8 } as const;
const GRAY: Record<"text" | "muted" | "rule" | "fill" | "head", number> = { text: 0, muted: 0.38, rule: 0.72, fill: 0.94, head: 0.88 };

// ---------- Codificación WinAnsi (Anexo D del estándar PDF) ----------

const WINANSI_SPECIALS = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function winAnsiByte(codePoint: number): number | null {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
  return WINANSI_SPECIALS.get(codePoint) ?? null;
}

/** Sustituye lo que WinAnsi no puede representar: quita diacríticos raros y deja «?» en lo demás. */
export function sanitize(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (winAnsiByte(code) !== null) {
      out += char;
      continue;
    }
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      out += " ";
      continue;
    }
    const base = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += base.length === 1 && winAnsiByte(base.codePointAt(0) ?? 0) !== null ? base : "?";
  }
  return out;
}

/** Literal de cadena PDF en ASCII puro: los bytes altos van en octal para no depender de la codificación. */
export function pdfString(sanitized: string): string {
  let out = "(";
  for (const char of sanitized) {
    const byte = winAnsiByte(char.codePointAt(0) ?? 0x3f) ?? 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

function n(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// ---------- Formato ----------

function decimalsOf(raw: string): number {
  const fraction = raw.split(".")[1]?.replace(/0+$/, "") ?? "";
  return Math.min(6, Math.max(2, fraction.length));
}

function fmtNumber(raw: string, decimals = decimalsOf(raw)): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return value.toLocaleString("es-MX", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function money(raw: string | undefined, currency: string): string {
  if (raw === undefined) return "";
  const text = fmtNumber(raw);
  return currency === "MXN" ? `$${text}` : `${text} ${currency}`;
}

function quantity(raw: string): string {
  const fraction = raw.split(".")[1]?.replace(/0+$/, "") ?? "";
  return fmtNumber(raw, Math.min(6, fraction.length));
}

function fmtDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/.exec(iso);
  if (!match) return iso;
  const date = `${match[3]}/${match[2]}/${match[1]}`;
  return match[4] ? `${date} ${match[4]}` : date;
}

function fmtRate(tax: CfdiTax): string {
  if (tax.tipoFactor === "Exento") return "Exento";
  if (tax.tasaOCuota === undefined) return "";
  const value = Number(tax.tasaOCuota);
  if (!Number.isFinite(value)) return tax.tasaOCuota;
  if (tax.tipoFactor === "Cuota") return `cuota ${tax.tasaOCuota}`;
  return `${Number((value * 100).toFixed(4)).toLocaleString("es-MX", { maximumFractionDigits: 4 })}%`;
}

function taxLabel(tax: CfdiTax): string {
  return `${IMPUESTO[tax.impuesto] ?? tax.impuesto} ${fmtRate(tax)}`.trim();
}

/** ISO 8601 (P7W, P1Y2M) → «7 semanas», «1 año 2 meses». */
function fmtDuration(raw: string): string {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(raw);
  if (!match) return raw;
  const parts: string[] = [];
  const push = (count: string | undefined, one: string, many: string) => {
    if (count && Number(count) > 0) parts.push(`${count} ${Number(count) === 1 ? one : many}`);
  };
  push(match[1], "año", "años");
  push(match[2], "mes", "meses");
  push(match[3], "semana", "semanas");
  push(match[4], "día", "días");
  return parts.length > 0 ? parts.join(" ") : raw;
}

// ---------- Lienzo ----------

interface TextStyle {
  font?: FontKey;
  size?: number;
  gray?: number;
  align?: "left" | "right" | "center";
}

class Canvas {
  private readonly pages: string[] = [];
  private content = "";
  /** Borde superior del espacio libre, en coordenadas PDF (crece hacia arriba). */
  y = PAGE[1] - MARGIN;
  private readonly fonts: Record<FontKey, mupdf.Font>;
  private readonly advances: Record<FontKey, Map<number, number>> = { R: new Map(), B: new Map(), M: new Map() };

  constructor(fonts: Record<FontKey, mupdf.Font>) {
    this.fonts = fonts;
  }

  get pageCount(): number {
    return this.pages.length + 1;
  }

  get bottom(): number {
    return FOOTER_TOP;
  }

  newPage(): void {
    this.pages.push(this.content);
    this.content = "";
    this.y = PAGE[1] - MARGIN;
  }

  /** Salta de página si no caben `height` puntos. */
  ensure(height: number): void {
    if (this.y - height < this.bottom) this.newPage();
  }

  measure(text: string, font: FontKey = "R", size: number = SIZE.body): number {
    const cache = this.advances[font];
    let width = 0;
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0x3f;
      let advance = cache.get(code);
      if (advance === undefined) {
        const face = this.fonts[font];
        advance = face.advanceGlyph(face.encodeCharacter(code), 0);
        cache.set(code, advance);
      }
      width += advance;
    }
    return width * size;
  }

  wrap(text: string, width: number, font: FontKey = "R", size: number = SIZE.body): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      const words = sanitize(paragraph).split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      let line = "";
      for (let word of words) {
        while (this.measure(word, font, size) > width) {
          if (line) {
            lines.push(line);
            line = "";
          }
          let cut = 1;
          while (cut < word.length && this.measure(word.slice(0, cut + 1), font, size) <= width) cut++;
          lines.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        const candidate = line ? `${line} ${word}` : word;
        if (this.measure(candidate, font, size) <= width) line = candidate;
        else {
          if (line) lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  /** Una línea de texto con la línea base en `y`. `width` solo importa para alinear a la derecha o centrar. */
  text(text: string, x: number, y: number, style: TextStyle = {}, width = 0): void {
    const font = style.font ?? "R";
    const size = style.size ?? SIZE.body;
    const clean = sanitize(text);
    let left = x;
    if (style.align === "right") left = x + width - this.measure(clean, font, size);
    else if (style.align === "center") left = x + (width - this.measure(clean, font, size)) / 2;
    this.content += `BT /${font} ${n(size)} Tf ${n(style.gray ?? GRAY.text)} g 1 0 0 1 ${n(left)} ${n(y)} Tm ${pdfString(clean)} Tj ET\n`;
  }

  /** Párrafo envuelto que avanza el cursor. Devuelve la altura consumida. */
  paragraph(text: string, x: number, width: number, style: TextStyle = {}): number {
    const font = style.font ?? "R";
    const size = style.size ?? SIZE.body;
    const lines = this.wrap(text, width, font, size);
    const lineHeight = size * LINE;
    for (const line of lines) {
      this.ensure(lineHeight);
      this.text(line, x, this.y - size, style, width);
      this.y -= lineHeight;
    }
    return lines.length * lineHeight;
  }

  fillRect(x: number, y: number, width: number, height: number, gray: number): void {
    this.content += `${n(gray)} g ${n(x)} ${n(y)} ${n(width)} ${n(height)} re f\n`;
  }

  hline(x1: number, x2: number, y: number, gray = GRAY.rule, lineWidth = 0.5): void {
    this.content += `${n(gray)} G ${n(lineWidth)} w ${n(x1)} ${n(y)} m ${n(x2)} ${n(y)} l S\n`;
  }

  strokeRect(x: number, y: number, width: number, height: number, gray = GRAY.rule): void {
    this.content += `${n(gray)} G 0.5 w ${n(x)} ${n(y)} ${n(width)} ${n(height)} re S\n`;
  }

  /** QR como rectángulos negros (un solo `f` al final). */
  qr(data: string, x: number, y: number, size: number): void {
    // La librería trunca cada carácter a un byte: se le entrega la URL ya codificada en UTF-8.
    const binary = Array.from(new TextEncoder().encode(data), (byte) => String.fromCharCode(byte)).join("");
    const code = qrcode(0, "M");
    code.addData(binary, "Byte");
    code.make();
    const modules = code.getModuleCount();
    const quiet = 4;
    const cell = size / (modules + 2 * quiet);
    this.fillRect(x, y, size, size, 1);
    let ops = "0 g\n";
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (!code.isDark(row, col)) continue;
        const cx = x + (col + quiet) * cell;
        const cy = y + size - (row + quiet + 1) * cell;
        ops += `${cx.toFixed(3)} ${cy.toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re\n`;
      }
    }
    this.content += `${ops}f\n`;
  }

  /** Cierra la página actual y devuelve todas, con el pie («Página x de y») ya añadido. */
  finish(footer: (page: number, total: number) => string): string[] {
    this.pages.push(this.content);
    this.content = "";
    return this.pages.map((content, index) => content + footer(index + 1, this.pages.length));
  }
}

// ---------- Bloques ----------

interface Column {
  title: string;
  width: number | "flex";
  align?: "left" | "right";
}

const TABLE_FONT = SIZE.small;
const CELL_PAD_X = 4;
const CELL_PAD_Y = 3;

function resolveWidths(columns: Column[]): number[] {
  const fixed = columns.reduce((sum, column) => sum + (column.width === "flex" ? 0 : column.width), 0);
  const flexCount = columns.filter((column) => column.width === "flex").length;
  const flex = flexCount > 0 ? (CONTENT_W - fixed) / flexCount : 0;
  return columns.map((column) => (column.width === "flex" ? flex : column.width));
}

function tableHeader(canvas: Canvas, columns: Column[], widths: number[]): void {
  const height = TABLE_FONT * LINE + 2 * CELL_PAD_Y;
  canvas.fillRect(MARGIN, canvas.y - height, CONTENT_W, height, GRAY.head);
  let x = MARGIN;
  columns.forEach((column, index) => {
    const width = widths[index] ?? 0;
    canvas.text(column.title, x + CELL_PAD_X, canvas.y - CELL_PAD_Y - TABLE_FONT, { font: "B", size: TABLE_FONT, align: column.align ?? "left" }, width - 2 * CELL_PAD_X);
    x += width;
  });
  canvas.y -= height;
}

/** Tabla con encabezado repetido en cada página y celdas con salto de línea. */
function table(canvas: Canvas, columns: Column[], rows: string[][]): void {
  const widths = resolveWidths(columns);
  const lineHeight = TABLE_FONT * LINE;
  canvas.ensure(lineHeight * 3 + 4 * CELL_PAD_Y);
  tableHeader(canvas, columns, widths);
  for (const row of rows) {
    const cells = row.map((cell, index) => canvas.wrap(cell, (widths[index] ?? 0) - 2 * CELL_PAD_X, "R", TABLE_FONT));
    const lines = Math.max(1, ...cells.map((cell) => cell.length));
    const height = lines * lineHeight + 2 * CELL_PAD_Y;
    if (canvas.y - height < canvas.bottom) {
      canvas.newPage();
      tableHeader(canvas, columns, widths);
    }
    let x = MARGIN;
    cells.forEach((cell, index) => {
      const width = widths[index] ?? 0;
      const align = columns[index]?.align ?? "left";
      cell.forEach((line, lineIndex) => {
        canvas.text(line, x + CELL_PAD_X, canvas.y - CELL_PAD_Y - TABLE_FONT - lineIndex * lineHeight, { size: TABLE_FONT, align }, width - 2 * CELL_PAD_X);
      });
      x += width;
    });
    canvas.y -= height;
    canvas.hline(MARGIN, MARGIN + CONTENT_W, canvas.y, 0.85, 0.4);
  }
  canvas.y -= 6;
}

type GridItem = [label: string, value: string];

interface GridRow {
  row: GridItem[];
  wrapped: string[][];
  height: number;
}

function gridRows(canvas: Canvas, items: GridItem[], columns: number, width: number): GridRow[] {
  const present = items.filter(([, value]) => value.trim() !== "");
  const cellWidth = width / columns;
  const labelHeight = SIZE.small * LINE;
  const lineHeight = SIZE.body * LINE;
  const rows: GridRow[] = [];
  for (let start = 0; start < present.length; start += columns) {
    const row = present.slice(start, start + columns);
    const wrapped = row.map(([, value]) => canvas.wrap(value, cellWidth - 8, "R", SIZE.body));
    rows.push({ row, wrapped, height: labelHeight + Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + 4 });
  }
  return rows;
}

/** Altura que ocupará `grid` con estos datos: para reservar bloques que no deben partirse. */
function gridHeight(canvas: Canvas, items: GridItem[], columns = 3, width = CONTENT_W): number {
  const rows = gridRows(canvas, items, columns, width);
  return rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.height, 0) + 4;
}

/** Rejilla etiqueta/valor en N columnas; omite los valores vacíos. */
function grid(canvas: Canvas, items: GridItem[], columns = 3, x = MARGIN, width = CONTENT_W): void {
  const rows = gridRows(canvas, items, columns, width);
  if (rows.length === 0) return;
  const cellWidth = width / columns;
  const labelHeight = SIZE.small * LINE;
  const lineHeight = SIZE.body * LINE;
  for (const { row, wrapped, height } of rows) {
    canvas.ensure(height);
    row.forEach(([label], index) => {
      const cx = x + index * cellWidth;
      canvas.text(label.toUpperCase(), cx, canvas.y - SIZE.small, { size: SIZE.small, gray: GRAY.muted });
      (wrapped[index] ?? []).forEach((line, lineIndex) => {
        canvas.text(line, cx, canvas.y - labelHeight - SIZE.body - lineIndex * lineHeight, { size: SIZE.body });
      });
    });
    canvas.y -= height;
  }
  canvas.y -= 4;
}

/** Subtítulo en negrita que nunca queda huérfano: exige espacio para él y tres filas de tabla. */
function subheading(canvas: Canvas, title: string): void {
  canvas.ensure(SIZE.body * LINE + 2 + TABLE_FONT * LINE * 3 + 4 * CELL_PAD_Y);
  canvas.text(title, MARGIN, canvas.y - SIZE.body, { font: "B", size: SIZE.body });
  canvas.y -= SIZE.body * LINE + 2;
}

function sectionTitle(canvas: Canvas, title: string): void {
  canvas.ensure(SIZE.h * LINE + 30);
  canvas.y -= 6;
  canvas.text(title.toUpperCase(), MARGIN, canvas.y - SIZE.h, { font: "B", size: SIZE.h });
  canvas.y -= SIZE.h * LINE + 2;
  canvas.hline(MARGIN, MARGIN + CONTENT_W, canvas.y, 0.2, 0.8);
  canvas.y -= 8;
}

function monoParagraph(canvas: Canvas, label: string, value: string, x: number, width: number): void {
  canvas.ensure(SIZE.small * LINE + SIZE.micro * LINE * 2);
  canvas.text(label.toUpperCase(), x, canvas.y - SIZE.small, { size: SIZE.small, gray: GRAY.muted });
  canvas.y -= SIZE.small * LINE;
  canvas.paragraph(value, x, width, { font: "M", size: SIZE.micro });
  canvas.y -= 4;
}

// ---------- Secciones ----------

function header(canvas: Canvas, cfdi: Cfdi): void {
  const kind = TIPO_COMPROBANTE[cfdi.tipoDeComprobante];
  const title = cfdi.nomina ? "Recibo de nómina" : cfdi.pagos ? "Complemento de pago" : (kind?.title ?? "Comprobante");
  const top = canvas.y;
  canvas.text(title, MARGIN, top - SIZE.title, { font: "B", size: SIZE.title });
  canvas.text(`CFDI ${cfdi.version} · ${kind ? `${cfdi.tipoDeComprobante} - ${kind.label}` : cfdi.tipoDeComprobante}`, MARGIN, top - SIZE.title - SIZE.body * LINE - 2, {
    size: SIZE.body,
    gray: GRAY.muted,
  });
  canvas.text("Representación impresa de un CFDI", MARGIN, top - SIZE.title - SIZE.body * LINE * 2 - 2, { size: SIZE.body, gray: GRAY.muted });

  const rightWidth = 250;
  const rightX = MARGIN + CONTENT_W - rightWidth;
  const rows: Array<[string, string, FontKey]> = [
    ["Folio fiscal", cfdi.timbre?.uuid ?? "SIN TIMBRAR", "B"],
    ["Serie y folio", [cfdi.serie, cfdi.folio].filter(Boolean).join(" "), "R"],
    ["Fecha de emisión", fmtDate(cfdi.fecha), "R"],
    ["Lugar de expedición", cfdi.lugarExpedicion, "R"],
  ];
  let y = top - SIZE.small;
  for (const [label, value, font] of rows) {
    if (!value) continue;
    canvas.text(label.toUpperCase(), rightX, y, { size: SIZE.small, gray: GRAY.muted });
    canvas.text(value, rightX, y, { font, size: SIZE.body, align: "right" }, rightWidth);
    y -= SIZE.body * LINE + 1;
  }
  canvas.y = Math.min(top - SIZE.title - SIZE.body * LINE * 2 - 8, y - 2);
  canvas.hline(MARGIN, MARGIN + CONTENT_W, canvas.y, 0.2, 0.8);
  canvas.y -= 10;
}

function parties(canvas: Canvas, cfdi: Cfdi): void {
  const gap = 12;
  const width = (CONTENT_W - gap) / 2;
  const emisor: GridItem[] = [
    ["Nombre", cfdi.emisor.nombre ?? ""],
    ["RFC", cfdi.emisor.rfc],
    ["Régimen fiscal", labeled(REGIMEN_FISCAL, cfdi.emisor.regimenFiscal)],
    ["No. de certificado", cfdi.noCertificado ?? ""],
  ];
  const receptor: GridItem[] = [
    ["Nombre", cfdi.receptor.nombre ?? ""],
    ["RFC", cfdi.receptor.rfc],
    ["Domicilio fiscal (C.P.)", cfdi.receptor.domicilioFiscal ?? ""],
    ["Régimen fiscal", labeled(REGIMEN_FISCAL, cfdi.receptor.regimenFiscal)],
    ["Uso del CFDI", labeled(USO_CFDI, cfdi.receptor.usoCFDI)],
    ["Residencia fiscal", cfdi.receptor.residenciaFiscal ?? ""],
    ["Núm. registro id. tributario", cfdi.receptor.numRegIdTrib ?? ""],
  ];

  const column = (title: string, items: GridItem[], x: number): number => {
    const start = canvas.y;
    const strip = SIZE.small * LINE + 4;
    canvas.fillRect(x, start - strip, width, strip, GRAY.head);
    canvas.text(title, x + 4, start - SIZE.small - 2, { font: "B", size: SIZE.small });
    canvas.y = start - strip - 4;
    for (const [label, value] of items) {
      if (!value) continue;
      canvas.text(label.toUpperCase(), x + 4, canvas.y - SIZE.small, { size: SIZE.small, gray: GRAY.muted });
      canvas.y -= SIZE.small * LINE;
      canvas.paragraph(value, x + 4, width - 8, { font: label === "Nombre" ? "B" : "R", size: SIZE.body });
      canvas.y -= 2;
    }
    const end = canvas.y;
    canvas.y = start;
    return start - end;
  };

  // Se dibuja una vez para medir y, si no cabe, se repite en una página nueva (las partes nunca se parten).
  canvas.ensure(150);
  const left = column("EMISOR", emisor, MARGIN);
  const right = column("RECEPTOR", receptor, MARGIN + width + gap);
  canvas.y -= Math.max(left, right) + 10;
}

function voucherData(canvas: Canvas, cfdi: Cfdi): void {
  const items: GridItem[] = [
    ["Forma de pago", labeled(FORMA_PAGO, cfdi.formaPago)],
    ["Método de pago", labeled(METODO_PAGO, cfdi.metodoPago)],
    ["Moneda", cfdi.tipoCambio ? `${cfdi.moneda} (tipo de cambio ${cfdi.tipoCambio})` : cfdi.moneda],
    ["Exportación", labeled(EXPORTACION, cfdi.exportacion)],
    ["Condiciones de pago", cfdi.condicionesDePago ?? ""],
  ];
  grid(canvas, items, 3);
  for (const group of cfdi.relacionados) {
    canvas.paragraph(`CFDI relacionados · ${labeled(TIPO_RELACION, group.tipoRelacion)}: ${group.uuids.join(", ")}`, MARGIN, CONTENT_W, { size: SIZE.small });
    canvas.y -= 4;
  }
}

function concepts(canvas: Canvas, cfdi: Cfdi): void {
  sectionTitle(canvas, "Conceptos");
  const columns: Column[] = [
    { title: "Cant.", width: 42, align: "right" },
    { title: "Unidad", width: 58 },
    { title: "Clave", width: 62 },
    { title: "Descripción", width: "flex" },
    { title: "Valor unitario", width: 72, align: "right" },
    { title: "Descuento", width: 60, align: "right" },
    { title: "Importe", width: 72, align: "right" },
  ];
  const rows = cfdi.conceptos.map((item) => [
    quantity(item.cantidad),
    item.unidad ? `${item.claveUnidad}\n${item.unidad}` : item.claveUnidad,
    item.noIdentificacion ? `${item.claveProdServ}\n${item.noIdentificacion}` : item.claveProdServ,
    item.objetoImp && item.objetoImp !== "02" ? `${item.descripcion}\n${labeled(OBJETO_IMP, item.objetoImp)}` : item.descripcion,
    money(item.valorUnitario, cfdi.moneda),
    item.descuento ? money(item.descuento, cfdi.moneda) : "",
    money(item.importe, cfdi.moneda),
  ]);
  table(canvas, columns, rows);
}

function totals(canvas: Canvas, cfdi: Cfdi): void {
  const rows: Array<[string, string, boolean]> = [["Subtotal", money(cfdi.subTotal, cfdi.moneda), false]];
  if (cfdi.descuento) rows.push(["Descuento", `- ${money(cfdi.descuento, cfdi.moneda)}`, false]);
  for (const tax of cfdi.impuestos?.traslados ?? []) {
    if (tax.importe !== undefined) rows.push([`Traslado ${taxLabel(tax)}`, money(tax.importe, cfdi.moneda), false]);
  }
  for (const tax of cfdi.impuestos?.retenciones ?? []) {
    if (tax.importe !== undefined) rows.push([`Retención ${taxLabel(tax)}`, `- ${money(tax.importe, cfdi.moneda)}`, false]);
  }
  rows.push([cfdi.nomina ? "Neto a recibir" : "Total", money(cfdi.total, cfdi.moneda), true]);

  const boxWidth = 236;
  const boxX = MARGIN + CONTENT_W - boxWidth;
  const rowHeight = SIZE.body * LINE + 2;
  const boxHeight = rows.length * rowHeight + 10;
  const wordsWidth = CONTENT_W - boxWidth - 16;
  const words = cfdi.moneda === "XXX" ? "" : amountInWords(cfdi.total, cfdi.moneda);
  const wordsLines = words ? canvas.wrap(words, wordsWidth, "R", SIZE.small) : [];
  const wordsHeight = words ? SIZE.small * LINE * (wordsLines.length + 1) + 4 : 0;
  canvas.ensure(Math.max(boxHeight, wordsHeight) + 6);

  const top = canvas.y;
  let y = top - 6;
  for (const [label, value, strong] of rows) {
    if (strong) {
      canvas.hline(boxX, boxX + boxWidth, y + 2, 0.2, 0.8);
      y -= 3;
    }
    canvas.text(label, boxX + 4, y - SIZE.body, { font: strong ? "B" : "R", size: strong ? SIZE.h : SIZE.body });
    canvas.text(value, boxX, y - SIZE.body, { font: strong ? "B" : "R", size: strong ? SIZE.h : SIZE.body, align: "right" }, boxWidth - 4);
    y -= rowHeight;
  }
  if (words) {
    canvas.text("IMPORTE CON LETRA", MARGIN, top - 6 - SIZE.small, { size: SIZE.small, gray: GRAY.muted });
    wordsLines.forEach((line, index) => canvas.text(line, MARGIN, top - 6 - SIZE.small * LINE * (index + 1) - SIZE.small, { size: SIZE.small }));
  }
  canvas.y = top - Math.max(boxHeight, wordsHeight) - 6;
}

function payroll(canvas: Canvas, cfdi: Cfdi): void {
  const nomina = cfdi.nomina;
  if (!nomina) return;
  sectionTitle(canvas, `Nómina ${nomina.version} · ${labeled(TIPO_NOMINA, nomina.tipoNomina)}`);
  const r = nomina.receptor;
  grid(canvas, [
    ["Fecha de pago", fmtDate(nomina.fechaPago)],
    ["Periodo", `${fmtDate(nomina.fechaInicialPago)} al ${fmtDate(nomina.fechaFinalPago)}`],
    ["Días pagados", quantity(nomina.numDiasPagados)],
    ["Registro patronal", nomina.emisor.registroPatronal ?? ""],
    ["RFC patrón origen", nomina.emisor.rfcPatronOrigen ?? ""],
    ["CURP del patrón", nomina.emisor.curp ?? ""],
    ["Núm. de empleado", r.numEmpleado ?? ""],
    ["CURP", r.curp ?? ""],
    ["Núm. de seguridad social", r.numSeguridadSocial ?? ""],
    ["Puesto", r.puesto ?? ""],
    ["Departamento", r.departamento ?? ""],
    ["Riesgo del puesto", r.riesgoPuesto ? `Clase ${r.riesgoPuesto}` : ""],
    ["Inicio de relación laboral", r.fechaInicioRelLaboral ? fmtDate(r.fechaInicioRelLaboral) : ""],
    ["Antigüedad", r.antiguedad ? fmtDuration(r.antiguedad) : ""],
    ["Periodicidad de pago", labeled(PERIODICIDAD_PAGO, r.periodicidadPago)],
    ["Tipo de contrato", labeled(TIPO_CONTRATO, r.tipoContrato)],
    ["Tipo de régimen", labeled(TIPO_REGIMEN, r.tipoRegimen)],
    ["Tipo de jornada", r.tipoJornada ?? ""],
    ["Sindicalizado", r.sindicalizado ?? ""],
    ["Salario diario integrado", money(r.salarioDiarioIntegrado, cfdi.moneda)],
    ["Salario base de cotización", money(r.salarioBaseCotApor, cfdi.moneda)],
    ["Banco", r.banco ?? ""],
    ["Cuenta bancaria", r.cuentaBancaria ?? ""],
    ["Entidad federativa", r.claveEntFed ?? ""],
  ]);

  if (nomina.percepciones && nomina.percepciones.items.length > 0) {
    subheading(canvas, "Percepciones");
    table(
      canvas,
      [
        { title: "Tipo", width: 150 },
        { title: "Clave", width: 50 },
        { title: "Concepto", width: "flex" },
        { title: "Gravado", width: 80, align: "right" },
        { title: "Exento", width: 80, align: "right" },
      ],
      nomina.percepciones.items.map((item) => [labeled(TIPO_PERCEPCION, item.tipo), item.clave, item.concepto, money(item.gravado, cfdi.moneda), money(item.exento, cfdi.moneda)]),
    );
  }
  if (nomina.deducciones && nomina.deducciones.items.length > 0) {
    subheading(canvas, "Deducciones");
    table(
      canvas,
      [
        { title: "Tipo", width: 150 },
        { title: "Clave", width: 50 },
        { title: "Concepto", width: "flex" },
        { title: "Importe", width: 80, align: "right" },
      ],
      nomina.deducciones.items.map((item) => [labeled(TIPO_DEDUCCION, item.tipo), item.clave, item.concepto, money(item.importe, cfdi.moneda)]),
    );
  }
  if (nomina.otrosPagos.length > 0) {
    subheading(canvas, "Otros pagos");
    table(
      canvas,
      [
        { title: "Tipo", width: 150 },
        { title: "Clave", width: 50 },
        { title: "Concepto", width: "flex" },
        { title: "Subsidio causado", width: 80, align: "right" },
        { title: "Importe", width: 80, align: "right" },
      ],
      nomina.otrosPagos.map((item) => [
        labeled(TIPO_OTRO_PAGO, item.tipo),
        item.clave,
        item.concepto,
        item.subsidioCausado ? money(item.subsidioCausado, cfdi.moneda) : "",
        money(item.importe, cfdi.moneda),
      ]),
    );
  }
  grid(canvas, [
    ["Total percepciones", money(nomina.totalPercepciones, cfdi.moneda)],
    ["Total deducciones", money(nomina.totalDeducciones, cfdi.moneda)],
    ["Total otros pagos", money(nomina.totalOtrosPagos, cfdi.moneda)],
    ["Total gravado", money(nomina.percepciones?.totalGravado, cfdi.moneda)],
    ["Total exento", money(nomina.percepciones?.totalExento, cfdi.moneda)],
    ["Impuestos retenidos", money(nomina.deducciones?.totalImpuestosRetenidos, cfdi.moneda)],
  ]);
}

function payments(canvas: Canvas, cfdi: Cfdi): void {
  const pagos = cfdi.pagos;
  if (!pagos) return;
  sectionTitle(canvas, `Recepción de pagos ${pagos.version}`);
  if (pagos.montoTotalPagos) grid(canvas, [["Monto total de los pagos", money(pagos.montoTotalPagos, "MXN")]], 3);
  pagos.pagos.forEach((pago, index) => {
    subheading(canvas, `Pago ${index + 1}`);
    grid(canvas, [
      ["Fecha de pago", fmtDate(pago.fechaPago)],
      ["Forma de pago", labeled(FORMA_PAGO, pago.formaDePagoP)],
      ["Monto", money(pago.monto, pago.monedaP)],
      ["Moneda", pago.tipoCambioP ? `${pago.monedaP} (tipo de cambio ${pago.tipoCambioP})` : pago.monedaP],
      ["Núm. de operación", pago.numOperacion ?? ""],
      ["Cuenta ordenante", [pago.rfcEmisorCtaOrd, pago.ctaOrdenante].filter(Boolean).join(" · ")],
      ["Cuenta beneficiaria", [pago.rfcEmisorCtaBen, pago.ctaBeneficiario].filter(Boolean).join(" · ")],
    ]);
    if (pago.documentos.length > 0) {
      table(
        canvas,
        [
          { title: "Documento relacionado (folio fiscal)", width: 180 },
          { title: "Serie / folio", width: "flex" },
          { title: "Moneda", width: 40 },
          { title: "Parc.", width: 30, align: "right" },
          { title: "Saldo anterior", width: 66, align: "right" },
          { title: "Pagado", width: 66, align: "right" },
          { title: "Saldo insoluto", width: 66, align: "right" },
        ],
        pago.documentos.map((doc) => [
          doc.idDocumento,
          [doc.serie, doc.folio].filter(Boolean).join(" "),
          doc.monedaDR ?? "",
          doc.numParcialidad ?? "",
          money(doc.impSaldoAnt, doc.monedaDR ?? pago.monedaP),
          money(doc.impPagado, doc.monedaDR ?? pago.monedaP),
          money(doc.impSaldoInsoluto, doc.monedaDR ?? pago.monedaP),
        ]),
      );
    }
  });
}

function stamp(canvas: Canvas, cfdi: Cfdi): void {
  const timbre = cfdi.timbre;
  if (!timbre) {
    sectionTitle(canvas, "Timbre fiscal digital");
    const height = SIZE.body * LINE * 2 + 12;
    canvas.ensure(height);
    canvas.fillRect(MARGIN, canvas.y - height, CONTENT_W, height, GRAY.fill);
    canvas.text("Este comprobante no tiene Timbre Fiscal Digital.", MARGIN + 8, canvas.y - 6 - SIZE.body, { font: "B", size: SIZE.body });
    canvas.text("No ha sido certificado por el SAT y no tiene validez fiscal hasta que un PAC lo timbre.", MARGIN + 8, canvas.y - 6 - SIZE.body * LINE - SIZE.body, { size: SIZE.body });
    canvas.y -= height + 6;
    if (cfdi.sello) monoParagraph(canvas, "Sello digital del emisor", cfdi.sello, MARGIN, CONTENT_W);
    return;
  }

  const qrSize = 110;
  const textX = MARGIN + qrSize + 14;
  const textWidth = CONTENT_W - qrSize - 14;
  const cadena = timbreCadenaOriginal(timbre);
  const details: GridItem[] = [
    ["RFC del proveedor de certificación", timbre.rfcProvCertif],
    ["Fecha y hora de certificación", fmtDate(timbre.fechaTimbrado)],
    ["No. de serie del certificado del SAT", timbre.noCertificadoSAT],
    ["Leyenda", timbre.leyenda ?? ""],
  ];
  // El bloque entero (título, QR, sellos y datos del PAC) va en una sola página: se mide antes de dibujar.
  const estimate = (value: string) => SIZE.small * LINE + canvas.wrap(value, textWidth, "M", SIZE.micro).length * SIZE.micro * LINE + 4;
  const sellos = estimate(cfdi.sello ?? timbre.selloCFD) + estimate(timbre.selloSAT) + estimate(cadena);
  const needed = SIZE.h * LINE + 24 + Math.max(sellos, qrSize + 8) + gridHeight(canvas, details) + 8;
  canvas.ensure(needed);
  sectionTitle(canvas, "Timbre fiscal digital");

  const top = canvas.y;
  canvas.qr(satVerificationUrl(cfdi, timbre), MARGIN, top - qrSize, qrSize);
  canvas.strokeRect(MARGIN, top - qrSize, qrSize, qrSize, 0.85);
  monoParagraph(canvas, "Sello digital del CFDI", cfdi.sello ?? timbre.selloCFD, textX, textWidth);
  monoParagraph(canvas, "Sello digital del SAT", timbre.selloSAT, textX, textWidth);
  monoParagraph(canvas, "Cadena original del complemento de certificación digital del SAT", cadena, textX, textWidth);
  canvas.y = Math.min(canvas.y, top - qrSize - 8);
  grid(canvas, details);
}

// ---------- Documento ----------

/** Genera el PDF de la representación impresa. `warnings` recibe avisos para el usuario. */
export function renderCfdi(cfdi: Cfdi, warnings: string[]): ArrayBuffer {
  if (!cfdi.timbre) warnings.push("El CFDI no está timbrado: el PDF lo indica y no lleva código QR.");

  return using(new mupdf.PDFDocument(), (doc) => {
    const faces: Record<FontKey, mupdf.Font> = { R: new mupdf.Font("Helvetica"), B: new mupdf.Font("Helvetica-Bold"), M: new mupdf.Font("Courier") };
    try {
      const resources = { Font: { R: doc.addSimpleFont(faces.R, "Latin"), B: doc.addSimpleFont(faces.B, "Latin"), M: doc.addSimpleFont(faces.M, "Latin") } };
      const canvas = new Canvas(faces);

      header(canvas, cfdi);
      parties(canvas, cfdi);
      voucherData(canvas, cfdi);
      concepts(canvas, cfdi);
      totals(canvas, cfdi);
      payroll(canvas, cfdi);
      payments(canvas, cfdi);
      stamp(canvas, cfdi);

      const footerFor = (page: number, total: number): string => {
        const scratch = new Canvas(faces);
        scratch.hline(MARGIN, MARGIN + CONTENT_W, FOOTER_TOP - 8, GRAY.rule, 0.4);
        scratch.text("Este documento es una representación impresa de un CFDI", MARGIN, FOOTER_TOP - 10 - SIZE.small, { size: SIZE.small, align: "center" }, CONTENT_W);
        scratch.text(cfdi.timbre ? `Folio fiscal ${cfdi.timbre.uuid}` : "CFDI sin timbrar", MARGIN, MARGIN, { size: SIZE.small, gray: GRAY.muted });
        scratch.text(`Página ${page} de ${total}`, MARGIN, MARGIN, { size: SIZE.small, gray: GRAY.muted, align: "right" }, CONTENT_W);
        return scratch.finish(() => "")[0] ?? "";
      };

      for (const content of canvas.finish(footerFor)) {
        doc.insertPage(-1, doc.addPage([0, 0, PAGE[0], PAGE[1]], 0, resources, content));
      }
      return savePdf(doc);
    } finally {
      for (const face of Object.values(faces)) face.destroy();
    }
  });
}
