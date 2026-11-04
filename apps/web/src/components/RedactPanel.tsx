import type { RedactCategory, RedactMatch, RedactScan } from "@prysmastudio/engine";
import { pluralize } from "../lib/files.ts";
import { linkHandler } from "../lib/router.ts";
import { Icon } from "./Icon.tsx";

export interface ScanState {
  status: "idle" | "scanning" | "ready" | "error";
  result: RedactScan | null;
  error: string | null;
}

export const CATEGORY_LABEL: Record<RedactCategory, string> = {
  curp: "CURP",
  rfc: "RFC",
  nss: "NSS",
  email: "Correo",
  phone: "Teléfono",
  custom: "Texto",
};

/** Más de esto no se revisa a ojo; la lista se corta y se dice cuántas quedan. */
const MAX_LISTED = 300;

interface Props {
  scan: ScanState;
  excluded: Set<string>;
  onToggle: (id: string) => void;
  onSetAll: (selected: boolean) => void;
  disabled: boolean;
}

export function matchLabel(match: RedactMatch): string {
  return `${CATEGORY_LABEL[match.category]} ${match.text}, página ${match.page + 1}`;
}

/** Lista revisable de coincidencias: todo empieza marcado y el usuario quita lo que no deba taparse. */
export function RedactPanel({ scan, excluded, onToggle, onSetAll, disabled }: Props) {
  const result = scan.result;
  const matches = result?.matches ?? [];
  const selectedCount = matches.filter((match) => !excluded.has(match.id)).length;

  return (
    <section className="redact-panel" aria-label="Datos encontrados">
      {scan.status === "scanning" && (
        <p className="notice" role="status">
          <Icon name="search" size={18} />
          <span>Buscando datos personales…</span>
        </p>
      )}
      {scan.status === "error" && (
        <p className="notice is-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{scan.error}</span>
        </p>
      )}
      {result && result.textlessPages > 0 && (
        <p className={result.textlessPages === result.pageCount ? "notice is-warning" : "notice"} role="status">
          <Icon name={result.textlessPages === result.pageCount ? "alert" : "info"} size={18} />
          <span>
            {result.textlessPages === result.pageCount ? "Este PDF no tiene texto: parece un escaneo. " : `${pluralize(result.textlessPages, "página no tiene", "páginas no tienen")} texto (escaneos): ahí no se busca. `}
            <a href="/ocr-pdf" onClick={linkHandler("/ocr-pdf")}>
              Reconoce el texto con OCR
            </a>{" "}
            y vuelve a intentarlo.
          </span>
        </p>
      )}
      {result && scan.status === "ready" && (
        <>
          <div className="redact-summary">
            <p aria-live="polite">
              {matches.length === 0
                ? "No se encontró ningún dato con estos criterios."
                : `${pluralize(selectedCount, "dato seleccionado", "datos seleccionados")} de ${matches.length}`}
            </p>
            {matches.length > 1 && (
              <div className="redact-actions">
                <button type="button" className="link-button" disabled={disabled || selectedCount === matches.length} onClick={() => onSetAll(true)}>
                  Todos
                </button>
                <button type="button" className="link-button" disabled={disabled || selectedCount === 0} onClick={() => onSetAll(false)}>
                  Ninguno
                </button>
              </div>
            )}
          </div>
          {matches.length > 0 && (
            <ul className="redact-list">
              {matches.slice(0, MAX_LISTED).map((match) => (
                <li key={match.id}>
                  <label className="redact-item" data-selected={!excluded.has(match.id)}>
                    <input type="checkbox" checked={!excluded.has(match.id)} disabled={disabled} aria-label={matchLabel(match)} onChange={() => onToggle(match.id)} />
                    <span className="chip" data-category={match.category}>
                      {CATEGORY_LABEL[match.category]}
                    </span>
                    <span className="redact-text" title={match.text}>
                      {match.text}
                    </span>
                    <span className="redact-page">pág. {match.page + 1}</span>
                  </label>
                </li>
              ))}
              {matches.length > MAX_LISTED && <li className="redact-more">y {matches.length - MAX_LISTED} más (marcados en las miniaturas)</li>}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
