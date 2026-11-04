import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { newKey, pluralize } from "../lib/files.ts";
import type { DocumentPreview } from "../lib/preview.ts";
import { moveItems } from "../lib/sortable.ts";
import type { PageEditMode, PageItem } from "../tools/registry.ts";
import { Icon } from "./Icon.tsx";
import { SortableGrid, useSortableTile } from "./Sortable.tsx";
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

const THUMB_STORAGE = "prysma:thumb-size";
const THUMB_MIN = 100;
const THUMB_MAX = 260;
const THUMB_DEFAULT = 148;

function readThumbSize(): number {
  try {
    const stored = Number(window.localStorage.getItem(THUMB_STORAGE));
    return stored >= THUMB_MIN && stored <= THUMB_MAX ? stored : THUMB_DEFAULT;
  } catch {
    return THUMB_DEFAULT;
  }
}

function storeThumbSize(size: number): void {
  try {
    window.localStorage.setItem(THUMB_STORAGE, String(size));
  } catch {
    // Almacenamiento bloqueado: el tamaño vive solo durante la sesión.
  }
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

function pageLabel(page: PageItem): string {
  return `Página ${page.source + 1}${rotationLabel(page.turns)}`;
}

/** Pliegos como en un libro: la portada sola a la derecha y después pares (2-3, 4-5…). */
function spreadsOf(pages: PageItem[]): PageItem[][] {
  const spreads: PageItem[][] = [];
  const [cover, ...rest] = pages;
  if (cover) spreads.push([cover]);
  for (let index = 0; index < rest.length; index += 2) spreads.push(rest.slice(index, index + 2));
  return spreads;
}

export function PageGrid({ mode, preview, pages, onPagesChange, cuts, cutsEditable, onToggleCut, onClearCuts, disabled }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [thumb, setThumb] = useState(readThumbSize);
  const [spread, setSpread] = useState(false);
  const anchorRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLOListElement>(null);
  const tiles = useRef(new Map<string, HTMLElement>());

  const keys = pages.map((page) => page.key);
  const cutSet = new Set(cuts);
  const selectable = mode === "organize";
  const activeKey = focusKey && keys.includes(focusKey) ? focusKey : keys[0];
  const selection = keys.filter((key) => selected.has(key));
  const sortable = mode === "organize" && !spread;

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

  const register = (key: string, element: HTMLElement | null) => {
    if (element) tiles.current.set(key, element);
    else tiles.current.delete(key);
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
    // En vista de pliego cada celda de la cuadrícula contiene dos páginas.
    const columns = gridColumns(gridRef.current) * (spread ? 2 : 1);
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

  const labelOf = (key: string) => {
    const page = pages.find((item) => item.key === key);
    return page ? pageLabel(page) : "página";
  };

  const changeThumb = (size: number) => {
    setThumb(size);
    storeThumbSize(size);
  };

  // Grupo (archivo resultante) de cada página en modo dividir.
  const groupOf: number[] = [];
  let group = 0;
  pages.forEach((_, index) => {
    if (index > 0 && cutSet.has(index - 1)) group += 1;
    groupOf.push(group);
  });
  const groups = cuts.length + 1;

  const renderTile = (page: PageItem, index: number) => (
    <PageTile
      key={page.key}
      as={spread ? "div" : "li"}
      page={page}
      index={index}
      total={pages.length}
      mode={mode}
      preview={preview}
      selectable={selectable}
      isSelected={selected.has(page.key)}
      isActive={page.key === activeKey}
      group={groupOf[index] ?? 0}
      startsGroup={index === 0 || cutSet.has(index - 1)}
      cut={cutSet.has(index)}
      cutsEditable={cutsEditable}
      disabled={disabled}
      sortable={sortable}
      register={register}
      onClick={(event) => onTileClick(event, page)}
      onKeyDown={(event) => onTileKeyDown(event, page, index)}
      onFocus={() => setFocusKey(page.key)}
      onRotate={(delta) => rotate(new Set([page.key]), delta)}
      onDuplicate={() => duplicate(new Set([page.key]))}
      onRemove={() => remove(new Set([page.key]))}
      onToggleCut={() => onToggleCut(index)}
    />
  );

  const hint =
    mode === "split"
      ? cutsEditable
        ? "Pasa el cursor entre dos páginas y haz clic en las tijeras para cortar ahí."
        : "Los cortes se calculan con la regla elegida en el panel."
      : spread
        ? "Vista de pliego: revisa el orden y la orientación como quedarán impresos. Para reordenar, vuelve a la cuadrícula."
        : mode === "organize"
          ? "Arrastra para reordenar. Clic para seleccionar; Shift o Ctrl/⌘ para varias. Teclas: R gira, D duplica, Supr elimina, Alt+flechas mueve."
          : "Haz clic en una página para girarla 90°. Usa los botones de cada página para elegir el sentido.";

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
          <span className="toolbar-divider" />
          <ToolbarButton icon="book" label={spread ? "Vista de cuadrícula" : "Vista de pliego"} iconOnly pressed={spread} onClick={() => setSpread((current) => !current)} />
          <label className="zoom" title="Tamaño de las miniaturas">
            <Icon name="minus" size={14} />
            <input
              type="range"
              min={THUMB_MIN}
              max={THUMB_MAX}
              step={20}
              value={thumb}
              aria-label="Tamaño de las miniaturas"
              onChange={(event) => changeThumb(Number(event.target.value))}
            />
            <Icon name="plus" size={14} />
          </label>
        </div>
      </div>

      <p className="editor-hint">{hint}</p>

      {mode === "split" && (
        // Mapa de cortes: cada bloque es una página; los archivos resultantes alternan de tono.
        <div className="cut-map" aria-hidden="true">
          {pages.map((page, index) => (
            <span key={page.key} className="cut-map-page" data-group={(groupOf[index] ?? 0) % 2} data-cut={cutSet.has(index) || undefined} />
          ))}
        </div>
      )}

      <SortableGrid
        keys={keys}
        disabled={disabled || !sortable}
        selected={selected}
        onMove={(moving, insertAt) => onPagesChange(moveItems(pages, (page) => page.key, moving, insertAt))}
        labelOf={labelOf}
        describe={(count) => pluralize(count, "página", "páginas")}
        renderOverlay={(key) => {
          const page = pages.find((item) => item.key === key);
          return page ? <PageTileOverlay page={page} preview={preview} /> : null;
        }}
      >
        <ol
          ref={gridRef}
          className={`page-grid is-${mode}${spread ? " is-spread" : ""}`}
          style={{ "--thumb-size": `${thumb}px` } as CSSProperties}
          role={selectable ? "listbox" : "list"}
          aria-multiselectable={selectable || undefined}
          aria-label="Páginas del documento"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelected(new Set());
          }}
        >
          {spread
            ? spreadsOf(pages).map((pair, position) => (
                <li key={pair[0]?.key ?? position} className={`spread${position === 0 ? " is-cover" : ""}`} role="group">
                  {pair.map((page) => renderTile(page, pages.indexOf(page)))}
                </li>
              ))
            : pages.map(renderTile)}
        </ol>
      </SortableGrid>
    </div>
  );
}

interface TileProps {
  as: "li" | "div";
  page: PageItem;
  index: number;
  total: number;
  mode: PageEditMode;
  preview: DocumentPreview;
  selectable: boolean;
  isSelected: boolean;
  isActive: boolean;
  group: number;
  startsGroup: boolean;
  cut: boolean;
  cutsEditable: boolean;
  disabled: boolean;
  sortable: boolean;
  register: (key: string, element: HTMLElement | null) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
  onRotate: (delta: 1 | -1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onToggleCut: () => void;
}

function PageTile({ as, page, index, total, mode, preview, selectable, isSelected, isActive, group, startsGroup, cut, cutsEditable, disabled, sortable, register, onClick, onKeyDown, onFocus, onRotate, onDuplicate, onRemove, onToggleCut }: TileProps) {
  const { setNodeRef, listeners, style, dimmed, justDropped } = useSortableTile(page.key, disabled || !sortable);
  const label = pageLabel(page);
  const Tag = as;

  return (
    <Tag
      ref={(element: HTMLElement | null) => {
        setNodeRef(element);
        register(page.key, element);
      }}
      style={style}
      className="page-tile"
      role={selectable ? "option" : "listitem"}
      aria-selected={selectable ? isSelected : undefined}
      aria-label={mode === "split" ? `${label}, archivo ${group + 1}` : label}
      tabIndex={isActive ? 0 : -1}
      data-selected={isSelected || undefined}
      data-dragging={dimmed || undefined}
      data-group={mode === "split" ? (group % 2 === 0 ? "even" : "odd") : undefined}
      onClick={(event) => {
        if (!justDropped()) onClick(event);
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      {...listeners}
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
            <TileButton icon="rotateCcw" label="Girar a la izquierda" onClick={() => onRotate(-1)} />
            <TileButton icon="rotateCw" label="Girar a la derecha" onClick={() => onRotate(1)} />
            {mode === "organize" && (
              <>
                <TileButton icon="copy" label="Duplicar" onClick={onDuplicate} />
                {total > 1 && <TileButton icon="trash" label="Eliminar" onClick={onRemove} />}
              </>
            )}
          </div>
        )}
      </div>
      <span className="page-label">
        {mode === "split" && startsGroup && <span className="chip is-accent group-pill">Archivo {group + 1}</span>}
        {page.source + 1}
      </span>
      {mode === "split" && index < total - 1 && (
        <button
          type="button"
          className="cut-button"
          aria-pressed={cut}
          aria-label={`${cut ? "Quitar corte" : "Cortar"} después de la página ${page.source + 1}`}
          title={cut ? "Quitar corte" : "Cortar aquí"}
          tabIndex={-1}
          disabled={disabled || !cutsEditable}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCut();
          }}
        >
          <Icon name="scissors" size={14} />
        </button>
      )}
    </Tag>
  );
}

/** Copia de la ficha para la capa de arrastre: mismas miniaturas (ya en memoria), sin hooks ni acciones. */
function PageTileOverlay({ page, preview }: { page: PageItem; preview: DocumentPreview }) {
  return (
    <div className="page-tile is-overlay" aria-hidden="true">
      <div className="page-frame">
        <Thumb size={preview.pages[page.source]} turns={page.turns} src={preview.thumbnails[page.source]} state={thumbState(preview, page.source)} fallback={String(page.source + 1)} />
      </div>
      <span className="page-label">{page.source + 1}</span>
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
  /** Botón de alternancia (vista de pliego): expone aria-pressed. */
  pressed?: boolean;
}

export function ToolbarButton({ icon, label, onClick, disabled = false, iconOnly = false, tone, pressed }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`toolbar-button${iconOnly ? " is-icon" : ""}${tone === "danger" ? " is-danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
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
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
