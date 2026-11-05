import { EngineFailure, inspectCertificate, verifyCredentials, type CertificateInfo } from "@prysmastudio/engine";
import { useEffect, useState } from "react";
import { Icon } from "./Icon.tsx";

export type CredentialsState =
  /** Falta el certificado. */
  | { status: "idle"; info: null; error: null }
  /** Certificado leído y vigente; falta la llave o la contraseña. */
  | { status: "certificate"; info: CertificateInfo; error: null }
  | { status: "checking"; info: CertificateInfo; error: null }
  /** La llave se abrió con la contraseña y corresponde al certificado. */
  | { status: "ready"; info: CertificateInfo; error: null }
  /** `info` es null si el problema está en el certificado; si no, en la llave o la contraseña. */
  | { status: "error"; info: CertificateInfo | null; error: string };

const IDLE: CredentialsState = { status: "idle", info: null, error: null };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof EngineFailure ? error.message : fallback;
}

/**
 * Lee el .cer en cuanto llega y, con .key y contraseña, comprueba que abran y sean pareja (con una
 * pausa para no descifrar en cada tecla). Todo ocurre en el hilo principal: son operaciones de
 * milisegundos sin MuPDF, y así el usuario sabe antes de pulsar «Firmar» si algo no cuadra.
 */
export function useCredentials(certificate: File | null, privateKey: File | null, password: string): CredentialsState {
  const [state, setState] = useState<CredentialsState>(IDLE);

  useEffect(() => {
    if (!certificate) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let timer = 0;
    void (async () => {
      let info: CertificateInfo;
      try {
        info = inspectCertificate(await certificate.arrayBuffer());
      } catch (error) {
        if (!cancelled) setState({ status: "error", info: null, error: messageOf(error, "No se pudo leer el certificado.") });
        return;
      }
      if (cancelled) return;
      if (!privateKey || !password) {
        setState({ status: "certificate", info, error: null });
        return;
      }
      setState({ status: "checking", info, error: null });
      timer = window.setTimeout(() => {
        void (async () => {
          try {
            const verified = await verifyCredentials(await certificate.arrayBuffer(), await privateKey.arrayBuffer(), password);
            if (!cancelled) setState({ status: "ready", info: verified, error: null });
          } catch (error) {
            if (!cancelled) setState({ status: "error", info, error: messageOf(error, "No se pudo abrir la llave privada.") });
          }
        })();
      }, 350);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [certificate, privateKey, password]);

  return state;
}

const longDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="credential-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Tarjeta del titular de la e.firma y estado de la llave. */
export function CredentialsPanel({ state }: { state: CredentialsState }) {
  if (state.status === "idle") return null;
  const info = state.info;
  return (
    <section className="credentials-panel" aria-live="polite" aria-label="Titular de la e.firma">
      {info && (
        <>
          <p className="credentials-title">Titular de la e.firma</p>
          <p className="credentials-name">{info.subjectName}</p>
          <dl className="credential-rows">
            {info.rfc && <Row label="RFC">{info.rfc}</Row>}
            {info.curp && <Row label="CURP">{info.curp}</Row>}
            <Row label="Vigente hasta">{longDate.format(new Date(info.notAfter))}</Row>
            <Row label="Certificado">{info.serialNumber}</Row>
          </dl>
        </>
      )}
      {state.status === "certificate" && (
        <p className="credentials-status">
          <Icon name="info" size={16} />
          <span>Agrega tu archivo .key y escribe su contraseña.</span>
        </p>
      )}
      {state.status === "checking" && (
        <p className="credentials-status">
          <Icon name="info" size={16} />
          <span>Abriendo la llave privada…</span>
        </p>
      )}
      {state.status === "ready" && (
        <p className="credentials-status is-ok">
          <Icon name="check" size={16} />
          <span>Llave verificada: corresponde al certificado.</span>
        </p>
      )}
      {state.status === "error" && (
        <p className="notice is-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{state.error}</span>
        </p>
      )}
    </section>
  );
}
