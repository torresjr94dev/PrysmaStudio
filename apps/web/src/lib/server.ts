// Cliente del servidor opcional. Solo se usa en herramientas que el navegador no puede hacer
// (Office→PDF, OCR) y siempre con el usuario sabiendo que su archivo se sube.

export interface Capabilities {
  tools: Array<{ id: string; available: boolean; accepts: string[] }>;
  ocrLanguages: string[];
  limits: { maxUploadBytes: number; maxPages: number };
  requiresAccessKey: boolean;
}

export interface ServerStep {
  tool: "convert" | "ocr";
  [option: string]: unknown;
}

export interface ServerResult {
  blob: Blob;
  name: string;
  warnings: string[];
}

export class ServerFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ServerFailure";
    this.code = code;
    this.status = status;
  }
}

interface JobSnapshot {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: string;
  warnings: string[];
  error?: { code: string; title: string; detail?: string };
}

async function failureFrom(response: Response): Promise<ServerFailure> {
  try {
    const problem = (await response.json()) as { code?: string; title?: string; detail?: string };
    return new ServerFailure(problem.code ?? `http.${response.status}`, problem.detail ?? problem.title ?? "Error del servidor", response.status);
  } catch {
    return new ServerFailure(`http.${response.status}`, `El servidor respondió ${response.status}.`, response.status);
  }
}

export async function fetchCapabilities(signal?: AbortSignal): Promise<Capabilities | null> {
  try {
    const response = await fetch("/v1/capabilities", { signal: signal ?? null, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return (await response.json()) as Capabilities;
  } catch (error) {
    if (signal?.aborted) throw error;
    // Sin servidor configurado la app sigue funcionando: solo se ocultan las herramientas de servidor.
    return null;
  }
}

function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const encoded = /filename\*=utf-8''([^;]+)/i.exec(disposition);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return fallback;
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain?.[1] ?? fallback;
}

/**
 * Lee eventos SSE con fetch (EventSource no permite la cabecera Authorization, y el token del job
 * en la URL acabaría en logs). Devuelve el último estado terminal.
 */
async function followEvents(
  jobId: string,
  token: string,
  onProgress: (progress: number, stage: string) => void,
  signal: AbortSignal | undefined,
): Promise<JobSnapshot> {
  const init: RequestInit = { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" } };
  if (signal) init.signal = signal;
  const response = await fetch(`/v1/jobs/${encodeURIComponent(jobId)}/events`, init);
  if (!response.ok || !response.body) throw await failureFrom(response);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (!data) continue;
        const snapshot = JSON.parse(data) as JobSnapshot;
        onProgress(snapshot.progress, snapshot.stage);
        if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
          return snapshot;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new ServerFailure("internal", "Se perdió la conexión con el servidor.", 0);
}

export async function runServerJob(
  file: File,
  steps: ServerStep[],
  options: { accessKey?: string; onProgress: (progress: number, stage: string) => void; signal?: AbortSignal },
): Promise<ServerResult> {
  const form = new FormData();
  form.append("spec", JSON.stringify({ steps }));
  form.append("file", file, file.name);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.accessKey) headers["X-Access-Key"] = options.accessKey;
  const init: RequestInit = { method: "POST", body: form, headers };
  if (options.signal) init.signal = options.signal;

  options.onProgress(0, "Subiendo archivo");
  const created = await fetch("/v1/jobs", init);
  if (created.status !== 202) throw await failureFrom(created);
  const { jobId, jobToken } = (await created.json()) as { jobId: string; jobToken: string };
  const auth = { Authorization: `Bearer ${jobToken}` };

  try {
    const final = await followEvents(jobId, jobToken, options.onProgress, options.signal);
    if (final.status !== "completed") {
      throw new ServerFailure(final.error?.code ?? "internal", final.error?.detail ?? final.error?.title ?? "El trabajo falló.", 0);
    }
    const resultInit: RequestInit = { headers: auth };
    if (options.signal) resultInit.signal = options.signal;
    const result = await fetch(`/v1/jobs/${encodeURIComponent(jobId)}/result`, resultInit);
    if (!result.ok) throw await failureFrom(result);
    const fallback = `${file.name.replace(/\.[^.]+$/, "")}.pdf`;
    return {
      blob: await result.blob(),
      name: filenameFrom(result.headers.get("content-disposition"), fallback),
      warnings: final.warnings,
    };
  } finally {
    // Privacidad: en cuanto se descarga (o falla, o se cancela) se purga del servidor, sin esperar al TTL.
    void fetch(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", headers: auth, keepalive: true }).catch(() => undefined);
  }
}
