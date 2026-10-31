import type { CompressTarget, EngineOp, InputFile, Paper, Permission } from "@vitropdf/engine";
import type { ServerStep } from "../lib/server.ts";

export type Values = Record<string, string | string[]>;

interface FieldBase {
  key: string;
  label: string;
  hint?: string;
  showIf?: (values: Values) => boolean;
}

export type Field =
  | (FieldBase & { type: "select"; options: Array<{ value: string; label: string }> })
  | (FieldBase & { type: "text"; placeholder?: string; required?: boolean })
  | (FieldBase & { type: "password"; required?: boolean; autoComplete: "new-password" | "current-password" })
  | (FieldBase & { type: "number"; min: number; max: number; step: number })
  | (FieldBase & { type: "checkboxes"; options: Array<{ value: string; label: string }> });

export type FilesSpec =
  | { mode: "list"; accept: string; min: number; max: number; reorder: boolean }
  | { mode: "slots"; accept: string; slots: Array<{ key: string; label: string }> };

export interface ToolInputs {
  list: InputFile[];
  slots: Record<string, InputFile>;
}

interface ToolBase {
  slug: string;
  title: string;
  summary: string;
  icon: string;
  files: FilesSpec;
  fields: Field[];
  defaults: Values;
  validate?: (values: Values) => string | null;
}

export interface ClientTool extends ToolBase {
  runtime: "client";
  build: (inputs: ToolInputs, values: Values) => EngineOp;
}

export interface ServerTool extends ToolBase {
  runtime: "server";
  serverTool: ServerStep["tool"];
  steps: (values: Values) => ServerStep[];
}

export type Tool = ClientTool | ServerTool;

const PDF = "application/pdf,.pdf";
const IMAGES = "image/jpeg,image/png,.jpg,.jpeg,.png";
const OFFICE = ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf";

const PAPER_OPTIONS = [
  { value: "letter", label: "Carta" },
  { value: "oficio-mx", label: "Oficio (México)" },
];

function str(values: Values, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value : "";
}

function list(values: Values, key: string): string[] {
  const value = values[key];
  return Array.isArray(value) ? value : [];
}

function first(inputs: ToolInputs): InputFile {
  const file = inputs.list[0];
  if (!file) throw new Error("Falta el archivo");
  return file;
}

function slot(inputs: ToolInputs, key: string): InputFile {
  const file = inputs.slots[key];
  if (!file) throw new Error(`Falta el archivo «${key}»`);
  return file;
}

export const TOOLS: Tool[] = [
  {
    slug: "unir-pdf",
    runtime: "client",
    title: "Unir PDF",
    summary: "Junta varios PDF en uno, en el orden que elijas.",
    icon: "⊕",
    files: { mode: "list", accept: PDF, min: 2, max: 200, reorder: true },
    fields: [],
    defaults: {},
    build: (inputs) => ({ op: "merge", inputs: inputs.list }),
  },
  {
    slug: "comprimir-pdf",
    runtime: "client",
    title: "Comprimir PDF",
    summary: "Hazlo más ligero, o déjalo por debajo del peso que pide tu trámite.",
    icon: "⇲",
    files: { mode: "list", accept: PDF, min: 1, max: 1, reorder: false },
    fields: [
      {
        type: "select",
        key: "mode",
        label: "¿Cómo quieres comprimir?",
        options: [
          { value: "target", label: "Que pese menos de…" },
          { value: "balanced", label: "Equilibrado (recomendado)" },
          { value: "max", label: "Máxima compresión" },
          { value: "lossless", label: "Sin perder calidad" },
        ],
      },
      {
        type: "number",
        key: "maxMB",
        label: "Peso máximo (MB)",
        hint: "Muchos portales de trámites piden menos de 2 MB.",
        min: 0.1,
        max: 500,
        step: 0.1,
        showIf: (values) => str(values, "mode") === "target",
      },
    ],
    defaults: { mode: "balanced", maxMB: "2" },
    validate: (values) => {
      if (str(values, "mode") !== "target") return null;
      const mb = Number(str(values, "maxMB"));
      return Number.isFinite(mb) && mb >= 0.1 ? null : "Indica un peso máximo de al menos 0.1 MB.";
    },
    build: (inputs, values) => {
      const mode = str(values, "mode");
      const target: CompressTarget =
        mode === "target"
          ? { kind: "maxBytes", maxBytes: Math.round(Number(str(values, "maxMB")) * 1024 * 1024) }
          : { kind: "preset", preset: mode === "max" || mode === "lossless" ? mode : "balanced" };
      return { op: "compress", input: first(inputs), target };
    },
  },
  {
    slug: "ine-ambos-lados",
    runtime: "client",
    title: "INE por ambos lados",
    summary: "Frente y reverso de tu credencial en una sola hoja, a tamaño real y lista para imprimir.",
    icon: "▭",
    files: {
      mode: "slots",
      accept: IMAGES,
      slots: [
        { key: "front", label: "Frente" },
        { key: "back", label: "Reverso" },
      ],
    },
    fields: [{ type: "select", key: "paper", label: "Papel", options: PAPER_OPTIONS }],
    defaults: { paper: "letter" },
    build: (inputs, values) => ({
      op: "ineSheet",
      front: slot(inputs, "front"),
      back: slot(inputs, "back"),
      paper: str(values, "paper") as Paper,
    }),
  },
  {
    slug: "dividir-pdf",
    runtime: "client",
    title: "Dividir PDF",
    summary: "Separa un PDF por rangos de páginas o en partes iguales.",
    icon: "⫽",
    files: { mode: "list", accept: PDF, min: 1, max: 1, reorder: false },
    fields: [
      {
        type: "select",
        key: "mode",
        label: "Dividir",
        options: [
          { value: "ranges", label: "Por rangos" },
          { value: "every", label: "Cada N páginas" },
        ],
      },
      {
        type: "text",
        key: "ranges",
        label: "Rangos",
        placeholder: "1-3, 5, 8-z",
        hint: "Un archivo por rango. «z» es la última página.",
        required: true,
        showIf: (values) => str(values, "mode") === "ranges",
      },
      { type: "number", key: "every", label: "Páginas por archivo", min: 1, max: 10_000, step: 1, showIf: (values) => str(values, "mode") === "every" },
    ],
    defaults: { mode: "ranges", ranges: "", every: "1" },
    build: (inputs, values) =>
      str(values, "mode") === "every"
        ? { op: "split", input: first(inputs), mode: "every", every: Number(str(values, "every")) }
        : { op: "split", input: first(inputs), mode: "ranges", ranges: str(values, "ranges") },
  },
  {
    slug: "organizar-pdf",
    runtime: "client",
    title: "Organizar páginas",
    summary: "Reordena, elimina o duplica páginas escribiendo el orden que quieres.",
    icon: "☰",
    files: { mode: "list", accept: PDF, min: 1, max: 1, reorder: false },
    fields: [
      {
        type: "text",
        key: "pages",
        label: "Nuevo orden",
        placeholder: "3, 1-2, 5-z",
        hint: "Las páginas que no escribas se eliminan; si repites una, se duplica.",
        required: true,
      },
    ],
    defaults: { pages: "" },
    build: (inputs, values) => ({ op: "organize", input: first(inputs), pages: str(values, "pages") }),
  },
  {
    slug: "rotar-pdf",
    runtime: "client",
    title: "Rotar PDF",
    summary: "Gira todas las páginas o solo las que indiques.",
    icon: "↻",
    files: { mode: "list", accept: PDF, min: 1, max: 1, reorder: false },
    fields: [
      {
        type: "select",
        key: "angle",
        label: "Giro",
        options: [
          { value: "90", label: "90° a la derecha" },
          { value: "180", label: "180°" },
          { value: "270", label: "90° a la izquierda" },
        ],
      },
      { type: "text", key: "pages", label: "Páginas (opcional)", placeholder: "Todas", hint: "Ejemplo: 1, 3-5" },
    ],
    defaults: { angle: "90", pages: "" },
    build: (inputs, values) => {
      const pages = str(values, "pages").trim();
      const angle = Number(str(values, "angle")) as 90 | 180 | 270;
      return pages ? { op: "rotate", input: first(inputs), angle, pages } : { op: "rotate", input: first(inputs), angle };
    },
  },
  {
    slug: "proteger-pdf",
    runtime: "client",
    title: "Proteger con contraseña",
    summary: "Cifra tu PDF con AES-256 y decide si se puede imprimir o copiar.",
    icon: "🔒",
    files: { mode: "list", accept: PDF, min: 1, max: 1, reorder: false },
    fields: [
      { type: "password", key: "password", label: "Contraseña", required: true, autoComplete: "new-password" },
      { type: "password", key: "confirm", label: "Repite la contraseña", required: true, autoComplete: "new-password" },
      {
        type: "checkboxes",
        key: "permissions",
        label: "Quien la abra podrá…",
        options: [
          { value: "print", label: "Imprimir" },
          { value: "copy", label: "Copiar texto" },
          { value: "annotate", label: "Comentar y llenar formularios" },
          { value: "modify", label: "Modificar" },
        ],
      },
    ],
    defaults: { password: "", confirm: "", permissions: ["print"] },
    validate: (values) => {
      const password = str(values, "password");
      if (password.length < 6) return "Usa una contraseña de al menos 6 caracteres.";
      if (password !== str(values, "confirm")) return "Las contraseñas no coinciden.";
      if (password.includes(",")) return "La contraseña no puede contener comas.";
      return null;
    },
    build: (inputs, values) => ({
      op: "protect",
      input: first(inputs),
      userPassword: str(values, "password"),
      permissions: list(values, "permissions") as Permission[],
    }),
  },
  {
    slug: "desbloquear-pdf",
    runtime: "client",
    title: "Quitar contraseña",
    summary: "Si conoces la contraseña, genera una copia sin cifrado ni restricciones.",
    icon: "🔓",
    files: { mode: "list", accept: PDF, min: 1, max: 1, reorder: false },
    fields: [{ type: "password", key: "password", label: "Contraseña actual", autoComplete: "current-password" }],
    defaults: { password: "" },
    build: (inputs, values) => ({ op: "unlock", input: first(inputs), password: str(values, "password") }),
  },
  {
    slug: "imagenes-a-pdf",
    runtime: "client",
    title: "Imágenes a PDF",
    summary: "Convierte fotos JPG o PNG en un PDF, una por página.",
    icon: "▣",
    files: { mode: "list", accept: IMAGES, min: 1, max: 200, reorder: true },
    fields: [
      {
        type: "select",
        key: "paper",
        label: "Tamaño de página",
        options: [...PAPER_OPTIONS, { value: "fit", label: "Igual a la imagen" }],
      },
    ],
    defaults: { paper: "letter" },
    build: (inputs, values) => ({ op: "imagesToPdf", inputs: inputs.list, paper: str(values, "paper") as Paper | "fit" }),
  },
  {
    slug: "word-a-pdf",
    runtime: "server",
    serverTool: "convert",
    title: "Word, Excel o PowerPoint a PDF",
    summary: "Convierte documentos de Office y OpenDocument con LibreOffice.",
    icon: "W",
    files: { mode: "list", accept: OFFICE, min: 1, max: 1, reorder: false },
    fields: [],
    defaults: {},
    steps: () => [{ tool: "convert" }],
  },
  {
    slug: "ocr-pdf",
    runtime: "server",
    serverTool: "ocr",
    title: "Hacer PDF buscable (OCR)",
    summary: "Reconoce el texto de un escaneo para poder buscarlo y copiarlo.",
    icon: "Aa",
    files: { mode: "list", accept: PDF, min: 1, max: 1, reorder: false },
    fields: [
      {
        type: "select",
        key: "language",
        label: "Idioma del documento",
        options: [
          { value: "spa", label: "Español" },
          { value: "spa+eng", label: "Español e inglés" },
          { value: "eng", label: "Inglés" },
        ],
      },
      {
        type: "select",
        key: "mode",
        label: "Si ya tiene texto",
        options: [
          { value: "skip-text", label: "Saltar esas páginas" },
          { value: "force", label: "Rasterizar y repetir OCR" },
        ],
      },
      {
        type: "select",
        key: "output",
        label: "Formato",
        options: [
          { value: "pdf", label: "PDF" },
          { value: "pdfa-2b", label: "PDF/A-2b (archivo a largo plazo)" },
        ],
      },
    ],
    defaults: { language: "spa", mode: "skip-text", output: "pdf" },
    steps: (values) => [
      {
        tool: "ocr",
        languages: str(values, "language").split("+"),
        mode: str(values, "mode"),
        deskew: str(values, "mode") !== "redo",
        output: str(values, "output"),
      },
    ],
  },
];

export function findTool(slug: string): Tool | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
