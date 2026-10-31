// Contrato UI ↔ Engine Worker. Es la API principal del producto: casi todo corre aquí.
// Los códigos de error son los mismos que devuelve el servidor (problem+json.code).

export type Paper = "letter" | "oficio-mx";

export type Permission = "print" | "copy" | "modify" | "annotate";

export type CompressPreset = "lossless" | "balanced" | "max";

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

export interface EngineRequest {
  id: string;
  op: EngineOp;
}

export type EngineEvent =
  | { type: "progress"; id: string; progress: number; stage: string }
  | { type: "done"; id: string; result: EngineResult }
  | { type: "error"; id: string; code: EngineErrorCode; detail: string };
