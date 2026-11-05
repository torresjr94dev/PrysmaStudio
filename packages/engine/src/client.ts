import type { EngineErrorCode, EngineEvent, EngineLoadEvent, EngineOp, EngineRequest, EngineResult, InputFile, PageThumbnail, PreviewInfo, PreviewOptions, RedactOptions, RedactScan } from "./protocol.ts";

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

export interface PreviewHandlers {
  onInfo: (info: PreviewInfo) => void;
  onPage: (thumbnail: PageThumbnail) => void;
  signal?: AbortSignal;
}

function transferablesOf(op: EngineOp): ArrayBuffer[] {
  const files: InputFile[] =
    op.op === "merge" || op.op === "imagesToPdf" || op.op === "cfdiToPdf"
      ? op.inputs
      : op.op === "ineSheet"
        ? [op.front, op.back]
        : op.op === "sign"
          ? [op.input, op.certificate, op.privateKey]
          : [op.input];
  return files.map((file) => file.bytes);
}

interface Task {
  request: EngineRequest;
  transfer: ArrayBuffer[];
  signal: AbortSignal | undefined;
  /** Devuelve true cuando el evento termina la tarea. */
  onEvent: (event: EngineEvent) => boolean;
  fail: (failure: EngineFailure) => void;
}

const CANCELLED = () => new EngineFailure("cancelled", "Operación cancelada.");

/**
 * Cliente del motor: cola FIFO, una tarea a la vez en el worker. Cancelar una tarea en cola solo la saca de
 * la cola; cancelar la que corre termina el worker (MuPDF no es interrumpible) y la siguiente crea uno nuevo.
 * Los ArrayBuffer de entrada se transfieren: quedan inutilizables para quien llama.
 */
export class EngineClient {
  readonly #createWorker: () => Worker;
  #worker: Worker | null = null;
  #current: Task | null = null;
  readonly #queue: Task[] = [];
  readonly #loadListeners = new Set<(event: EngineLoadEvent) => void>();

  constructor(createWorker: () => Worker) {
    this.#createWorker = createWorker;
  }

  /** Avisos de descarga del motor (la primera vez pesa ~10 MB). Devuelve la función para desuscribirse. */
  onLoad(listener: (event: EngineLoadEvent) => void): () => void {
    this.#loadListeners.add(listener);
    return () => this.#loadListeners.delete(listener);
  }

  run(op: EngineOp, options: RunOptions = {}): Promise<EngineResult> {
    return new Promise<EngineResult>((resolve, reject) => {
      this.#enqueue({
        request: { id: crypto.randomUUID(), kind: "run", op },
        transfer: transferablesOf(op),
        signal: options.signal,
        fail: reject,
        onEvent: (event) => {
          switch (event.type) {
            case "progress":
              options.onProgress?.(event.progress, event.stage);
              return false;
            case "done":
              resolve(event.result);
              return true;
            case "error":
              reject(new EngineFailure(event.code, event.detail));
              return true;
            default:
              return false;
          }
        },
      });
    });
  }

  /** Miniaturas progresivas: `onInfo` llega una vez, después un `onPage` por página renderizada. */
  preview(input: InputFile, options: PreviewOptions, handlers: PreviewHandlers): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#enqueue({
        request: { id: crypto.randomUUID(), kind: "preview", input, options },
        transfer: [input.bytes],
        signal: handlers.signal,
        fail: reject,
        onEvent: (event) => {
          switch (event.type) {
            case "preview.info":
              handlers.onInfo(event.info);
              return false;
            case "preview.page":
              handlers.onPage(event.thumbnail);
              return false;
            case "preview.done":
              resolve();
              return true;
            case "error":
              reject(new EngineFailure(event.code, event.detail));
              return true;
            default:
              return false;
          }
        },
      });
    });
  }

  /** Localiza datos personales en el texto del PDF sin modificarlo. */
  scan(input: InputFile, options: RedactOptions, extra: { signal?: AbortSignal } = {}): Promise<RedactScan> {
    return new Promise<RedactScan>((resolve, reject) => {
      this.#enqueue({
        request: { id: crypto.randomUUID(), kind: "scan", input, options },
        transfer: [input.bytes],
        signal: extra.signal,
        fail: reject,
        onEvent: (event) => {
          switch (event.type) {
            case "scan.done":
              resolve(event.scan);
              return true;
            case "error":
              reject(new EngineFailure(event.code, event.detail));
              return true;
            default:
              return false;
          }
        },
      });
    });
  }

  dispose(): void {
    for (const task of this.#queue.splice(0)) task.fail(CANCELLED());
    this.#current?.fail(CANCELLED());
    this.#current = null;
    this.#discardWorker();
  }

  #enqueue(task: Task): void {
    if (task.signal?.aborted) {
      task.fail(CANCELLED());
      return;
    }
    task.signal?.addEventListener(
      "abort",
      () => {
        if (this.#current === task) {
          this.#current = null;
          this.#discardWorker();
          task.fail(CANCELLED());
          this.#next();
          return;
        }
        const index = this.#queue.indexOf(task);
        if (index !== -1) {
          this.#queue.splice(index, 1);
          task.fail(CANCELLED());
        }
      },
      { once: true },
    );
    this.#queue.push(task);
    this.#next();
  }

  #next(): void {
    if (this.#current) return;
    const task = this.#queue.shift();
    if (!task) return;
    this.#current = task;
    const worker = this.#ensureWorker();
    worker.postMessage(task.request, task.transfer);
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = this.#createWorker();
    worker.addEventListener("message", (event: MessageEvent<EngineEvent>) => {
      const data = event.data;
      if (data.type === "engine.loading" || data.type === "engine.ready") {
        for (const listener of this.#loadListeners) listener(data);
        return;
      }
      const task = this.#current;
      if (!task || data.id !== task.request.id) return;
      if (task.onEvent(data)) {
        this.#current = null;
        this.#next();
      }
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      const task = this.#current;
      this.#current = null;
      this.#discardWorker();
      const outOfMemory = /memory|allocation/i.test(event.message ?? "");
      task?.fail(
        outOfMemory
          ? new EngineFailure("limits.exceeded", "El archivo es demasiado grande para la memoria de este dispositivo.")
          : new EngineFailure("internal", "El motor PDF se detuvo inesperadamente."),
      );
      this.#next();
    });
    this.#worker = worker;
    return worker;
  }

  #discardWorker(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
