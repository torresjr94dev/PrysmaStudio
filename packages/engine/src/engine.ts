import { EngineError } from "./errors.ts";
import { compress } from "./ops/compress.ts";
import { imagesToPdf, ineSheet } from "./ops/images.ts";
import { protect, unlock } from "./ops/security.ts";
import { arrange, merge, organize, rotate, split } from "./ops/structure.ts";
import { preview, type PreviewSink } from "./ops/preview.ts";
import type { Report } from "./ops/types.ts";
import { resetMupdfWarnings, takeMupdfWarnings } from "./pdf.ts";
import type { EngineOp, EngineResult, InputFile, OutputFile, PreviewOptions } from "./protocol.ts";

function inputsOf(op: EngineOp): InputFile[] {
  switch (op.op) {
    case "merge":
    case "imagesToPdf":
      return op.inputs;
    case "ineSheet":
      return [op.front, op.back];
    default:
      return [op.input];
  }
}

function execute(op: EngineOp, report: Report, warnings: string[]): OutputFile[] {
  switch (op.op) {
    case "merge":
      return merge(op.inputs, report);
    case "split":
      return split(op.input, op.mode === "ranges" ? { mode: "ranges", ranges: op.ranges } : { mode: "every", every: op.every }, report);
    case "rotate":
      return rotate(op.input, op.angle, op.pages, report);
    case "organize":
      return organize(op.input, op.pages, report, warnings);
    case "arrange":
      return arrange(op.input, op.pages, op.purpose, report, warnings);
    case "protect":
      return protect(op.input, op.userPassword, op.ownerPassword, op.permissions, report);
    case "unlock":
      return unlock(op.input, op.password, report, warnings);
    case "compress":
      return compress(op.input, op.target, report, warnings);
    case "imagesToPdf":
      return imagesToPdf(op.inputs, op.paper, report);
    case "ineSheet":
      return ineSheet(op.front, op.back, op.paper, report);
    default: {
      const unknown: never = op;
      throw new EngineError("input.invalid", `Operación desconocida: ${JSON.stringify(unknown)}`);
    }
  }
}

/** Traduce las advertencias técnicas de MuPDF a algo accionable para el usuario. */
function summarizeMupdfWarnings(raw: string[]): string[] {
  const summary: string[] = [];
  if (raw.some((message) => /repair/i.test(message))) {
    summary.push("Uno de los PDFs estaba dañado y se reparó automáticamente: revisa el resultado.");
  }
  return summary;
}

export function runOp(op: EngineOp, report: Report): EngineResult {
  const started = performance.now();
  const inputBytes = inputsOf(op).reduce((sum, file) => sum + file.bytes.byteLength, 0);
  const warnings: string[] = [];

  resetMupdfWarnings();
  const outputs = execute(op, report, warnings);
  warnings.push(...summarizeMupdfWarnings(takeMupdfWarnings()));

  return {
    outputs,
    warnings,
    metrics: {
      inputBytes,
      outputBytes: outputs.reduce((sum, file) => sum + file.bytes.byteLength, 0),
      durationMs: Math.round(performance.now() - started),
    },
  };
}

export function runPreview(input: InputFile, options: PreviewOptions, sink: PreviewSink): void {
  resetMupdfWarnings();
  try {
    preview(input, options, sink);
  } finally {
    // Las advertencias de una vista previa no deben filtrarse a la siguiente operación.
    takeMupdfWarnings();
  }
}
