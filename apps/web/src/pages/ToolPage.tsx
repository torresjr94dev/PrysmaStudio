import { EngineFailure, type EngineMetrics, type InputFile, type RedactArea, type RedactOptions, type RedactRect } from "@prysmastudio/engine";
import { motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileCard, SlotPicker } from "../components/FileCard.tsx";
import { FileGrid, type FileIssue, type FileItem } from "../components/FileGrid.tsx";
import { EngineLoader } from "../components/EngineLoader.tsx";
import { DropOverlay, Dropzone, deliverFiles, useFilePicker, useWindowFileDrop } from "../components/FilePicker.tsx";
import { Icon } from "../components/Icon.tsx";
import { OptionsForm } from "../components/OptionsForm.tsx";
import { PageGrid, resetPages, type PageMark } from "../components/PageGrid.tsx";
import { Progress } from "../components/Progress.tsx";
import { RedactPanel, matchLabel, type ScanState } from "../components/RedactPanel.tsx";
import { ResultView, type Result } from "../components/ResultView.tsx";
import { engine } from "../lib/engine.ts";
import { clientByteBudget, formatBytes, newKey, pluralize, toInput } from "../lib/files.ts";
import { takeHandedOffFiles } from "../lib/handoff.ts";
import { useDocumentPreview } from "../lib/preview.ts";
import { linkHandler, useDocumentTitle } from "../lib/router.ts";
import { ServerFailure, runServerJob, type Capabilities } from "../lib/server.ts";
import { acceptOf, redactOptionsOf, splitCuts, type EditSummary, type PageItem, type Tool, type Values, type WorkInput } from "../tools/registry.ts";

const ACCESS_KEY_STORAGE = "prysma:access-key";

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

function zipNameFor(tool: Tool, firstName: string | undefined): string {
  const base = (firstName ?? "documentos").replace(/\.[^.]{1,5}$/, "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  return `${base}-${tool.slug}.zip`;
}

function Breadcrumb({ title }: { title: string }) {
  return (
    <nav className="breadcrumb" aria-label="Ruta">
      <a href="/" onClick={linkHandler("/")}>
        Herramientas
      </a>
      <span className="breadcrumb-sep" aria-hidden="true">
        /
      </span>
      <span>{title}</span>
    </nav>
  );
}

interface Props {
  tool: Tool;
  capabilities: Capabilities | null | undefined;
}

export function ToolPage({ tool, capabilities }: Props) {
  useDocumentTitle(`${tool.title} · PrysmaStudio`);
  const workspace = tool.workspace;
  const accept = acceptOf(tool);

  const [items, setItems] = useState<FileItem[]>([]);
  const [single, setSingle] = useState<File | null>(null);
  const [slots, setSlots] = useState<Record<string, File>>({});
  const [pages, setPages] = useState<PageItem[]>([]);
  const [cuts, setCuts] = useState<number[]>([]);
  const [scan, setScan] = useState<ScanState>({ status: "idle", result: null, error: null });
  /** Coincidencias que el usuario dejó fuera (por id); todo lo demás se tapa. */
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [issues, setIssues] = useState<Record<string, FileIssue>>({});
  const [values, setValues] = useState<Values>(tool.defaults);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [accessKey, setAccessKey] = useState(readStoredKey);
  /** Resultados actuales ya descargados (al menos uno): cerrar la pestaña ya no pierde nada. */
  const [downloaded, setDownloaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Espejo de `items` para decidir avisos fuera del updater de estado (StrictMode lo ejecuta dos veces). */
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const usesSingle = workspace.kind === "single" || workspace.kind === "pages";
  const redactMode = workspace.kind === "pages" && workspace.edit === "redact";
  const preview = useDocumentPreview(usesSingle ? single : null, workspace.kind === "pages" ? "all" : "first");

  const running = phase.kind === "running";
  const hasContent =
    workspace.kind === "files" ? items.length > 0 : workspace.kind === "slots" ? Object.keys(slots).length > 0 : single !== null;

  // Cada documento nuevo arranca con sus páginas en orden original, sin cortes y sin exclusiones.
  useEffect(() => {
    if (workspace.kind !== "pages") return;
    setPages(resetPages(preview.pageCount));
    setCuts([]);
    setExcluded(new Set());
  }, [workspace.kind, preview.pageCount, single]);

  // Búsqueda de datos personales: al leer el documento y cada vez que cambian los criterios, con una
  // pausa para no escanear en cada tecla. El escaneo no toca el documento; el motor se queda con una copia.
  const previewBlocked = preview.status === "encrypted" || preview.status === "error";
  const redactOptionsKey = redactMode ? JSON.stringify(redactOptionsOf(values)) : "";
  useEffect(() => {
    if (!redactMode || !single || preview.pageCount === 0 || previewBlocked) {
      setScan({ status: "idle", result: null, error: null });
      return;
    }
    const file = single;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setScan((current) => ({ status: "scanning", result: current.result, error: null }));
      void (async () => {
        try {
          const result = await engine().scan({ name: file.name, bytes: await file.arrayBuffer() }, JSON.parse(redactOptionsKey) as RedactOptions, { signal: controller.signal });
          if (!controller.signal.aborted) setScan({ status: "ready", result, error: null });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (!(error instanceof EngineFailure)) console.error(error);
          setScan({ status: "error", result: null, error: error instanceof EngineFailure ? error.message : "No se pudo analizar el documento." });
        }
      })();
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [redactMode, single, preview.pageCount, previewBlocked, redactOptionsKey]);

  const matches = scan.result?.matches ?? [];
  const selectedMatches = matches.filter((match) => !excluded.has(match.id));
  const redactions: RedactArea[] = (() => {
    const byPage = new Map<number, RedactRect[]>();
    for (const match of selectedMatches) byPage.set(match.page, [...(byPage.get(match.page) ?? []), ...match.rects]);
    return [...byPage].map(([page, rects]) => ({ page, rects }));
  })();
  const marks: Record<number, PageMark[]> = {};
  for (const match of matches) {
    for (const [index, rect] of match.rects.entries()) {
      (marks[match.page] ??= []).push({ id: match.id, rect, category: match.category, selected: !excluded.has(match.id), label: matchLabel(match) });
      if (index > 0) break;
    }
  }
  const toggleMatch = (id: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => () => abortRef.current?.abort(), []);

  const reportRejected = useCallback((count: number) => {
    if (count > 0) toast.warning(`${count === 1 ? "Se ignoró" : "Se ignoraron"} ${pluralize(count, "archivo", "archivos")} de un tipo que esta herramienta no acepta.`);
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      setPhase({ kind: "idle" });
      switch (workspace.kind) {
        case "files":
          if (incoming.length > workspace.max - itemsRef.current.length) toast.warning(`Esta herramienta acepta hasta ${workspace.max} archivos.`);
          setItems((current) => {
            const room = Math.max(0, workspace.max - current.length);
            return [...current, ...incoming.slice(0, room).map((file) => ({ key: newKey(), file }))];
          });
          break;
        case "slots":
          setSlots((current) => {
            const next = { ...current };
            const queue = [...incoming];
            for (const slot of workspace.slots) {
              if (!next[slot.key] && queue.length > 0) next[slot.key] = queue.shift() as File;
            }
            return next;
          });
          break;
        default:
          setSingle(incoming[0] ?? null);
      }
    },
    [workspace],
  );

  const pickerOptions = { accept, multiple: workspace.kind === "files" || workspace.kind === "slots", onFiles: addFiles, onRejected: reportRejected };
  const picker = useFilePicker(pickerOptions);
  const dropActive = useWindowFileDrop((files) => deliverFiles(files, pickerOptions), !running);

  // Archivos soltados en la portada antes de elegir esta herramienta.
  useEffect(() => {
    addFiles(takeHandedOffFiles());
  }, [addFiles]);

  // Solo se pide confirmación al cerrar si hay algo que perder: un proceso en curso, resultados sin
  // descargar o páginas editadas a mano. Haber elegido un archivo no basta: volver a elegirlo es trivial.
  const pagesEdited =
    workspace.kind === "pages" && (cuts.length > 0 || pages.some((page, index) => page.source !== index || page.turns % 4 !== 0) || pages.length !== preview.pageCount);
  const unsaved = running || (phase.kind === "done" && !downloaded) || pagesEdited;
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  const serverInfo = tool.runtime === "server" ? capabilities?.tools.find((item) => item.id === tool.serverTool) : undefined;
  const checkingServer = tool.runtime === "server" && capabilities === undefined;
  const serverReady = tool.runtime === "client" || serverInfo?.available === true;
  const needsKey = tool.runtime === "server" && capabilities?.requiresAccessKey === true;

  const effectiveCuts = workspace.kind === "pages" && workspace.edit === "split" ? splitCuts(values, { pageCount: pages.length, cuts }) : cuts;
  const edit: EditSummary = { pageCount: preview.pageCount, pages, cuts: effectiveCuts, redactions: selectedMatches.length };

  const encryptedBlocks = usesSingle && preview.status === "encrypted" && tool.slug !== "desbloquear-pdf";
  const blockingIssue = encryptedBlocks
    ? "encrypted"
    : usesSingle && preview.status === "error"
      ? "corrupt"
      : Object.values(issues).find(Boolean) ?? null;

  const ready = (() => {
    if (!serverReady || blockingIssue) return false;
    switch (workspace.kind) {
      case "files":
        return items.length >= workspace.min;
      case "slots":
        return workspace.slots.every((slot) => slots[slot.key]);
      case "pages":
        return single !== null && preview.pageCount > 0 && pages.length > 0 && (!redactMode || scan.status === "ready");
      default:
        return single !== null;
    }
  })();

  const restart = () => {
    setItems([]);
    setSingle(null);
    setSlots({});
    setIssues({});
    setPages([]);
    setCuts([]);
    setExcluded(new Set());
    setPhase({ kind: "idle" });
  };

  async function run() {
    if (!ready || running) return;
    const invalid = tool.validate?.(values, edit) ?? null;
    if (invalid) {
      setPhase({ kind: "error", message: invalid });
      return;
    }
    const selected = workspace.kind === "files" ? items.map((item) => item.file) : workspace.kind === "slots" ? Object.values(slots) : single ? [single] : [];
    const total = selected.reduce((sum, file) => sum + file.size, 0);

    const controller = new AbortController();
    abortRef.current = controller;
    const onProgress = (progress: number, stage: string) => setPhase({ kind: "running", progress, stage });
    setPhase({ kind: "running", progress: 0, stage: "Preparando" });

    try {
      if (tool.runtime === "client") {
        if (total > clientByteBudget()) {
          throw new EngineFailure("limits.exceeded", `Los archivos (${formatBytes(total)}) superan lo que este equipo puede procesar con seguridad.`);
        }
        const input: WorkInput = {
          files: await Promise.all((workspace.kind === "files" ? items.map((item) => item.file) : single ? [single] : []).map(toInput)),
          slots: Object.fromEntries(
            await Promise.all(Object.entries(slots).map(async ([key, file]): Promise<[string, InputFile]> => [key, await toInput(file)])),
          ),
          pages,
          cuts: effectiveCuts,
          redactions,
        };
        const result = await engine().run(tool.build(input, values), { onProgress, signal: controller.signal });
        setDownloaded(false);
        setPhase({
          kind: "done",
          results: result.outputs.map((output) => ({ name: output.name, blob: new Blob([output.bytes], { type: output.mime }) })),
          warnings: result.warnings,
          metrics: result.metrics,
        });
      } else {
        if (!single) return;
        const limit = capabilities?.limits.maxUploadBytes ?? 0;
        if (single.size > limit) throw new ServerFailure("limits.file_too_large", `El servidor acepta archivos de hasta ${formatBytes(limit)}.`, 413);
        storeKey(accessKey);
        const options = needsKey ? { accessKey, onProgress, signal: controller.signal } : { onProgress, signal: controller.signal };
        const result = await runServerJob(single, tool.steps(values), options);
        setDownloaded(false);
        setPhase({ kind: "done", results: [{ name: result.name, blob: result.blob }], warnings: result.warnings, metrics: null });
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof EngineFailure && error.code === "cancelled")) {
        setPhase({ kind: "idle" });
        toast.info("Proceso cancelado.");
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

  // Ctrl/⌘ + Enter procesa desde cualquier parte de la página. useLayoutEffect (no useEffect): la referencia
  // debe estar al día antes del siguiente evento de teclado, o un atajo pulsado justo después de soltar un
  // archivo ejecutaría un `run` viejo que todavía no ve ese archivo.
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void runRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (phase.kind === "done") {
    return (
      <ResultView
        toolTitle={tool.title}
        results={phase.results}
        warnings={phase.warnings}
        metrics={phase.metrics}
        zipName={zipNameFor(tool, (workspace.kind === "files" ? items[0]?.file : single)?.name)}
        onDownload={() => setDownloaded(true)}
        onEdit={() => setPhase({ kind: "idle" })}
        onRestart={restart}
      />
    );
  }

  const privacy =
    tool.runtime === "client" ? (
      <p className="privacy is-local">
        <Icon name="laptop" size={16} />
        Se procesa en tu equipo. Nada se sube.
      </p>
    ) : (
      <p className="privacy is-server">
        <Icon name="cloud" size={16} />
        Se sube a tu servidor PrysmaStudio y se borra al terminar.
      </p>
    );

  const serverNotice = checkingServer ? (
    <p className="notice">
      <Icon name="info" size={18} />
      <span>Comprobando el servidor…</span>
    </p>
  ) : !serverReady ? (
    <p className="notice is-warning" role="status">
      <Icon name="alert" size={18} />
      <span>El servidor de PrysmaStudio no está disponible, así que esta herramienta no se puede usar ahora.</span>
    </p>
  ) : null;

  if (!hasContent && workspace.kind !== "slots") {
    return (
      <div className="tool-empty">
        <Breadcrumb title={tool.title} />
        <motion.span className="tool-icon is-large" data-category={tool.category} layoutId={`tool-${tool.slug}`}>
          <Icon name={tool.icon} size={30} />
        </motion.span>
        <h1>{tool.title}</h1>
        <p className="tool-empty-summary">{tool.summary}</p>
        {serverNotice}
        <Dropzone
          {...pickerOptions}
          title={workspace.kind === "files" ? `Arrastra aquí tus ${workspace.noun.many}` : "Arrastra aquí tu archivo"}
          hint={workspace.kind === "files" ? `O elígelos desde tu equipo. Puedes agregar hasta ${workspace.max}.` : "O elígelo desde tu equipo. Un archivo a la vez."}
          buttonLabel={workspace.kind === "files" ? `Elegir ${workspace.noun.many}` : "Elegir archivo"}
        />
        {privacy}
      </div>
    );
  }

  return (
    <div className="tool-page">
      <DropOverlay active={dropActive && workspace.kind !== "slots"} label={workspace.kind === "files" ? "Suelta para agregar" : "Suelta para reemplazar el archivo"} />
      <Breadcrumb title={tool.title} />
      <div className="tool-layout">
        <section className="workspace" aria-label="Archivos">
          <EngineLoader />
          {workspace.kind === "files" && (
            <FileGrid
              items={items}
              onItemsChange={setItems}
              onAddMore={picker.open}
              onIssue={(key, issue) =>
                setIssues((current) => {
                  if ((current[key] ?? null) === issue) return current;
                  const next = { ...current };
                  if (issue) next[key] = issue;
                  else delete next[key];
                  return next;
                })
              }
              noun={workspace.noun}
              disabled={running}
            />
          )}
          {workspace.kind === "slots" && (
            <div className="slots">
              {workspace.slots.map((slot) => (
                <SlotPicker
                  key={slot.key}
                  label={slot.label}
                  hint={slot.hint}
                  accept={accept}
                  file={slots[slot.key] ?? null}
                  disabled={running}
                  onRejected={reportRejected}
                  onChange={(file) => {
                    setPhase({ kind: "idle" });
                    setSlots((current) => {
                      const next = { ...current };
                      if (file) next[slot.key] = file;
                      else delete next[slot.key];
                      return next;
                    });
                  }}
                />
              ))}
              <p className="editor-hint">Toma las fotos con la credencial en horizontal, sobre un fondo liso y sin reflejos.</p>
            </div>
          )}
          {workspace.kind === "single" && single && <FileCard file={single} preview={preview} onReplace={picker.open} disabled={running} />}
          {workspace.kind === "pages" && single && (
            <>
              <FileCard file={single} preview={preview} onReplace={picker.open} disabled={running} compact />
              {preview.pageCount > 0 && (
                <PageGrid
                  mode={workspace.edit}
                  preview={preview}
                  pages={pages}
                  onPagesChange={setPages}
                  cuts={effectiveCuts}
                  cutsEditable={values.mode === "custom"}
                  onToggleCut={(position) =>
                    setCuts((current) => (current.includes(position) ? current.filter((cut) => cut !== position) : [...current, position]))
                  }
                  onClearCuts={() => setCuts([])}
                  disabled={running}
                  marks={redactMode ? marks : undefined}
                  onToggleMark={redactMode ? toggleMatch : undefined}
                />
              )}
              {preview.status === "loading" && preview.pageCount === 0 && (
                <p className="notice">
                  <Icon name="info" size={18} />
                  <span>Leyendo el documento…</span>
                </p>
              )}
            </>
          )}
          {picker.input}
        </section>

        <aside className="sidebar" aria-label="Opciones">
          <div className="sidebar-head">
            <motion.span className="tool-icon" data-category={tool.category} layoutId={`tool-${tool.slug}`}>
              <Icon name={tool.icon} size={22} />
            </motion.span>
            <div>
              <h1>{tool.title}</h1>
              <p>{tool.summary}</p>
            </div>
          </div>
          {privacy}
          {serverNotice}

          <OptionsForm fields={tool.fields} values={values} onChange={setValues} disabled={running} />
          {redactMode && single && (
            <RedactPanel
              scan={scan}
              excluded={excluded}
              onToggle={toggleMatch}
              onSetAll={(selected) => setExcluded(selected ? new Set() : new Set(matches.map((match) => match.id)))}
              disabled={running}
            />
          )}

          {needsKey && (
            <div className="field">
              <label htmlFor="access-key">Llave de acceso del servidor</label>
              <input id="access-key" type="password" autoComplete="off" value={accessKey} maxLength={256} disabled={running} onChange={(event) => setAccessKey(event.target.value)} />
              <p className="field-hint">Este servidor es privado. Pide la llave a quien lo administra.</p>
            </div>
          )}

          {blockingIssue === "encrypted" && (
            <p className="notice is-warning" role="status">
              <Icon name="lock" size={18} />
              <span>
                {workspace.kind === "files" ? "Uno de los PDF" : "Este PDF"} está protegido con contraseña.{" "}
                <a href="/desbloquear-pdf" onClick={linkHandler("/desbloquear-pdf")}>
                  Quítale la contraseña
                </a>{" "}
                y vuelve a intentarlo.
              </span>
            </p>
          )}
          {blockingIssue === "corrupt" && (
            <p className="notice is-error" role="status">
              <Icon name="alert" size={18} />
              <span>{preview.error ?? "Uno de los archivos está dañado o no es un PDF válido."}</span>
            </p>
          )}
          {phase.kind === "error" && (
            <p className="notice is-error" role="alert">
              <Icon name="alert" size={18} />
              <span>{phase.message}</span>
            </p>
          )}

          <div className="sidebar-footer">
            {phase.kind === "running" ? (
              // Mismo layoutId que la pantalla de éxito: al terminar, esta tarjeta se expande y se convierte en ella.
              <motion.div className="job-card" layoutId="job-card" layout transition={{ layout: { type: "spring", stiffness: 260, damping: 26, mass: 1.2 } }}>
                <Progress value={phase.progress} stage={phase.stage} onCancel={() => abortRef.current?.abort()} />
              </motion.div>
            ) : (
              <>
                <button
                  type="button"
                  className="button is-primary is-large is-block"
                  disabled={!ready || (needsKey && !accessKey)}
                  onClick={() => void run()}
                >
                  {tool.action}
                  <Icon name="arrowLeft" size={18} className="is-flipped" />
                </button>
                <p className="shortcut-hint">
                  <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
