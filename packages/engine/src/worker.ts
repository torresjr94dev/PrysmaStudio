// Punto de entrada del Web Worker. El motor (≈10 MB de WASM) se importa de forma diferida para que
// el manejador de mensajes exista desde el primer instante y ningún mensaje se pierda durante la carga.
import type { EngineEvent, EngineOp, EngineRequest, InputFile } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

const engine = import("./engine.ts");
const errors = import("./errors.ts");

function post(event: EngineEvent, transfer: Transferable[] = []): void {
  self.postMessage(event, transfer);
}

const IMAGE_OPS = new Set<EngineOp["op"]>(["imagesToPdf", "ineSheet"]);

function isJpeg(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

/**
 * Normaliza fotos JPEG antes de pasarlas a MuPDF: aplica la orientación EXIF (las fotos de celular
 * suelen venir "acostadas"). Los PNG no se tocan: no traen orientación y recodificarlos perdería calidad.
 * Solo existe en el navegador; en otros entornos se omite.
 */
async function normalizePhoto(file: InputFile): Promise<InputFile> {
  if (!isJpeg(file.bytes)) return file;
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([file.bytes]), { imageOrientation: "from-image" });
  } catch {
    // Formato que el navegador no decodifica: se deja que MuPDF lo intente y reporte el error tipado.
    return file;
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    return { name: file.name, bytes: await blob.arrayBuffer() };
  } finally {
    bitmap.close();
  }
}

async function prepare(op: EngineOp): Promise<EngineOp> {
  if (!IMAGE_OPS.has(op.op)) return op;
  if (op.op === "imagesToPdf") return { ...op, inputs: await Promise.all(op.inputs.map(normalizePhoto)) };
  if (op.op === "ineSheet") return { ...op, front: await normalizePhoto(op.front), back: await normalizePhoto(op.back) };
  return op;
}

self.addEventListener("message", (event: MessageEvent<EngineRequest>) => {
  const { id, op } = event.data;
  void (async () => {
    try {
      const [{ runOp }, prepared] = await Promise.all([engine, prepare(op)]);
      let lastProgressAt = 0;
      const result = runOp(prepared, (progress, stage) => {
        const now = performance.now();
        if (now - lastProgressAt < 100 && progress < 1) return;
        lastProgressAt = now;
        post({ type: "progress", id, progress: Math.max(0, Math.min(1, progress)), stage });
      });
      post({ type: "done", id, result }, result.outputs.map((file) => file.bytes));
    } catch (error) {
      const { isEngineError } = await errors;
      if (isEngineError(error)) {
        post({ type: "error", id, code: error.code, detail: error.detail });
      } else {
        console.error("[vitropdf-engine]", error);
        post({ type: "error", id, code: "internal", detail: "Ocurrió un error inesperado al procesar el archivo." });
      }
    }
  })();
});
