import type { EngineMetrics } from "@vitropdf/engine";
import { useState } from "react";
import { downloadBlob, formatBytes, pluralize } from "../lib/files.ts";
import { zipFiles } from "../lib/zip.ts";
import { Icon } from "./Icon.tsx";

export interface Result {
  name: string;
  blob: Blob;
}

interface Props {
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
  if (metrics.outputBytes >= metrics.inputBytes || metrics.inputBytes === 0) {
    return <p className="result-metrics">Listo en {(metrics.durationMs / 1000).toFixed(1)} s.</p>;
  }
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
          <span className="savings-fill" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        </span>
        <strong>{formatBytes(metrics.outputBytes)}</strong>
      </div>
      <p className="savings-total">−{Math.round((1 - ratio) * 100)} % en {(metrics.durationMs / 1000).toFixed(1)} s</p>
    </div>
  );
}

export function ResultView({ results, warnings, metrics, zipName, onDownload, onEdit, onRestart }: Props) {
  const save = (blob: Blob, name: string) => {
    downloadBlob(blob, name);
    onDownload();
  };
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [only] = results;

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

  return (
    <section className="result" aria-labelledby="result-title">
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

      <ul className="result-list">
        {results.map((result) => (
          <li key={result.name}>
            <Icon name="file" />
            <span className="result-name" title={result.name}>
              {result.name}
            </span>
            <span className="result-size">{formatBytes(result.blob.size)}</span>
            <button type="button" className="button is-ghost is-small" onClick={() => save(result.blob, result.name)}>
              <Icon name="download" size={16} />
              Descargar
            </button>
          </li>
        ))}
      </ul>

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
    </section>
  );
}
