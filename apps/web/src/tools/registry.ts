import type { ArrangedPage, CompressTarget, EngineOp, InputFile, Paper, Permission, QuarterTurn } from "@prysmastudio/engine";
import type { IconName } from "../components/Icon.tsx";
import type { ServerStep } from "../lib/server.ts";

export type Values = Record<string, string | string[]>;

export interface Option {
  value: string;
  label: string;
  description?: string;
}

interface FieldBase {
  key: string;
  label: string;
  hint?: string;
  showIf?: (values: Values) => boolean;
}

export type Field =
  /** Opciones visibles a la vez: tarjetas (con descripción) o control segmentado (etiquetas cortas). */
  | (FieldBase & { type: "choice"; layout: "cards" | "segmented"; options: Option[] })
  | (FieldBase & { type: "select"; options: Option[] })
  | (FieldBase & { type: "text"; placeholder?: string; required?: boolean })
  | (FieldBase & { type: "password"; required?: boolean; autoComplete: "new-password" | "current-password" })
  | (FieldBase & { type: "number"; min: number; max: number; step: number; unit?: string })
  | (FieldBase & { type: "toggles"; options: Option[] });

/** Página en el editor visual. `turns` acumula cuartos de vuelta sin normalizar para animar el giro. */
export interface PageItem {
  key: string;
  source: number;
  turns: number;
}

export type PageEditMode = "organize" | "rotate" | "split";

export type Workspace =
  /** Varios archivos reordenables (unir, imágenes a PDF). */
  | { kind: "files"; accept: string; min: number; max: number; noun: { one: string; many: string } }
  /** Un solo archivo con vista previa de portada. */
  | { kind: "single"; accept: string }
  /** Un PDF con cuadrícula de páginas editable. */
  | { kind: "pages"; edit: PageEditMode }
  /** Archivos con un rol fijo (frente y reverso de la INE). */
  | { kind: "slots"; accept: string; slots: Array<{ key: string; label: string; hint: string }> };

export interface WorkInput {
  files: InputFile[];
  slots: Record<string, InputFile>;
  pages: PageItem[];
  /** Posiciones (0-based) después de las cuales se corta, en orden. */
  cuts: number[];
}

/** Lo que el editor visual sabe antes de leer los bytes: para validar sin tocar el motor. */
export interface EditSummary {
  pageCount: number;
  pages: PageItem[];
  cuts: number[];
}

export type Category = "tramites" | "organizar" | "optimizar" | "convertir" | "seguridad";

export const CATEGORIES: Array<{ id: Category; title: string }> = [
  { id: "tramites", title: "Trámites en México" },
  { id: "organizar", title: "Organizar" },
  { id: "optimizar", title: "Optimizar" },
  { id: "convertir", title: "Convertir a PDF" },
  { id: "seguridad", title: "Seguridad" },
];

interface ToolBase {
  slug: string;
  title: string;
  summary: string;
  category: Category;
  icon: IconName;
  /** Texto del botón principal. */
  action: string;
  workspace: Workspace;
  fields: Field[];
  defaults: Values;
  validate?: (values: Values, edit: EditSummary) => string | null;
}

export interface ClientTool extends ToolBase {
  runtime: "client";
  build: (input: WorkInput, values: Values) => EngineOp;
}

export interface ServerTool extends ToolBase {
  runtime: "server";
  serverTool: ServerStep["tool"];
  steps: (values: Values) => ServerStep[];
}

export type Tool = ClientTool | ServerTool;

export const PDF_ACCEPT = "application/pdf,.pdf";
export const IMAGE_ACCEPT = "image/jpeg,image/png,.jpg,.jpeg,.png";
export const OFFICE_ACCEPT = ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf";

const PAPER_OPTIONS: Option[] = [
  { value: "letter", label: "Carta" },
  { value: "oficio-mx", label: "Oficio" },
];

function str(values: Values, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value : "";
}

function list(values: Values, key: string): string[] {
  const value = values[key];
  return Array.isArray(value) ? value : [];
}

function first(input: WorkInput): InputFile {
  const file = input.files[0];
  if (!file) throw new Error("Falta el archivo");
  return file;
}

function slot(input: WorkInput, key: string): InputFile {
  const file = input.slots[key];
  if (!file) throw new Error(`Falta el archivo «${key}»`);
  return file;
}

export function normalizeTurns(turns: number): QuarterTurn {
  return ((((turns % 4) + 4) % 4) * 90) as QuarterTurn;
}

function arranged(pages: PageItem[]): ArrangedPage[] {
  return pages.map((page) => ({ source: page.source, rotate: normalizeTurns(page.turns) }));
}

/** Cortes → rangos 1-based para el motor: cortes en 2 y 5 de 8 páginas = "1-3,4-6,7-8". */
export function cutsToRanges(cuts: number[], pageCount: number): string {
  const bounds = [...new Set(cuts)].filter((cut) => cut >= 0 && cut < pageCount - 1).sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = 0;
  for (const cut of [...bounds, pageCount - 1]) {
    ranges.push(start === cut ? `${start + 1}` : `${start + 1}-${cut + 1}`);
    start = cut + 1;
  }
  return ranges.join(",");
}

/** Cortes que produce «cada N páginas», para dibujarlos en la cuadrícula. */
export function everyNCuts(every: number, pageCount: number): number[] {
  if (!Number.isInteger(every) || every < 1) return [];
  const cuts: number[] = [];
  for (let position = every - 1; position < pageCount - 1; position += every) cuts.push(position);
  return cuts;
}

export function splitCuts(values: Values, edit: Pick<EditSummary, "pageCount" | "cuts">): number[] {
  const mode = str(values, "mode");
  if (mode === "each") return everyNCuts(1, edit.pageCount);
  if (mode === "every") return everyNCuts(Number(str(values, "every")), edit.pageCount);
  return edit.cuts;
}

export const TOOLS: Tool[] = [
  {
    slug: "ine-ambos-lados",
    runtime: "client",
    category: "tramites",
    title: "INE por ambos lados",
    summary: "Frente y reverso de tu credencial en una sola hoja, a tamaño real y lista para imprimir.",
    icon: "idCard",
    action: "Crear hoja",
    workspace: {
      kind: "slots",
      accept: IMAGE_ACCEPT,
      slots: [
        { key: "front", label: "Frente", hint: "Foto o escaneo del frente" },
        { key: "back", label: "Reverso", hint: "Foto o escaneo del reverso" },
      ],
    },
    fields: [{ type: "choice", layout: "segmented", key: "paper", label: "Papel", options: PAPER_OPTIONS }],
    defaults: { paper: "letter" },
    build: (input, values) => ({
      op: "ineSheet",
      front: slot(input, "front"),
      back: slot(input, "back"),
      paper: str(values, "paper") as Paper,
    }),
  },
  {
    slug: "comprimir-pdf",
    runtime: "client",
    category: "tramites",
    title: "Comprimir PDF",
    summary: "Hazlo más ligero, o déjalo por debajo del peso que pide tu trámite.",
    icon: "compress",
    action: "Comprimir",
    workspace: { kind: "single", accept: PDF_ACCEPT },
    fields: [
      {
        type: "choice",
        layout: "cards",
        key: "mode",
        label: "Nivel de compresión",
        options: [
          { value: "target", label: "Que pese menos de…", description: "Para portales que limitan el tamaño." },
          { value: "balanced", label: "Equilibrado", description: "Buena calidad, bastante más ligero." },
          { value: "max", label: "Máxima", description: "Lo más ligero posible; las imágenes pierden detalle." },
          { value: "lossless", label: "Sin perder calidad", description: "Solo limpia y optimiza la estructura." },
        ],
      },
      {
        type: "number",
        key: "maxMB",
        label: "Peso máximo",
        unit: "MB",
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
    build: (input, values) => {
      const mode = str(values, "mode");
      const target: CompressTarget =
        mode === "target"
          ? { kind: "maxBytes", maxBytes: Math.round(Number(str(values, "maxMB")) * 1024 * 1024) }
          : { kind: "preset", preset: mode === "max" || mode === "lossless" ? mode : "balanced" };
      return { op: "compress", input: first(input), target };
    },
  },
  {
    slug: "unir-pdf",
    runtime: "client",
    category: "organizar",
    title: "Unir PDF",
    summary: "Junta varios PDF en uno. Arrástralos para elegir el orden.",
    icon: "merge",
    action: "Unir PDF",
    workspace: { kind: "files", accept: PDF_ACCEPT, min: 2, max: 200, noun: { one: "PDF", many: "PDF" } },
    fields: [],
    defaults: {},
    build: (input) => ({ op: "merge", inputs: input.files }),
  },
  {
    slug: "dividir-pdf",
    runtime: "client",
    category: "organizar",
    title: "Dividir PDF",
    summary: "Corta un PDF en varios archivos: marca dónde cortar o divide cada cierto número de páginas.",
    icon: "split",
    action: "Dividir",
    workspace: { kind: "pages", edit: "split" },
    fields: [
      {
        type: "choice",
        layout: "cards",
        key: "mode",
        label: "Cómo dividir",
        options: [
          { value: "custom", label: "Donde yo marque", description: "Haz clic entre dos páginas para cortar ahí." },
          { value: "every", label: "Cada N páginas", description: "Partes del mismo tamaño." },
          { value: "each", label: "Todas por separado", description: "Un archivo por página." },
        ],
      },
      { type: "number", key: "every", label: "Páginas por archivo", min: 1, max: 10_000, step: 1, showIf: (values) => str(values, "mode") === "every" },
    ],
    defaults: { mode: "custom", every: "2" },
    validate: (values, edit) => {
      if (edit.pageCount < 2) return "El PDF tiene una sola página: no hay nada que dividir.";
      if (str(values, "mode") === "every") {
        const every = Number(str(values, "every"));
        if (!Number.isInteger(every) || every < 1) return "Indica cuántas páginas lleva cada archivo.";
        if (every >= edit.pageCount) return `El PDF tiene ${edit.pageCount} páginas: usa un número menor.`;
      }
      return splitCuts(values, edit).length === 0 ? "Marca al menos un corte entre dos páginas." : null;
    },
    build: (input, values) => {
      const mode = str(values, "mode");
      if (mode === "every" || mode === "each") {
        return { op: "split", input: first(input), mode: "every", every: mode === "each" ? 1 : Number(str(values, "every")) };
      }
      return { op: "split", input: first(input), mode: "ranges", ranges: cutsToRanges(input.cuts, input.pages.length) };
    },
  },
  {
    slug: "organizar-pdf",
    runtime: "client",
    category: "organizar",
    title: "Organizar páginas",
    summary: "Arrastra para reordenar. Gira, duplica o elimina páginas.",
    icon: "organize",
    action: "Guardar PDF",
    workspace: { kind: "pages", edit: "organize" },
    fields: [],
    defaults: {},
    validate: (_values, edit) => (edit.pages.length === 0 ? "El PDF resultante necesita al menos una página." : null),
    build: (input) => ({ op: "arrange", input: first(input), pages: arranged(input.pages), purpose: "organize" }),
  },
  {
    slug: "rotar-pdf",
    runtime: "client",
    category: "organizar",
    title: "Rotar PDF",
    summary: "Haz clic en una página para girarla, o gíralas todas de una vez.",
    icon: "rotateCw",
    action: "Guardar PDF",
    workspace: { kind: "pages", edit: "rotate" },
    fields: [],
    defaults: {},
    validate: (_values, edit) => (edit.pages.every((page) => normalizeTurns(page.turns) === 0) ? "Gira al menos una página." : null),
    build: (input) => ({ op: "arrange", input: first(input), pages: arranged(input.pages), purpose: "rotate" }),
  },
  {
    slug: "ocr-pdf",
    runtime: "server",
    serverTool: "ocr",
    category: "optimizar",
    title: "Hacer PDF buscable (OCR)",
    summary: "Reconoce el texto de un escaneo para poder buscarlo y copiarlo.",
    icon: "scanText",
    action: "Reconocer texto",
    workspace: { kind: "single", accept: PDF_ACCEPT },
    fields: [
      {
        type: "choice",
        layout: "segmented",
        key: "language",
        label: "Idioma del documento",
        options: [
          { value: "spa", label: "Español" },
          { value: "spa+eng", label: "Español e inglés" },
          { value: "eng", label: "Inglés" },
        ],
      },
      {
        type: "choice",
        layout: "cards",
        key: "mode",
        label: "Páginas que ya tienen texto",
        options: [
          { value: "skip-text", label: "Dejarlas como están", description: "Solo reconoce las páginas escaneadas." },
          { value: "force", label: "Reconocerlas de nuevo", description: "Convierte todo a imagen y repite el OCR." },
        ],
      },
      {
        type: "choice",
        layout: "segmented",
        key: "output",
        label: "Formato",
        options: [
          { value: "pdf", label: "PDF" },
          { value: "pdfa-2b", label: "PDF/A-2b" },
        ],
        hint: "PDF/A es el formato de archivo a largo plazo que piden algunas dependencias.",
      },
    ],
    defaults: { language: "spa", mode: "skip-text", output: "pdf" },
    steps: (values) => [
      {
        tool: "ocr",
        languages: str(values, "language").split("+"),
        mode: str(values, "mode"),
        // Enderezar páginas torcidas: OCRmyPDF solo lo prohíbe con mode=redo, que la UI no ofrece.
        deskew: true,
        output: str(values, "output"),
      },
    ],
  },
  {
    slug: "imagenes-a-pdf",
    runtime: "client",
    category: "convertir",
    title: "Imágenes a PDF",
    summary: "Convierte fotos JPG o PNG en un PDF, una por página.",
    icon: "image",
    action: "Crear PDF",
    workspace: { kind: "files", accept: IMAGE_ACCEPT, min: 1, max: 200, noun: { one: "imagen", many: "imágenes" } },
    fields: [
      {
        type: "choice",
        layout: "segmented",
        key: "paper",
        label: "Tamaño de página",
        options: [...PAPER_OPTIONS, { value: "fit", label: "Igual a la imagen" }],
      },
    ],
    defaults: { paper: "letter" },
    build: (input, values) => ({ op: "imagesToPdf", inputs: input.files, paper: str(values, "paper") as Paper | "fit" }),
  },
  {
    slug: "word-a-pdf",
    runtime: "server",
    serverTool: "convert",
    category: "convertir",
    title: "Word, Excel o PowerPoint a PDF",
    summary: "Convierte documentos de Office y OpenDocument con LibreOffice.",
    icon: "fileText",
    action: "Convertir a PDF",
    workspace: { kind: "single", accept: OFFICE_ACCEPT },
    fields: [],
    defaults: {},
    steps: () => [{ tool: "convert" }],
  },
  {
    slug: "proteger-pdf",
    runtime: "client",
    category: "seguridad",
    title: "Proteger con contraseña",
    summary: "Cifra tu PDF con AES-256 y decide si se puede imprimir o copiar.",
    icon: "lock",
    action: "Proteger PDF",
    workspace: { kind: "single", accept: PDF_ACCEPT },
    fields: [
      { type: "password", key: "password", label: "Contraseña", required: true, autoComplete: "new-password" },
      { type: "password", key: "confirm", label: "Repite la contraseña", required: true, autoComplete: "new-password" },
      {
        type: "toggles",
        key: "permissions",
        label: "Quien lo abra podrá",
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
    build: (input, values) => ({
      op: "protect",
      input: first(input),
      userPassword: str(values, "password"),
      permissions: list(values, "permissions") as Permission[],
    }),
  },
  {
    slug: "desbloquear-pdf",
    runtime: "client",
    category: "seguridad",
    title: "Quitar contraseña",
    summary: "Si conoces la contraseña, genera una copia sin cifrado ni restricciones.",
    icon: "unlock",
    action: "Quitar contraseña",
    workspace: { kind: "single", accept: PDF_ACCEPT },
    fields: [
      {
        type: "password",
        key: "password",
        label: "Contraseña actual",
        autoComplete: "current-password",
        hint: "Déjala vacía si el PDF abre sin contraseña pero no deja imprimir o copiar.",
      },
    ],
    defaults: { password: "" },
    build: (input, values) => ({ op: "unlock", input: first(input), password: str(values, "password") }),
  },
];

export function findTool(slug: string): Tool | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

export function acceptOf(tool: Tool): string {
  return tool.workspace.kind === "pages" ? PDF_ACCEPT : tool.workspace.accept;
}

/** Herramientas visibles: las de cliente siempre; las de servidor solo si el servidor las ofrece. */
export function availableTools(capabilities: { tools: Array<{ id: string; available: boolean }> } | null | undefined): Tool[] {
  return TOOLS.filter(
    (tool) => tool.runtime === "client" || capabilities?.tools.some((item) => item.id === tool.serverTool && item.available),
  );
}
