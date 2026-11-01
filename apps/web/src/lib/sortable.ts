import type { DragEvent } from "react";

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
