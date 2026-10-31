import type { EngineErrorCode, EngineEvent, EngineOp, EngineRequest, EngineResult, InputFile } from "./protocol.ts";

/** Error recibido del worker, con el mismo código que usa el servidor. */
export class EngineFailure extends Error {
  readonly code: EngineErrorCode | "cancelled";

  constructor(code: EngineErrorCode | "cancelled", detail: string) {
    super(detail);
    this.name = "EngineFailure";
    this.code = code;
  }
}

export interface RunOptions {
  onProgress?: (progress: number, stage: string) => void;
  signal?: AbortSignal;
}

function transferablesOf(op: EngineOp): ArrayBuffer[] {
  const files: InputFile[] =
    op.op === "merge" || op.op === "imagesToPdf" ? op.inputs : op.op === "ineSheet" ? [op.front, op.back] : [op.input];
  return files.map((file) => file.bytes);
}

/**
 * Cliente del motor. Una operación a la vez; cancelar termina el worker (MuPDF no es interrumpible)
 * y el siguiente `run` crea uno nuevo. Los ArrayBuffer de entrada se transfieren: quedan inutilizables.
 */
export class EngineClient {
  readonly #createWorker: () => Worker;
  #worker: Worker | null = null;
  #busy = false;

  constructor(createWorker: () => Worker) {
    this.#createWorker = createWorker;
  }

  run(op: EngineOp, options: RunOptions = {}): Promise<EngineResult> {
    if (this.#busy) return Promise.reject(new EngineFailure("internal", "Ya hay una operación en curso."));
    if (options.signal?.aborted) return Promise.reject(new EngineFailure("cancelled", "Operación cancelada."));

    const worker = (this.#worker ??= this.#createWorker());
    const id = crypto.randomUUID();
    this.#busy = true;

    return new Promise<EngineResult>((resolve, reject) => {
      const cleanup = () => {
        this.#busy = false;
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const onMessage = (event: MessageEvent<EngineEvent>) => {
        const data = event.data;
        if (data.id !== id) return;
        if (data.type === "progress") {
          options.onProgress?.(data.progress, data.stage);
        } else if (data.type === "done") {
          cleanup();
          resolve(data.result);
        } else {
          cleanup();
          reject(new EngineFailure(data.code, data.detail));
        }
      };

      const onError = (event: ErrorEvent) => {
        cleanup();
        this.#discardWorker();
        const outOfMemory = /memory|allocation/i.test(event.message ?? "");
        reject(
          outOfMemory
            ? new EngineFailure("limits.exceeded", "El archivo es demasiado grande para la memoria de este dispositivo.")
            : new EngineFailure("internal", "El motor PDF se detuvo inesperadamente."),
        );
      };

      const onAbort = () => {
        cleanup();
        this.#discardWorker();
        reject(new EngineFailure("cancelled", "Operación cancelada."));
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const request: EngineRequest = { id, op };
      worker.postMessage(request, transferablesOf(op));
    });
  }

  dispose(): void {
    this.#discardWorker();
  }

  #discardWorker(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
