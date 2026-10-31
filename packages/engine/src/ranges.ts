import { EngineError } from "./errors.ts";

const MAX_RANGES_LENGTH = 500;
const TOKEN = /^(\d+)(?:-(\d+|z))?$/;

/**
 * Convierte rangos de página 1-based ("1-3, 5, 8-z") en índices 0-based, en el orden escrito.
 * "z" es la última página. Rechaza rangos fuera de límites o invertidos en lugar de recortarlos en silencio.
 */
export function parsePageRanges(input: string, pageCount: number): number[][] {
  const text = input.replace(/\s+/g, "");
  if (text.length === 0) throw new EngineError("input.invalid", "Indica al menos un rango de páginas, por ejemplo «1-3,5».");
  if (text.length > MAX_RANGES_LENGTH) throw new EngineError("input.invalid", "La lista de rangos es demasiado larga.");

  return text.split(",").map((token) => {
    const match = TOKEN.exec(token);
    if (!match) throw new EngineError("input.invalid", `Rango inválido: «${token}». Usa el formato «1-3,5,8-z».`);

    const start = Number(match[1]);
    const endRaw = match[2];
    const end = endRaw === undefined ? start : endRaw === "z" ? pageCount : Number(endRaw);

    if (start < 1 || end > pageCount) {
      throw new EngineError("input.invalid", `El rango «${token}» está fuera del documento (tiene ${pageCount} páginas).`);
    }
    if (start > end) throw new EngineError("input.invalid", `El rango «${token}» está invertido.`);

    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  });
}

/** Igual que parsePageRanges pero aplanado y sin duplicados, para operaciones que solo necesitan un conjunto. */
export function parsePageSet(input: string, pageCount: number): Set<number> {
  return new Set(parsePageRanges(input, pageCount).flat());
}
