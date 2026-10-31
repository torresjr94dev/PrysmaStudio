import { EngineFailure, type EngineMetrics, type InputFile } from "@vitropdf/engine";
import { useEffect, useRef, useState } from "react";
import { Dropzone } from "../components/Dropzone.tsx";
import { OptionsForm } from "../components/OptionsForm.tsx";
import { engine } from "../lib/engine.ts";
import { clientByteBudget, downloadBlob, formatBytes, toInput } from "../lib/files.ts";
import { linkHandler, useDocumentTitle } from "../lib/router.ts";
import { ServerFailure, runServerJob, type Capabilities } from "../lib/server.ts";
import type { Tool, ToolInputs, Values } from "../tools/registry.ts";

const ACCESS_KEY_STORAGE = "vitropdf:access-key";

interface Result {
  name: string;
  blob: Blob;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running"; progress: number; stage: string }
  | { kind: "done"; results: Result[]; warnings: string[]; metrics: EngineMetrics | null }
  | { kind: "error"; message: string };

function readStoredKey(): string {
  try {
    return window.localStorage.getItem(ACCESS_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function storeKey(value: string): void {
  try {
    if (value) window.localStorage.setItem(ACCESS_KEY_STORAGE, value);
    else window.localStorage.removeItem(ACCESS_KEY_STORAGE);
  } catch {
    // Almacenamiento bloqueado (modo privado): la llave vive solo en memoria durante la sesión.
  }
}

function describeMetrics(metrics: EngineMetrics): string {
  const seconds = (metrics.durationMs / 1000).toFixed(1);
  if (metrics.outputBytes < metrics.inputBytes) {
    const saved = Math.round((1 - metrics.outputBytes / metrics.inputBytes) * 100);
    return `De ${formatBytes(metrics.inputBytes)} a ${formatBytes(metrics.outputBytes)} (−${saved} %) en ${seconds} s.`;
  }
  return `Listo en ${seconds} s.`;
}

interface Props {
  tool: Tool;
  capabilities: Capabilities | null | undefined;
}

export function ToolPage({ tool, capabilities }: Props) {
  useDocumentTitle(`${tool.title} · vitroPDF`);
  const [files, setFiles] = useState<File[]>([]);
  const [slots, setSlots] = useState<Record<string, File>>({});
  const [values, setValues] = useState<Values>(tool.defaults);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [accessKey, setAccessKey] = useState(readStoredKey);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const serverInfo = tool.runtime === "server" ? capabilities?.tools.find((item) => item.id === tool.serverTool) : undefined;
  const checkingServer = tool.runtime === "server" && capabilities === undefined;
  const serverReady = tool.runtime === "client" || serverInfo?.available === true;
  const needsKey = tool.runtime === "server" && capabilities?.requiresAccessKey === true;

  const spec = tool.files;
  const hasFiles = spec.mode === "list" ? files.length >= spec.min : spec.slots.every((item) => slots[item.key]);
  const running = phase.kind === "running";

  const addFiles = (incoming: File[]) => {
    if (spec.mode !== "list") return;
    setFiles((current) => (spec.max === 1 ? incoming.slice(0, 1) : [...current, ...incoming].slice(0, spec.max)));
    setPhase({ kind: "idle" });
  };

  const move = (index: number, delta: number) => {
    setFiles((current) => {
      const next = [...current];
      const target = index + delta;
      const item = next[index];
      const other = next[target];
      if (item === undefined || other === undefined) return current;
      next[index] = other;
      next[target] = item;
      return next;
    });
  };

  async function run() {
    const invalid = tool.validate?.(values) ?? null;
    if (invalid) {
      setPhase({ kind: "error", message: invalid });
      return;
    }
    const selected = spec.mode === "list" ? files : Object.values(slots);
    const total = selected.reduce((sum, file) => sum + file.size, 0);

    const controller = new AbortController();
    abortRef.current = controller;
    const onProgress = (progress: number, stage: string) => setPhase({ kind: "running", progress, stage });
    setPhase({ kind: "running", progress: 0, stage: "Preparando" });

    try {
      if (tool.runtime === "client") {
        if (total > clientByteBudget()) {
          throw new EngineFailure("limits.exceeded", `Los archivos (${formatBytes(total)}) superan lo que este dispositivo puede procesar con seguridad.`);
        }
        const inputs: ToolInputs = {
          list: await Promise.all(files.map(toInput)),
          slots: Object.fromEntries(
            await Promise.all(Object.entries(slots).map(async ([key, file]): Promise<[string, InputFile]> => [key, await toInput(file)])),
          ),
        };
        const result = await engine().run(tool.build(inputs, values), { onProgress, signal: controller.signal });
        setPhase({
          kind: "done",
          results: result.outputs.map((output) => ({ name: output.name, blob: new Blob([output.bytes], { type: output.mime }) })),
          warnings: result.warnings,
          metrics: result.metrics,
        });
      } else {
        const file = files[0];
        if (!file) return;
        const limit = capabilities?.limits.maxUploadBytes ?? 0;
        if (file.size > limit) throw new ServerFailure("limits.file_too_large", `El servidor acepta archivos de hasta ${formatBytes(limit)}.`, 413);
        storeKey(accessKey);
        const options = needsKey ? { accessKey, onProgress, signal: controller.signal } : { onProgress, signal: controller.signal };
        const result = await runServerJob(file, tool.steps(values), options);
        setPhase({ kind: "done", results: [{ name: result.name, blob: result.blob }], warnings: result.warnings, metrics: null });
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof EngineFailure && error.code === "cancelled")) {
        setPhase({ kind: "idle" });
      } else if (error instanceof EngineFailure || error instanceof ServerFailure) {
        setPhase({ kind: "error", message: error.message });
      } else {
        console.error(error);
        setPhase({ kind: "error", message: "Ocurrió un error inesperado. Intenta de nuevo." });
      }
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <article className="tool">
      <a href="/" className="back" onClick={linkHandler("/")}>
        ← Todas las herramientas
      </a>
      <header className="tool-header">
        <h1>{tool.title}</h1>
        <p>{tool.summary}</p>
        {tool.runtime === "client" ? (
          <p className="badge is-local">Se procesa en tu dispositivo. El archivo no se sube a ningún servidor.</p>
        ) : (
          <p className="badge is-server">Esta herramienta sube el archivo a tu servidor vitroPDF y lo borra al terminar.</p>
        )}
      </header>

      {checkingServer && <p className="stage">Comprobando el servidor…</p>}
      {!serverReady && !checkingServer && (
        <p className="notice is-warning" role="status">
          El servidor de vitroPDF no está disponible, así que esta herramienta no se puede usar ahora.
        </p>
      )}

      {spec.mode === "list" ? (
        <section className="panel">
          <Dropzone
            accept={spec.accept}
            multiple={spec.max > 1}
            label={spec.max > 1 ? "Elegir archivos" : "Elegir archivo"}
            onFiles={addFiles}
            compact={files.length > 0}
          />
          {files.length > 0 && (
            <ol className="file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                  {spec.reorder && (
                    <>
                      <button type="button" className="icon-button" aria-label={`Subir ${file.name}`} disabled={index === 0} onClick={() => move(index, -1)}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Bajar ${file.name}`}
                        disabled={index === files.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <section className="panel slots">
          {spec.slots.map((item) => (
            <div key={item.key} className="slot">
              <h2>{item.label}</h2>
              {slots[item.key] ? (
                <p className="file-list-single">
                  <span className="file-name">{slots[item.key]?.name}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar ${item.label}`}
                    onClick={() =>
                      setSlots((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== item.key)))
                    }
                  >
                    ✕
                  </button>
                </p>
              ) : (
                <Dropzone
                  accept={spec.accept}
                  multiple={false}
                  label={`Foto del ${item.label.toLowerCase()}`}
                  compact
                  onFiles={(incoming) => {
                    const file = incoming[0];
                    if (file) setSlots((current) => ({ ...current, [item.key]: file }));
                  }}
                />
              )}
            </div>
          ))}
          <p className="field-hint">Toma las fotos con la credencial en horizontal y sobre un fondo liso.</p>
        </section>
      )}

      <section className="panel">
        <OptionsForm fields={tool.fields} values={values} onChange={setValues} />
        {needsKey && (
          <div className="field">
            <label htmlFor="access-key">Llave de acceso del servidor</label>
            <input id="access-key" type="password" autoComplete="off" value={accessKey} maxLength={256} onChange={(event) => setAccessKey(event.target.value)} />
            <p className="field-hint">Este servidor es privado. Pide la llave a quien lo administra.</p>
          </div>
        )}
        <div className="actions">
          {running ? (
            <button type="button" className="button is-secondary" onClick={() => abortRef.current?.abort()}>
              Cancelar
            </button>
          ) : (
            <button type="button" className="button" disabled={!hasFiles || !serverReady || (needsKey && !accessKey)} onClick={() => void run()}>
              {tool.runtime === "server" ? "Subir y procesar" : "Procesar"}
            </button>
          )}
        </div>
      </section>

      <section aria-live="polite">
        {phase.kind === "running" && (
          <div className="panel">
            <p className="stage">{phase.stage}…</p>
            <progress max={1} value={phase.progress} />
          </div>
        )}
        {phase.kind === "error" && (
          <p className="notice is-error" role="alert">
            {phase.message}
          </p>
        )}
        {phase.kind === "done" && (
          <div className="panel results">
            <h2>Listo</h2>
            {phase.metrics && <p className="metrics">{describeMetrics(phase.metrics)}</p>}
            {phase.warnings.map((warning) => (
              <p key={warning} className="notice is-warning">
                {warning}
              </p>
            ))}
            <ul className="file-list">
              {phase.results.map((result) => (
                <li key={result.name}>
                  <span className="file-name">{result.name}</span>
                  <span className="file-size">{formatBytes(result.blob.size)}</span>
                  <button type="button" className="button" onClick={() => downloadBlob(result.blob, result.name)}>
                    Descargar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </article>
  );
}
