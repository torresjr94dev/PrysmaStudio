// Punto de entrada del Web Worker. El motor (≈10 MB de WASM) se importa de forma diferida para que
// el manejador de mensajes exista desde el primer instante y ningún mensaje se pierda durante la carga.
import type { EngineEvent, EngineOp, EngineRequest, InputFile, PreviewOptions, RedactOptions } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

function post(event: EngineEvent, transfer: Transferable[] = []): void {
  self.postMessage(event, transfer);
}

/**
 * Progreso de descarga del motor. MuPDF carga su .wasm con el fetch global del worker, así que se
 * envuelve la respuesta para contar bytes sin tocar la librería. La cabecera Content-Length solo sirve
 * si el cuerpo no viene comprimido al vuelo (entonces mide bytes comprimidos y no cuadraría).
 */
function installLoadReporter(): void {
  const nativeFetch = self.fetch.bind(self);
  self.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\.wasm(\?|$)/.test(url) || !response.ok || !response.body) return response;
    const declared = Number(response.headers.get("content-length"));
    const total = response.headers.get("content-encoding") || !Number.isFinite(declared) || declared <= 0 ? null : declared;
    let loaded = 0;
    let reportedAt = 0;
    post({ type: "engine.loading", loaded, total });
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          loaded += chunk.byteLength;
          const now = performance.now();
          if (now - reportedAt > 80) {
            reportedAt = now;
            post({ type: "engine.loading", loaded, total });
          }
          controller.enqueue(chunk);
        },
        flush() {
          post({ type: "engine.loading", loaded, total: total ?? loaded });
        },
      }),
    );
    return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

installLoadReporter();

const engine = import("./engine.ts");
const errors = import("./errors.ts");

void engine.then(
  () => post({ type: "engine.ready" }),
  () => undefined,
);

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

async function reportFailure(id: string, error: unknown): Promise<void> {
  const { isEngineError } = await errors;
  if (isEngineError(error)) {
    post({ type: "error", id, code: error.code, detail: error.detail });
  } else {
    console.error("[prysma-engine]", error);
    post({ type: "error", id, code: "internal", detail: "Ocurrió un error inesperado al procesar el archivo." });
  }
}

async function handleRun(id: string, op: EngineOp): Promise<void> {
  const [{ runOp }, prepared] = await Promise.all([engine, prepare(op)]);
  let lastProgressAt = 0;
  const result = runOp(prepared, (progress, stage) => {
    const now = performance.now();
    if (now - lastProgressAt < 100 && progress < 1) return;
    lastProgressAt = now;
    post({ type: "progress", id, progress: Math.max(0, Math.min(1, progress)), stage });
  });
  post({ type: "done", id, result }, result.outputs.map((file) => file.bytes));
}

async function handlePreview(id: string, input: InputFile, options: PreviewOptions): Promise<void> {
  const { runPreview } = await engine;
  runPreview(input, options, {
    info: (info) => post({ type: "preview.info", id, info }),
    page: (thumbnail) => post({ type: "preview.page", id, thumbnail }, [thumbnail.jpeg]),
  });
  post({ type: "preview.done", id });
}

async function handleScan(id: string, input: InputFile, options: RedactOptions): Promise<void> {
  const { runScan } = await engine;
  post({ type: "scan.done", id, scan: runScan(input, options) });
}

self.addEventListener("message", (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.kind === "preview") await handlePreview(request.id, request.input, request.options);
      else if (request.kind === "scan") await handleScan(request.id, request.input, request.options);
      else await handleRun(request.id, request.op);
    } catch (error) {
      await reportFailure(request.id, error);
    }
  })();
});
