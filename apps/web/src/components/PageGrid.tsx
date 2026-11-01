import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { newKey, pluralize } from "../lib/files.ts";
import type { DocumentPreview } from "../lib/preview.ts";
import { moveItems, useSortable } from "../lib/sortable.ts";
import type { PageEditMode, PageItem } from "../tools/registry.ts";
import { Icon } from "./Icon.tsx";
import { Thumb, type ThumbState } from "./Thumb.tsx";

interface Props {
  mode: PageEditMode;
  preview: DocumentPreview;
  pages: PageItem[];
  onPagesChange: (pages: PageItem[]) => void;
  /** Posiciones después de las cuales hay un corte (modo dividir). */
  cuts: number[];
  /** false cuando los cortes los calcula una regla («cada N páginas») y no se editan a mano. */
  cutsEditable: boolean;
  onToggleCut: (position: number) => void;
  onClearCuts: () => void;
  disabled: boolean;
}

function initialPages(count: number): PageItem[] {
  return Array.from({ length: count }, (_, source) => ({ key: `p${source}`, source, turns: 0 }));
}

export function resetPages(count: number): PageItem[] {
  return initialPages(count);
}

function thumbState(preview: DocumentPreview, source: number): ThumbState {
  if (preview.thumbnails[source]) return "ready";
  if (source >= preview.expected || preview.status === "ready") return "missing";
  return "loading";
}

function gridColumns(grid: HTMLElement | null): number {
  if (!grid) return 1;
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
}

function rotationLabel(turns: number): string {
  const degrees = ((((turns % 4) + 4) % 4) * 90) as 0 | 90 | 180 | 270;
  return degrees === 0 ? "" : `, girada ${degrees}°`;
}

export function PageGrid({ mode, preview, pages, onPagesChange, cuts, cutsEditable, onToggleCut, onClearCuts, disabled }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLOListElement>(null);
  const tiles = useRef(new Map<string, HTMLElement>());

  const keys = pages.map((page) => page.key);
  const cutSet = new Set(cuts);
  const selectable = mode === "organize";
  const activeKey = focusKey && keys.includes(focusKey) ? focusKey : keys[0];
  const selection = keys.filter((key) => selected.has(key));

  const sortable = useSortable({
    keys,
    selected,
    disabled: disabled || mode !== "organize",
    describe: (count) => pluralize(count, "página", "páginas"),
    onMove: (moving, insertAt) => onPagesChange(moveItems(pages, (page) => page.key, moving, insertAt)),
  });

  const targets = (fallbackKey?: string): Set<string> =>
    selection.length > 0 ? new Set(selection) : fallbackKey ? new Set([fallbackKey]) : new Set();

  const rotate = (which: Set<string>, delta: 1 | -1) =>
    onPagesChange(pages.map((page) => (which.has(page.key) ? { ...page, turns: page.turns + delta } : page)));

  const rotateAll = (delta: 1 | -1) => onPagesChange(pages.map((page) => ({ ...page, turns: page.turns + delta })));

  const remove = (which: Set<string>) => {
    if (which.size === 0 || which.size >= pages.length) return;
    const index = pages.findIndex((page) => which.has(page.key));
    const remaining = pages.filter((page) => !which.has(page.key));
    onPagesChange(remaining);
    setSelected(new Set());
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (next) focusTile(next.key);
  };

  const duplicate = (which: Set<string>) => {
    const copies: string[] = [];
    onPagesChange(
      pages.flatMap((page) => {
        if (!which.has(page.key)) return [page];
        const copy = { ...page, key: newKey() };
        copies.push(copy.key);
        return [page, copy];
      }),
    );
    setSelected(new Set(copies));
  };

  const moveBy = (which: Set<string>, delta: number) => {
    const indexes = pages.flatMap((page, index) => (which.has(page.key) ? [index] : []));
    const firstIndex = indexes[0];
    const lastIndex = indexes[indexes.length - 1];
    if (firstIndex === undefined || lastIndex === undefined) return;
    const insertAt = delta < 0 ? Math.max(0, firstIndex + delta) : Math.min(pages.length, lastIndex + 1 + delta);
    onPagesChange(moveItems(pages, (page) => page.key, which, insertAt));
  };

  const focusTile = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() => tiles.current.get(key)?.focus());
  };

  const selectRange = (toKey: string) => {
    const anchor = anchorRef.current ?? toKey;
    const a = keys.indexOf(anchor);
    const b = keys.indexOf(toKey);
    const [from, to] = a < b ? [a, b] : [b, a];
    setSelected(new Set(keys.slice(from, to + 1)));
  };

  const onTileClick = (event: MouseEvent, page: PageItem) => {
    if (disabled) return;
    setFocusKey(page.key);
    if (mode === "rotate") {
      rotate(new Set([page.key]), 1);
      return;
    }
    if (!selectable) return;
    if (event.shiftKey) {
      selectRange(page.key);
      return;
    }
    anchorRef.current = page.key;
    if (event.metaKey || event.ctrlKey) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(page.key)) next.delete(page.key);
        else next.add(page.key);
        return next;
      });
      return;
    }
    setSelected((current) => (current.size === 1 && current.has(page.key) ? new Set() : new Set([page.key])));
  };

  const onTileKeyDown = (event: KeyboardEvent, page: PageItem, index: number) => {
    if (disabled) return;
    const columns = gridColumns(gridRef.current);
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    const step = steps[event.key];

    if (step !== undefined) {
      event.preventDefault();
      if (event.altKey && mode === "organize") {
        moveBy(targets(page.key), step);
        focusTile(page.key);
        return;
      }
      const next = pages[Math.max(0, Math.min(pages.length - 1, index + step))];
      if (!next) return;
      focusTile(next.key);
      if (event.shiftKey && selectable) selectRange(next.key);
      return;
    }

    const command = event.metaKey || event.ctrlKey;
    switch (event.key) {
      case "Home":
      case "End": {
        event.preventDefault();
        const edge = event.key === "Home" ? pages[0] : pages[pages.length - 1];
        if (edge) focusTile(edge.key);
        return;
      }
      case " ":
      case "Enter":
        event.preventDefault();
        if (mode === "split") {
          if (cutsEditable && index < pages.length - 1) onToggleCut(index);
        } else if (mode === "rotate") {
          rotate(new Set([page.key]), 1);
        } else {
          anchorRef.current = page.key;
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(page.key)) next.delete(page.key);
            else next.add(page.key);
            return next;
          });
        }
        return;
      case "Delete":
      case "Backspace":
        if (mode === "organize") {
          event.preventDefault();
          remove(targets(page.key));
        }
        return;
      case "r":
      case "R":
        if (mode !== "split" && !command) {
          event.preventDefault();
          rotate(targets(page.key), event.shiftKey ? -1 : 1);
        }
        return;
      case "d":
        if (mode === "organize" && !command) {
          event.preventDefault();
          duplicate(targets(page.key));
        }
        return;
      case "a":
        if (mode === "organize" && command) {
          event.preventDefault();
          setSelected(new Set(keys));
        }
        return;
      case "Escape":
        setSelected(new Set());
        return;
      default:
    }
  };

  const groups = cuts.length + 1;
  let group = 0;

  return (
    <div className="page-editor">
      <div className="toolbar" role="toolbar" aria-label="Acciones de páginas">
        <p className="toolbar-status" aria-live="polite">
          {mode === "split"
            ? `${pluralize(pages.length, "página", "páginas")} → ${pluralize(groups, "archivo", "archivos")}`
            : selection.length > 0
              ? `${pluralize(selection.length, "seleccionada", "seleccionadas")} de ${pages.length}`
              : pluralize(pages.length, "página", "páginas")}
        </p>
        <div className="toolbar-actions">
          {mode === "organize" && (
            <>
              <ToolbarButton icon="selectAll" label={selection.length === pages.length ? "Quitar selección" : "Seleccionar todo"} disabled={disabled} onClick={() => setSelected(selection.length === pages.length ? new Set() : new Set(keys))} />
              <span className="toolbar-divider" />
              <ToolbarButton icon="rotateCcw" label="Girar a la izquierda" iconOnly disabled={disabled || selection.length === 0} onClick={() => rotate(targets(), -1)} />
              <ToolbarButton icon="rotateCw" label="Girar a la derecha" iconOnly disabled={disabled || selection.length === 0} onClick={() => rotate(targets(), 1)} />
              <ToolbarButton icon="copy" label="Duplicar" iconOnly disabled={disabled || selection.length === 0} onClick={() => duplicate(targets())} />
              <ToolbarButton icon="trash" label="Eliminar" iconOnly tone="danger" disabled={disabled || selection.length === 0 || selection.length >= pages.length} onClick={() => remove(targets())} />
              <span className="toolbar-divider" />
              <ToolbarButton icon="reverse" label="Invertir orden" iconOnly disabled={disabled} onClick={() => onPagesChange([...pages].reverse())} />
            </>
          )}
          {mode === "rotate" && (
            <>
              <ToolbarButton icon="rotateCcw" label="Girar todas a la izquierda" disabled={disabled} onClick={() => rotateAll(-1)} />
              <ToolbarButton icon="rotateCw" label="Girar todas a la derecha" disabled={disabled} onClick={() => rotateAll(1)} />
            </>
          )}
          {mode === "split" && cutsEditable && (
            <ToolbarButton icon="x" label="Quitar cortes" disabled={disabled || cuts.length === 0} onClick={onClearCuts} />
          )}
          {mode !== "split" && (
            <ToolbarButton
              icon="undo"
              label="Restablecer"
              disabled={disabled}
              onClick={() => {
                onPagesChange(initialPages(preview.pageCount));
                setSelected(new Set());
              }}
            />
          )}
        </div>
      </div>

      <p className="editor-hint">
        {mode === "organize" && "Arrastra para reordenar. Clic para seleccionar; Shift o Ctrl/⌘ para varias. Teclas: R gira, D duplica, Supr elimina, Alt+flechas mueve."}
        {mode === "rotate" && "Haz clic en una página para girarla 90°. Usa los botones de cada página para elegir el sentido."}
        {mode === "split" && (cutsEditable ? "Haz clic en las tijeras entre dos páginas para cortar ahí." : "Los cortes se calculan con la regla elegida en el panel.")}
      </p>

      <ol
        ref={gridRef}
        className={`page-grid is-${mode}`}
        role={selectable ? "listbox" : "list"}
        aria-multiselectable={selectable || undefined}
        aria-label="Páginas del documento"
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(new Set());
        }}
        {...sortable.containerProps}
      >
        {pages.map((page, index) => {
          const isSelected = selected.has(page.key);
          const startsGroup = index === 0 || cutSet.has(index - 1);
          if (index > 0 && cutSet.has(index - 1)) group += 1;
          const label = `Página ${page.source + 1}${rotationLabel(page.turns)}`;
          return (
            <li
              key={page.key}
              ref={(element) => {
                if (element) tiles.current.set(page.key, element);
                else tiles.current.delete(page.key);
              }}
              className="page-tile"
              role={selectable ? "option" : "listitem"}
              aria-selected={selectable ? isSelected : undefined}
              aria-label={mode === "split" ? `${label}, archivo ${group + 1}` : label}
              tabIndex={page.key === activeKey ? 0 : -1}
              data-selected={isSelected || undefined}
              data-group={mode === "split" ? (group % 2 === 0 ? "even" : "odd") : undefined}
              onClick={(event) => onTileClick(event, page)}
              onKeyDown={(event) => onTileKeyDown(event, page, index)}
              onFocus={() => setFocusKey(page.key)}
              {...sortable.itemProps(page.key, index)}
            >
              <div className="page-frame">
                <Thumb size={preview.pages[page.source]} turns={page.turns} src={preview.thumbnails[page.source]} state={thumbState(preview, page.source)} fallback={String(page.source + 1)} />
                {isSelected && (
                  <span className="page-check" aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                )}
                {mode !== "split" && !disabled && (
                  <div className="page-actions">
                    <TileButton icon="rotateCcw" label="Girar a la izquierda" onClick={() => rotate(new Set([page.key]), -1)} />
                    <TileButton icon="rotateCw" label="Girar a la derecha" onClick={() => rotate(new Set([page.key]), 1)} />
                    {mode === "organize" && (
                      <>
                        <TileButton icon="copy" label="Duplicar" onClick={() => duplicate(new Set([page.key]))} />
                        {pages.length > 1 && <TileButton icon="trash" label="Eliminar" onClick={() => remove(new Set([page.key]))} />}
                      </>
                    )}
                  </div>
                )}
              </div>
              <span className="page-label">
                {mode === "split" && startsGroup && <span className="group-pill">Archivo {group + 1}</span>}
                {page.source + 1}
              </span>
              {mode === "split" && index < pages.length - 1 && (
                <button
                  type="button"
                  className="cut-button"
                  aria-pressed={cutSet.has(index)}
                  aria-label={`${cutSet.has(index) ? "Quitar corte" : "Cortar"} después de la página ${page.source + 1}`}
                  title={cutSet.has(index) ? "Quitar corte" : "Cortar aquí"}
                  tabIndex={-1}
                  disabled={disabled || !cutsEditable}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleCut(index);
                  }}
                >
                  <Icon name="scissors" size={16} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface ToolbarButtonProps {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
  disabled?: boolean;
  iconOnly?: boolean;
  tone?: "danger";
}

export function ToolbarButton({ icon, label, onClick, disabled = false, iconOnly = false, tone }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`toolbar-button${iconOnly ? " is-icon" : ""}${tone === "danger" ? " is-danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
    >
      <Icon name={icon} size={18} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

function TileButton({ icon, label, onClick }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void }) {
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
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
