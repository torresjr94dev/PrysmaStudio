import { useRef, useState, type DragEvent } from "react";

// Reordenamiento con la API nativa de Drag and Drop: en escritorio da auto-scroll del navegador y
// funciona sin dependencias. El teclado (Alt+flechas) y los botones cubren accesibilidad y pantallas táctiles.

const MIME = "application/x-vitropdf-items";

export interface DropTarget {
  index: number;
  side: "before" | "after";
}

/**
 * Mueve los elementos cuyas claves están en `moving` a la posición de inserción `insertAt`
 * (índice en la lista ORIGINAL, 0..length). Conserva el orden relativo de los elementos movidos.
 */
export function moveItems<T>(items: T[], keyOf: (item: T) => string, moving: ReadonlySet<string>, insertAt: number): T[] {
  const before = items.slice(0, insertAt).filter((item) => !moving.has(keyOf(item)));
  const after = items.slice(insertAt).filter((item) => !moving.has(keyOf(item)));
  const moved = items.filter((item) => moving.has(keyOf(item)));
  return [...before, ...moved, ...after];
}

/** ¿El arrastre trae archivos del sistema operativo? Esos los gestiona la zona de soltar global. */
export function isFileDrag(event: DragEvent | globalThis.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

interface Options {
  keys: string[];
  /** Claves seleccionadas: si se arrastra una de ellas, se mueven todas juntas. */
  selected?: ReadonlySet<string>;
  onMove: (moving: Set<string>, insertAt: number) => void;
  disabled?: boolean;
  /** Etiqueta del fantasma al arrastrar varios: «3 páginas». */
  describe?: (count: number) => string;
}

export function useSortable({ keys, selected, onMove, disabled = false, describe }: Options) {
  const [dragging, setDragging] = useState<Set<string> | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const draggingRef = useRef<Set<string> | null>(null);

  const reset = () => {
    draggingRef.current = null;
    setDragging(null);
    setTarget(null);
  };

  const sideOf = (event: DragEvent<HTMLElement>): "before" | "after" => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  };

  const insertIndex = (drop: DropTarget) => (drop.side === "before" ? drop.index : drop.index + 1);

  const itemProps = (key: string, index: number) => ({
    draggable: !disabled,
    "data-dragging": dragging?.has(key) ? "true" : undefined,
    "data-drop": target?.index === index ? target.side : undefined,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      const moving = selected?.has(key) && selected.size > 1 ? new Set(keys.filter((item) => selected.has(item))) : new Set([key]);
      draggingRef.current = moving;
      setDragging(moving);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(MIME, JSON.stringify([...moving]));
      if (moving.size > 1 && describe) {
        // Fantasma propio con el conteo; el navegador lo rasteriza al instante y se puede retirar.
        const ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.textContent = describe(moving.size);
        document.body.append(ghost);
        event.dataTransfer.setDragImage(ghost, 16, 16);
        window.setTimeout(() => ghost.remove(), 0);
      }
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!draggingRef.current || isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const side = sideOf(event);
      setTarget((current) => (current?.index === index && current.side === side ? current : { index, side }));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const moving = draggingRef.current;
      if (!moving || isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onMove(moving, insertIndex({ index, side: sideOf(event) }));
      reset();
    },
    onDragEnd: reset,
  });

  /** Para el contenedor: soltar en el hueco final de la cuadrícula inserta al final. */
  const containerProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!draggingRef.current || isFileDrag(event)) return;
      event.preventDefault();
      if (event.target === event.currentTarget && keys.length > 0) setTarget({ index: keys.length - 1, side: "after" });
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const moving = draggingRef.current;
      if (!moving || isFileDrag(event)) return;
      event.preventDefault();
      onMove(moving, target ? insertIndex(target) : keys.length);
      reset();
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
    },
  };

  return { itemProps, containerProps, isDragging: dragging !== null };
}
