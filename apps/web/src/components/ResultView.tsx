import type { EngineMetrics } from "@prysmastudio/engine";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { downloadBlob, formatBytes, pluralize } from "../lib/files.ts";
import { zipFiles } from "../lib/zip.ts";
import { Icon } from "./Icon.tsx";

export interface Result {
  name: string;
  blob: Blob;
}

interface Props {
  toolTitle: string;
  results: Result[];
  warnings: string[];
  metrics: EngineMetrics | null;
  zipName: string;
  /** Se llama al iniciar cualquier descarga (para dejar de advertir al cerrar la pestaña). */
  onDownload: () => void;
  onEdit: () => void;
  onRestart: () => void;
}

function Savings({ metrics }: { metrics: EngineMetrics }) {
  if (metrics.outputBytes >= metrics.inputBytes || metrics.inputBytes === 0) return null;
  const ratio = metrics.outputBytes / metrics.inputBytes;
  return (
    <div className="savings" aria-label={`De ${formatBytes(metrics.inputBytes)} a ${formatBytes(metrics.outputBytes)}`}>
      <div className="savings-row">
        <span>Antes</span>
        <span className="savings-bar">
          <span className="savings-fill is-before" />
        </span>
        <strong>{formatBytes(metrics.inputBytes)}</strong>
      </div>
      <div className="savings-row">
        <span>Después</span>
        <span className="savings-bar">
          {/* Se llena de izquierda a derecha una vez que la tarjeta terminó de expandirse. */}
          <motion.span
            className="savings-fill"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: Math.max(0.02, ratio) }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          />
        </span>
        <strong>{formatBytes(metrics.outputBytes)}</strong>
      </div>
      <p className="savings-total">−{Math.round((1 - ratio) * 100)} % en {(metrics.durationMs / 1000).toFixed(1)} s</p>
    </div>
  );
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 del archivo generado, calculado en el navegador. Sirve como comprobante de integridad. */
function useDigest(blob: Blob): string | null | undefined {
  const [digest, setDigest] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setDigest(undefined);
    blob
      .arrayBuffer()
      .then((bytes) => crypto.subtle.digest("SHA-256", bytes))
      .then((result) => {
        if (!cancelled) setDigest(hex(result));
      })
      .catch(() => {
        if (!cancelled) setDigest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);
  return digest;
}

function copyText(text: string, done: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(done))
    .catch(() => toast.error("No se pudo copiar. Selecciónalo y cópialo a mano."));
}

function ResultRow({ result, onSave }: { result: Result; onSave: () => void }) {
  const digest = useDigest(result.blob);
  return (
    <li>
      <div className="result-row">
        <Icon name="file" />
        <span className="result-name" title={result.name}>
          {result.name}
        </span>
        <span className="result-size">{formatBytes(result.blob.size)}</span>
        <button type="button" className="button is-ghost is-small" onClick={onSave}>
          <Icon name="download" size={16} />
          Descargar
        </button>
      </div>
      <div className="result-hash">
        <span className="result-hash-label">
          <Icon name="hash" size={12} />
          SHA-256
        </span>
        {digest === undefined ? (
          <span className="result-hash-value is-pending">calculando…</span>
        ) : digest === null ? (
          <span className="result-hash-value is-pending">no disponible</span>
        ) : (
          <>
            <code className="result-hash-value">{digest}</code>
            <button type="button" className="icon-button" aria-label="Copiar SHA-256" title="Copiar SHA-256" onClick={() => copyText(digest, "SHA-256 copiado.")}>
              <Icon name="copy" size={14} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Pantalla de éxito en forma de comprobante: herramienta, fecha, peso antes y después, tiempo y el
 * SHA-256 de cada archivo. Comparte `layoutId` con la tarjeta de progreso del panel: al terminar, esa
 * tarjeta se expande y se convierte en esta.
 */
export function ResultView({ toolTitle, results, warnings, metrics, zipName, onDownload, onEdit, onRestart }: Props) {
  const save = (blob: Blob, name: string) => {
    downloadBlob(blob, name);
    onDownload();
  };
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [issuedAt] = useState(() => new Date());
  const [only] = results;
  const totalBytes = results.reduce((sum, result) => sum + result.blob.size, 0);

  const downloadAll = async () => {
    setZipping(true);
    setZipError(null);
    try {
      save(await zipFiles(results), zipName);
    } catch (error) {
      setZipError(error instanceof Error ? error.message : "No se pudo crear el ZIP.");
    } finally {
      setZipping(false);
    }
  };

  const rows: Array<[string, string]> = [
    ["Herramienta", toolTitle],
    ["Generado", issuedAt.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })],
    ["Archivos", `${pluralize(results.length, "archivo", "archivos")} · ${formatBytes(totalBytes)}`],
  ];
  if (metrics) {
    rows.push(["Entrada", formatBytes(metrics.inputBytes)]);
    rows.push(["Tiempo", `${(metrics.durationMs / 1000).toFixed(1)} s en tu equipo`]);
  } else {
    rows.push(["Procesado", "en tu servidor PrysmaStudio"]);
  }

  return (
    <motion.section
      className="result"
      layoutId="job-card"
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ layout: { type: "spring", stiffness: 260, damping: 26, mass: 1.2 }, opacity: { duration: 0.3, delay: 0.1 } }}
      aria-labelledby="result-title"
    >
      <div className="result-hero">
        <span className="result-icon">
          <Icon name="check" size={28} />
        </span>
        <h1 id="result-title">¡Listo!</h1>
        <p>{results.length === 1 ? "Tu archivo está listo para descargar." : `Se generaron ${pluralize(results.length, "archivo", "archivos")}.`}</p>
      </div>

      {metrics && <Savings metrics={metrics} />}

      {warnings.map((warning) => (
        <p key={warning} className="notice is-warning">
          <Icon name="alert" size={18} />
          <span>{warning}</span>
        </p>
      ))}

      <div className="result-actions">
        {results.length === 1 && only ? (
          <button type="button" className="button is-primary is-large" onClick={() => save(only.blob, only.name)}>
            <Icon name="download" />
            Descargar {formatBytes(only.blob.size)}
          </button>
        ) : (
          <button type="button" className="button is-primary is-large" disabled={zipping} onClick={() => void downloadAll()}>
            <Icon name="archive" />
            {zipping ? "Preparando ZIP…" : "Descargar todo (.zip)"}
          </button>
        )}
      </div>
      {zipError && <p className="notice is-error">{zipError}</p>}

      <section className="receipt" aria-label="Comprobante">
        <header className="receipt-head">
          <span className="receipt-brand">
            <img src="/icon.svg" alt="" width={16} height={16} draggable={false} />
            PrysmaStudio
          </span>
          <span>Comprobante</span>
        </header>
        <dl className="receipt-rows">
          {rows.map(([label, value]) => (
            <div key={label} className="receipt-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ul className="result-list">
          {results.map((result) => (
            <ResultRow key={result.name} result={result} onSave={() => save(result.blob, result.name)} />
          ))}
        </ul>
        <p className="receipt-note">El SHA-256 identifica exactamente este archivo: si alguien lo altera, cambia. Guárdalo con tu trámite.</p>
      </section>

      <div className="result-footer">
        <button type="button" className="button is-ghost" onClick={onEdit}>
          <Icon name="arrowLeft" size={18} />
          Seguir editando
        </button>
        <button type="button" className="button is-ghost" onClick={onRestart}>
          Empezar con otro archivo
        </button>
      </div>
      <p className="result-note">
        <Icon name="shield" size={16} />
        Los resultados solo existen en esta pestaña. Descárgalos antes de cerrarla.
      </p>
    </motion.section>
  );
}
