import type { PageSize } from "@prysmastudio/engine";
import { Icon } from "./Icon.tsx";

export type ThumbState = "loading" | "ready" | "missing" | "locked";

interface Props {
  size: PageSize | undefined;
  /** Cuartos de vuelta acumulados (pueden ser negativos): así la animación siempre gira por el lado corto. */
  turns?: number;
  src: string | undefined;
  state: ThumbState;
  /** Texto que se muestra cuando no hay imagen (número de página, extensión…). */
  fallback?: string;
}

const LETTER: PageSize = { width: 612, height: 792 };

/**
 * Hoja dentro de un marco cuadrado. Como el marco es cuadrado, el lado mayor de la hoja cabe en
 * cualquier orientación: el tamaño no depende del giro y la transición solo anima `transform`.
 */
export function Thumb({ size = LETTER, turns = 0, src, state, fallback }: Props) {
  const longest = Math.max(size.width, size.height, 1);
  return (
    <div className="thumb">
      <div
        className="thumb-sheet"
        data-state={state}
        style={{
          width: `${(size.width / longest) * 100}%`,
          height: `${(size.height / longest) * 100}%`,
          transform: `rotate(${turns * 90}deg)`,
        }}
      >
        {state === "ready" && src ? (
          <img src={src} alt="" draggable={false} decoding="async" />
        ) : state === "locked" ? (
          <span className="thumb-fallback">
            <Icon name="lock" size={22} />
          </span>
        ) : state === "missing" ? (
          <span className="thumb-fallback">{fallback}</span>
        ) : (
          <span className="thumb-skeleton" />
        )}
      </div>
    </div>
  );
}
