import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { matchesAccept } from "../lib/files.ts";
import { isFileDrag } from "../lib/sortable.ts";
import { Icon } from "./Icon.tsx";

interface PickerOptions {
  accept: string;
  multiple: boolean;
  onFiles: (files: File[]) => void;
  /** Se llama con el número de archivos descartados por tipo incompatible. */
  onRejected?: (count: number) => void;
}

/** Filtra por `accept` y avisa cuántos se descartaron. */
export function deliverFiles(files: File[], { accept, multiple, onFiles, onRejected }: PickerOptions): void {
  const accepted = files.filter((file) => matchesAccept(file, accept));
  onRejected?.(files.length - accepted.length);
  if (accepted.length > 0) onFiles(multiple ? accepted : accepted.slice(0, 1));
}

/** Selector de archivos invisible que se abre desde cualquier botón. */
export function useFilePicker(options: PickerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={options.accept}
      multiple={options.multiple}
      className="visually-hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        deliverFiles(Array.from(event.currentTarget.files ?? []), options);
        event.currentTarget.value = "";
      }}
    />
  );
  return { open: () => inputRef.current?.click(), input };
}

interface DropzoneProps extends PickerOptions {
  title: string;
  hint: string;
  buttonLabel: string;
  children?: ReactNode;
}

/** Estado vacío de una herramienta: zona grande de clic o arrastre. */
export function Dropzone({ title, hint, buttonLabel, children, ...options }: DropzoneProps) {
  const [over, setOver] = useState(false);
  const picker = useFilePicker(options);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    deliverFiles(Array.from(event.dataTransfer.files), options);
  };

  return (
    <div
      className={`dropzone${over ? " is-over" : ""}`}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
    >
      <span className="dropzone-icon">
        <Icon name="upload" size={28} />
      </span>
      <p className="dropzone-title">{title}</p>
      <button type="button" className="button is-primary is-large" onClick={picker.open}>
        {buttonLabel}
      </button>
      <p className="dropzone-hint">{hint}</p>
      {children}
      {picker.input}
    </div>
  );
}

/**
 * Soltar archivos en cualquier parte de la ventana. Devuelve si hay un arrastre de archivos en curso
 * para mostrar la capa «Suelta aquí». El contador de profundidad compensa los dragenter/dragleave de
 * cada elemento hijo.
 */
export function useWindowFileDrop(onFiles: (files: File[]) => void, enabled: boolean): boolean {
  const [active, setActive] = useState(false);
  const callback = useRef(onFiles);

  useEffect(() => {
    callback.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    if (!enabled) {
      setActive(false);
      return;
    }
    let depth = 0;
    const enter = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      depth += 1;
      setActive(true);
    };
    const leave = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    // No se consulta defaultPrevented: el guard global de la app también lo marca y, según el orden de
    // montaje, puede correr antes. Las zonas locales (Dropzone, ranuras) detienen la propagación.
    const drop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth = 0;
      setActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) callback.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [enabled]);

  return active;
}

/**
 * Sin esto, soltar un PDF fuera de una zona hace que el navegador lo abra en la pestaña y se pierde
 * todo el trabajo en curso. Se registra una vez en la raíz de la app.
 */
export function usePreventFileNavigation(): void {
  useEffect(() => {
    const guard = (event: globalThis.DragEvent) => {
      if (isFileDrag(event)) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
}

export function DropOverlay({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay-card">
        <Icon name="upload" size={32} />
        <p>{label}</p>
      </div>
    </div>
  );
}
