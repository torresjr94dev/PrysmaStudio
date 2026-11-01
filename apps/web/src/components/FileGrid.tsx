import { useEffect, type ReactNode } from "react";
import { useRef } from "react";
import { extensionOf, formatBytes, isPdf, pluralize } from "../lib/files.ts";
import { useDocumentPreview, useObjectUrl, type DocumentPreview } from "../lib/preview.ts";
import { moveItems } from "../lib/sortable.ts";
import { Icon } from "./Icon.tsx";
import { ToolbarButton } from "./PageGrid.tsx";
import { SortableGrid, useSortableTile } from "./Sortable.tsx";
import { Thumb } from "./Thumb.tsx";

export interface FileItem {
  key: string;
  file: File;
}

/** Problemas detectados al previsualizar, para bloquear «Procesar» antes de gastar memoria. */
export type FileIssue = "encrypted" | "corrupt";

interface Props {
  items: FileItem[];
  onItemsChange: (items: FileItem[]) => void;
  onAddMore: () => void;
  onIssue: (key: string, issue: FileIssue | null) => void;
  noun: { one: string; many: string };
  disabled: boolean;
}

export function FileGrid({ items, onItemsChange, onAddMore, onIssue, noun, disabled }: Props) {
  const keys = items.map((item) => item.key);
  /** Copia visual de cada ficha para la capa de arrastre: así no se previsualiza el archivo dos veces. */
  const snapshots = useRef(new Map<string, ReactNode>());

  const sortByName = (direction: 1 | -1) =>
    onItemsChange([...items].sort((a, b) => direction * a.file.name.localeCompare(b.file.name, "es-MX", { numeric: true })));

  const move = (index: number, delta: -1 | 1) => {
    const item = items[index];
    if (!item) return;
    const insertAt = delta < 0 ? Math.max(0, index - 1) : Math.min(items.length, index + 2);
    onItemsChange(moveItems(items, (entry) => entry.key, new Set([item.key]), insertAt));
  };

  return (
    <div className="file-editor">
      <div className="toolbar" role="toolbar" aria-label="Acciones de archivos">
        <p className="toolbar-status" aria-live="polite">
          {pluralize(items.length, noun.one, noun.many)} · {formatBytes(items.reduce((sum, item) => sum + item.file.size, 0))}
        </p>
        <div className="toolbar-actions">
          <ToolbarButton icon="sortAz" label="Ordenar por nombre" disabled={disabled || items.length < 2} onClick={() => sortByName(1)} />
          <ToolbarButton icon="reverse" label="Invertir orden" iconOnly disabled={disabled || items.length < 2} onClick={() => onItemsChange([...items].reverse())} />
          <ToolbarButton icon="plus" label="Agregar más" disabled={disabled} onClick={onAddMore} />
        </div>
      </div>
      <p className="editor-hint">Arrástralos para cambiar el orden. También puedes enfocar uno y usar Alt+flechas.</p>
      <SortableGrid
        keys={keys}
        disabled={disabled}
        onMove={(moving, insertAt) => onItemsChange(moveItems(items, (item) => item.key, moving, insertAt))}
        labelOf={(key) => {
          const index = items.findIndex((item) => item.key === key);
          const item = items[index];
          return item ? `${index + 1}. ${item.file.name}` : noun.one;
        }}
        describe={(count) => pluralize(count, noun.one, noun.many)}
        renderOverlay={(key) => {
          const view = snapshots.current.get(key);
          return view ? (
            <div className="file-tile is-overlay" aria-hidden="true">
              {view}
            </div>
          ) : null;
        }}
      >
        <ol className="file-grid" aria-label="Archivos en orden">
          {items.map((item, index) => (
            <FileTile
              key={item.key}
              item={item}
              index={index}
              total={items.length}
              disabled={disabled}
              onRemove={() => {
                onIssue(item.key, null);
                onItemsChange(items.filter((entry) => entry.key !== item.key));
              }}
              onMove={(delta) => move(index, delta)}
              onIssue={(issue) => onIssue(item.key, issue)}
              onSnapshot={(node) => {
                if (node) snapshots.current.set(item.key, node);
                else snapshots.current.delete(item.key);
              }}
            />
          ))}
          <li className="file-tile is-add">
            <button type="button" className="add-tile" onClick={onAddMore} disabled={disabled}>
              <Icon name="plus" size={28} />
              <span>Agregar {noun.many}</span>
            </button>
          </li>
        </ol>
      </SortableGrid>
    </div>
  );
}

interface TileProps {
  item: FileItem;
  index: number;
  total: number;
  disabled: boolean;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onIssue: (issue: FileIssue | null) => void;
  onSnapshot: (node: ReactNode | null) => void;
}

function FileTile({ item, index, total, disabled, onRemove, onMove, onIssue, onSnapshot }: TileProps) {
  const pdf = isPdf(item.file);
  const preview = useDocumentPreview(pdf ? item.file : null, "first");
  const imageUrl = useObjectUrl(pdf ? null : item.file);
  const { setNodeRef, listeners, style, dimmed, justDropped } = useSortableTile(item.key, disabled);

  useEffect(() => {
    if (preview.status === "encrypted") onIssue("encrypted");
    else if (preview.status === "error") onIssue("corrupt");
    else if (preview.status === "ready") onIssue(null);
    // Dependencia deliberada solo en el estado: onIssue es una función nueva en cada render del padre
    // y reportar de nuevo el mismo estado provocaría un bucle de renders.
  }, [preview.status]);

  const meta = pdf
    ? preview.status === "encrypted"
      ? "Protegido con contraseña"
      : preview.status === "error"
        ? "No se puede leer"
        : preview.pageCount > 0
          ? `${pluralize(preview.pageCount, "página", "páginas")} · ${formatBytes(item.file.size)}`
          : formatBytes(item.file.size)
    : formatBytes(item.file.size);
  const issue = preview.status === "encrypted" || preview.status === "error";
  const view = { index, name: item.file.name, meta, pdf, preview, imageUrl, issue };

  // La copia para la capa de arrastre se actualiza tras cada render y se retira al desmontar.
  useEffect(() => {
    onSnapshot(<FileTileView {...view} />);
  });
  useEffect(() => () => onSnapshot(null), []);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="file-tile"
      tabIndex={0}
      aria-label={`${index + 1}. ${item.file.name}, ${meta}`}
      data-issue={issue ? "true" : undefined}
      data-dragging={dimmed || undefined}
      onClickCapture={(event) => {
        if (justDropped()) event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowUp")) {
          event.preventDefault();
          onMove(-1);
        } else if (event.altKey && (event.key === "ArrowRight" || event.key === "ArrowDown")) {
          event.preventDefault();
          onMove(1);
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onRemove();
        }
      }}
      {...listeners}
    >
      <FileTileView
        {...view}
        actions={
          !disabled && (
            <div className="page-actions">
              {index > 0 && <TileAction icon="arrowLeft" label="Mover antes" onClick={() => onMove(-1)} />}
              <TileAction icon="trash" label="Quitar" onClick={onRemove} />
            </div>
          )
        }
      />
      {total > 1 && <span className="visually-hidden">Posición {index + 1} de {total}</span>}
    </li>
  );
}

interface ViewProps {
  index: number;
  name: string;
  meta: string;
  pdf: boolean;
  preview: DocumentPreview;
  imageUrl: string | null;
  issue: boolean;
  actions?: ReactNode;
}

/** Contenido de la ficha, compartido por la cuadrícula y la capa de arrastre. */
function FileTileView({ index, name, meta, pdf, preview, imageUrl, issue, actions }: ViewProps) {
  return (
    <>
      <span className="file-order" aria-hidden="true">
        {index + 1}
      </span>
      <div className="page-frame">
        {pdf ? (
          <Thumb
            size={preview.pages[0]}
            src={preview.thumbnails[0]}
            state={preview.status === "encrypted" ? "locked" : preview.status === "error" ? "missing" : preview.thumbnails[0] ? "ready" : "loading"}
            fallback={extensionOf(name) || "PDF"}
          />
        ) : imageUrl ? (
          <div className="thumb">
            <img className="thumb-image" src={imageUrl} alt="" draggable={false} decoding="async" />
          </div>
        ) : (
          <Thumb size={undefined} src={undefined} state="loading" />
        )}
        {actions}
        {issue && (
          <span className="file-issue" title={meta}>
            <Icon name={preview.status === "encrypted" ? "lock" : "alert"} size={14} />
          </span>
        )}
      </div>
      <span className="file-name" title={name}>
        {name}
      </span>
      <span className="file-meta">{meta}</span>
    </>
  );
}

function TileAction({ icon, label, onClick }: { icon: "arrowLeft" | "trash"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="tile-button"
      aria-label={label}
      title={label}
      tabIndex={-1}
      draggable={false}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
