// Contrato UI ↔ Engine Worker. Es la API principal del producto: casi todo corre aquí.
// Los códigos de error son los mismos que devuelve el servidor (problem+json.code).

export type Paper = "letter" | "oficio-mx";

export type Permission = "print" | "copy" | "modify" | "annotate";

export type CompressPreset = "lossless" | "balanced" | "max";

export type QuarterTurn = 0 | 90 | 180 | 270;

/** Una página del documento resultante: índice 0-based en el original + giro adicional. */
export interface ArrangedPage {
  source: number;
  rotate: QuarterTurn;
}

/** Determina el sufijo del archivo de salida de `arrange`. */
export type ArrangePurpose = "organize" | "rotate";

export type CompressTarget =
  | { kind: "preset"; preset: CompressPreset }
  | { kind: "maxBytes"; maxBytes: number };

export interface InputFile {
  name: string;
  bytes: ArrayBuffer;
}

export interface OutputFile {
  name: string;
  mime: "application/pdf";
  bytes: ArrayBuffer;
}

export type EngineOp =
  | { op: "merge"; inputs: InputFile[] }
  | { op: "split"; input: InputFile; mode: "ranges"; ranges: string }
  | { op: "split"; input: InputFile; mode: "every"; every: number }
  | { op: "rotate"; input: InputFile; angle: 90 | 180 | 270; pages?: string }
  | { op: "organize"; input: InputFile; pages: string }
  | { op: "arrange"; input: InputFile; pages: ArrangedPage[]; purpose: ArrangePurpose }
  | { op: "protect"; input: InputFile; userPassword: string; ownerPassword?: string; permissions: Permission[] }
  | { op: "unlock"; input: InputFile; password: string }
  | { op: "compress"; input: InputFile; target: CompressTarget }
  | { op: "imagesToPdf"; inputs: InputFile[]; paper: Paper | "fit" }
  | { op: "ineSheet"; front: InputFile; back: InputFile; paper: Paper };

export type EngineOpName = EngineOp["op"];

export type EngineErrorCode =
  | "pdf.corrupt"
  | "pdf.encrypted"
  | "pdf.wrong_password"
  | "input.invalid"
  | "input.unsupported_type"
  | "limits.exceeded"
  | "internal";

export interface EngineMetrics {
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
}

export interface EngineResult {
  outputs: OutputFile[];
  metrics: EngineMetrics;
  warnings: string[];
}

export interface PreviewOptions {
  /** "first": solo la portada (tarjetas de archivo). "all": todas las páginas (editores de páginas). */
  scope: "first" | "all";
  /** Lado mayor de cada miniatura en píxeles. */
  maxEdge: number;
}

/** Tamaño visible de una página en puntos PDF, ya con su /Rotate aplicado. */
export interface PageSize {
  width: number;
  height: number;
}

export interface PreviewInfo {
  pageCount: number;
  /** Protegido con contraseña de apertura: no hay miniaturas. */
  encrypted: boolean;
  /** Tamaños de las páginas incluidas en el alcance pedido. */
  pages: PageSize[];
  /** Cuántas miniaturas se van a enviar (las demás se muestran sin imagen). */
  thumbnails: number;
}

export interface PageThumbnail {
  index: number;
  jpeg: ArrayBuffer;
  width: number;
  height: number;
}

export type EngineRequest =
  | { id: string; kind: "run"; op: EngineOp }
  | { id: string; kind: "preview"; input: InputFile; options: PreviewOptions };

export type EngineEvent =
  | { type: "progress"; id: string; progress: number; stage: string }
  | { type: "done"; id: string; result: EngineResult }
  | { type: "error"; id: string; code: EngineErrorCode; detail: string }
  | { type: "preview.info"; id: string; info: PreviewInfo }
  | { type: "preview.page"; id: string; thumbnail: PageThumbnail }
  | { type: "preview.done"; id: string }
  | EngineLoadEvent;

/** Descarga del motor (WASM) dentro del worker. `total` es null cuando el servidor no informa el tamaño. */
export type EngineLoadEvent = { type: "engine.loading"; loaded: number; total: number | null } | { type: "engine.ready" };
