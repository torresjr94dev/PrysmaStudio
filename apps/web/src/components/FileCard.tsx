import { useState, type DragEvent } from "react";
import { extensionOf, formatBytes, isPdf, pluralize } from "../lib/files.ts";
import type { DocumentPreview } from "../lib/preview.ts";
import { useObjectUrl } from "../lib/preview.ts";
import { isFileDrag } from "../lib/sortable.ts";
import { deliverFiles, useFilePicker } from "./FilePicker.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Thumb } from "./Thumb.tsx";

interface CardProps {
  file: File;
  preview: DocumentPreview;
  onReplace: () => void;
  disabled: boolean;
  /** Barra delgada sobre un editor de páginas, que ya muestra las miniaturas. */
  compact?: boolean;
}

/** Archivo único (comprimir, proteger, OCR, Word…): portada grande + datos + «Cambiar archivo». */
export function FileCard({ file, preview, onReplace, disabled, compact = false }: CardProps) {
  const pdf = isPdf(file);
  const details = [
    formatBytes(file.size),
    preview.pageCount > 0 ? pluralize(preview.pageCount, "página", "páginas") : null,
    preview.status === "encrypted" ? "Protegido con contraseña" : null,
  ].filter(Boolean);

  return (
    <div className={compact ? "file-card is-compact" : "file-card"}>
      <div className="file-card-preview">
        {pdf ? (
          <Thumb
            size={preview.pages[0]}
            src={preview.thumbnails[0]}
            state={preview.status === "encrypted" ? "locked" : preview.status === "error" ? "missing" : preview.thumbnails[0] ? "ready" : "loading"}
            fallback="PDF"
          />
        ) : (
          <div className="thumb">
            <div className="thumb-sheet is-document">
              <Icon name="fileText" size={40} />
              <span className="doc-extension">{extensionOf(file.name)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="file-card-body">
        <p className="file-card-name" title={file.name}>
          {file.name}
        </p>
        <p className="file-card-meta">{details.join(" · ")}</p>
        <button type="button" className="button is-secondary" onClick={onReplace} disabled={disabled}>
          Cambiar archivo
        </button>
      </div>
    </div>
  );
}

interface SlotProps {
  label: string;
  hint: string;
  accept: string;
  icon: IconName;
  file: File | null;
  /** Vista previa del PDF cuando la ranura es el documento principal. */
  preview?: DocumentPreview | undefined;
  wide?: boolean;
  onChange: (file: File | null) => void;
  onRejected: (count: number) => void;
  disabled: boolean;
}

/** Qué se ofrece elegir, según el accept: «imagen», «PDF» o «archivo». */
function nounOf(accept: string): string {
  if (accept.includes("image/")) return "imagen";
  if (accept === "application/pdf,.pdf") return "PDF";
  return "archivo";
}

/** Ranura con rol fijo (frente / reverso; PDF, .cer, .key): acepta clic o arrastre y muestra el archivo. */
export function SlotPicker({ label, hint, accept, icon, file, preview, wide = false, onChange, onRejected, disabled }: SlotProps) {
  const [over, setOver] = useState(false);
  const image = file && file.type.startsWith("image/") ? file : null;
  const url = useObjectUrl(image);
  const noun = nounOf(accept);
  const options = { accept, multiple: false, onFiles: (files: File[]) => onChange(files[0] ?? null), onRejected };
  const picker = useFilePicker(options);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    if (!disabled) deliverFiles(Array.from(event.dataTransfer.files), options);
  };

  return (
    <div
      className={`slot${over ? " is-over" : ""}${file ? " is-filled" : ""}${wide ? " is-wide" : ""}`}
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
      <div className="slot-header">
        <h3>{label}</h3>
        {file && !disabled && (
          <button type="button" className="icon-button" aria-label={`Quitar ${label.toLowerCase()}`} onClick={() => onChange(null)}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      <button type="button" className="slot-body" onClick={picker.open} disabled={disabled} aria-label={file ? `Cambiar ${label.toLowerCase()}` : `Elegir ${label.toLowerCase()}`}>
        {url ? (
          <img src={url} alt={`${label} de la credencial`} draggable={false} />
        ) : file && preview && isPdf(file) ? (
          <Thumb
            size={preview.pages[0]}
            src={preview.thumbnails[0]}
            state={preview.status === "encrypted" ? "locked" : preview.status === "error" ? "missing" : preview.thumbnails[0] ? "ready" : "loading"}
            fallback="PDF"
          />
        ) : file ? (
          <span className="slot-document">
            <span className="thumb-sheet is-document">
              <Icon name={icon} size={32} />
              <span className="doc-extension">{extensionOf(file.name)}</span>
            </span>
          </span>
        ) : (
          <span className="slot-empty">
            <Icon name={icon} size={36} />
            <span>{hint}</span>
            <span className="slot-cta">Elegir o arrastrar {noun}</span>
          </span>
        )}
      </button>
      {file && <p className="slot-file">{file.name}</p>}
      {picker.input}
    </div>
  );
}
