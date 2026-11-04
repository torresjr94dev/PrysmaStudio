import { useAnimate } from "motion/react";
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

const FORMAT_LABELS: Array<[RegExp, string]> = [
  [/^(application\/pdf|\.pdf)$/, "PDF"],
  [/^(image\/jpeg|\.jpe?g)$/, "JPG"],
  [/^(image\/png|\.png)$/, "PNG"],
  [/^\.docx?$/, "Word"],
  [/^\.xlsx?$/, "Excel"],
  [/^\.pptx?$/, "PowerPoint"],
  [/^\.od[tsp]$/, "OpenDocument"],
  [/^\.rtf$/, "RTF"],
];

/** Etiquetas legibles y sin repetir a partir de un `accept` estilo <input type=file>. */
export function acceptLabels(accept: string): string[] {
  const labels: string[] = [];
  for (const rule of accept.split(",").map((item) => item.trim().toLowerCase())) {
    const label = FORMAT_LABELS.find(([pattern]) => pattern.test(rule))?.[1];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/**
 * Estado vacío de una herramienta: placa de vidrio con un pozo punteado, tres hojas que se abren en
 * abanico al acercarse y los formatos aceptados. Mientras hay un arrastre encima, un haz de luz recorre
 * el borde; si se suelta un tipo que no acepta, tiembla y destella en rojo apagado.
 */
export function Dropzone({ title, hint, buttonLabel, children, ...options }: DropzoneProps) {
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const timer = useRef(0);
  const formats = acceptLabels(options.accept);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = () => {
    setRejected(true);
    void animate(scope.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.35, ease: "easeOut" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRejected(false), 600);
  };

  const delivery: PickerOptions = {
    ...options,
    onRejected: (count) => {
      if (count > 0) flash();
      options.onRejected?.(count);
    },
  };
  const picker = useFilePicker(delivery);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    deliverFiles(Array.from(event.dataTransfer.files), delivery);
  };

  return (
    <div
      ref={scope}
      className={`dropzone${over ? " is-over" : ""}${rejected ? " is-rejected" : ""}`}
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
      <span className="beam" aria-hidden="true" />
      <div className="dropzone-well">
        <div className="dropzone-art" aria-hidden="true">
          <span className="sheet sheet-back" />
          <span className="sheet sheet-mid" />
          <span className="sheet sheet-front">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="dropzone-arrow">
            <Icon name="upload" size={18} />
          </span>
        </div>
        <p className="dropzone-title">{title}</p>
        <p className="dropzone-hint">{hint}</p>
        <button type="button" className="button is-primary is-large" onClick={picker.open}>
          {buttonLabel}
        </button>
        {formats.length > 0 && (
          <ul className="dropzone-formats" aria-label="Formatos aceptados">
            {formats.map((format) => (
              <li key={format} className="chip">
                {format}
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
      {picker.input}
    </div>
  );
}

/**
 * Soltar archivos en cualquier parte de la ventana. Devuelve si hay un arrastre de archivos en curso
 * para mostrar la capa «Suelta aquí».
 *
 * Se detecta por latido: `dragover` se dispara sin parar mientras el arrastre está sobre la ventana, así
 * que si deja de llegar (se soltó, se canceló con Escape o se salió de la ventana) la capa se retira sola.
 * Contar dragenter/dragleave dejaba la capa pegada cuando un elemento hijo se desmontaba a mitad del
 * arrastre o el navegador se saltaba un dragleave.
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
    let timer = 0;
    const hide = () => {
      window.clearTimeout(timer);
      timer = 0;
      setActive(false);
    };
    const over = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      setActive(true);
      window.clearTimeout(timer);
      // El navegador repite dragover cada 350 ± 200 ms aunque el cursor no se mueva: el margen debe superarlo.
      timer = window.setTimeout(hide, 700);
    };
    const leave = (event: globalThis.DragEvent) => {
      // relatedTarget nulo: el cursor salió de la ventana.
      if (isFileDrag(event) && event.relatedTarget === null) hide();
    };
    // No se consulta defaultPrevented: el guard global de la app también lo marca y, según el orden de
    // montaje, puede correr antes. Las zonas locales (Dropzone, ranuras) detienen la propagación.
    const drop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      hide();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) callback.current(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("dragover", over);
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
        <span className="beam" />
        <Icon name="upload" size={32} />
        <p>{label}</p>
      </div>
    </div>
  );
}
