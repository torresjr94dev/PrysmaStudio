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
          <rect x="11" y="11" width="26" height="26" rx="8" transform="rotate(45 24 24)" className="engine-mark-body" />
          <line x1="2" y1="24" x2="10" y2="24" className="engine-mark-beam" />
          <line x1="38" y1="24" x2="47" y2="15" className="engine-mark-ray" style={{ animationDelay: "0s" }} />
          <line x1="38" y1="24" x2="47" y2="24" className="engine-mark-ray" style={{ animationDelay: "0.15s" }} />
          <line x1="38" y1="24" x2="47" y2="33" className="engine-mark-ray" style={{ animationDelay: "0.3s" }} />
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
