import { useEngineLoad } from "../lib/engine.ts";
import { formatBytes } from "../lib/files.ts";

/** Tamaño aproximado del .wasm de MuPDF, solo para dibujar la barra cuando el servidor no informa el total. */
const ESTIMATED_WASM_BYTES = 10.5 * 1024 * 1024;

/**
 * Primera descarga del motor: el peor momento de la app convertido en un momento de marca. El prisma se
 * «enciende» mientras llegan los bytes; después queda en caché y funciona sin conexión.
 */
export function EngineLoader() {
  const load = useEngineLoad();
  if (load.status !== "loading") return null;
  const total = load.total ?? ESTIMATED_WASM_BYTES;
  const ratio = Math.min(0.98, load.loaded / total);
  return (
    <div className="engine-loader" role="status" aria-live="polite">
      <span className="engine-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          {/* El isotipo: prisma, haz que entra y espectro que se enciende rayo a rayo. */}
          <line x1="1" y1="22" x2="14" y2="25.5" className="engine-mark-beam" />
          <polygon points="24,7 44,40 4,40" className="engine-mark-body" />
          <path d="M24 7v24" className="engine-mark-edge" />
          <line x1="34" y1="25" x2="47" y2="14" className="engine-mark-ray" style={{ stroke: "#e14ef5", animationDelay: "0s" }} />
          <line x1="34" y1="25" x2="47" y2="19.5" className="engine-mark-ray" style={{ stroke: "#7a4dff", animationDelay: "0.12s" }} />
          <line x1="34" y1="25" x2="47" y2="25" className="engine-mark-ray" style={{ stroke: "#2b86ff", animationDelay: "0.24s" }} />
          <line x1="34" y1="25" x2="47" y2="30.5" className="engine-mark-ray" style={{ stroke: "#19e3ff", animationDelay: "0.36s" }} />
          <line x1="34" y1="25" x2="47" y2="36" className="engine-mark-ray" style={{ stroke: "#5df0a8", animationDelay: "0.48s" }} />
        </svg>
      </span>
      <div className="engine-text">
        <strong>Preparando el motor PDF</strong>
        <span>
          {load.total ? `${formatBytes(load.loaded)} de ${formatBytes(load.total)}` : `${formatBytes(load.loaded)} descargados`} · solo la primera vez;
          después funciona sin conexión.
        </span>
      </div>
      <div className="progress-track engine-track">
        <div className="progress-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
    </div>
  );
}
