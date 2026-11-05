// Abre el par .cer + .key de la e.firma: lee el certificado, descifra la llave con la contraseña,
// comprueba que sean pareja y que el certificado esté vigente y sea una e.firma (no un CSD).
import { EngineError } from "../errors.ts";
import type { CertificateInfo } from "../protocol.ts";
import { bytesEqual, owned } from "./asn1.ts";
import { decryptPrivateKey } from "./pkcs8.ts";
import { parseCertificate, type ParsedCertificate } from "./x509.ts";

export interface Credentials {
  certificate: ParsedCertificate;
  /** Llave privada importada en WebCrypto, no exportable, solo para firmar. */
  key: CryptoKey;
}

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });

/** Vigencia y tipo: lo mismo que valida la interfaz antes de firmar, para que el motor nunca firme con algo inválido. */
export function assertUsable(info: CertificateInfo, now: Date = new Date()): void {
  if (info.kind === "csd") {
    throw new EngineError("efirma.not_fiel", "Este certificado es un Certificado de Sello Digital (para facturar), no una e.firma. Para firmar documentos usa tu e.firma.");
  }
  if (now < new Date(info.notBefore)) {
    throw new EngineError("efirma.certificate_expired", `El certificado todavía no es válido: empieza a serlo el ${formatDate(info.notBefore)}.`);
  }
  if (now > new Date(info.notAfter)) {
    throw new EngineError("efirma.certificate_expired", `El certificado venció el ${formatDate(info.notAfter)}. Renueva tu e.firma en el SAT.`);
  }
  if (!info.keyUsage.includes("digitalSignature") && !info.keyUsage.includes("nonRepudiation")) {
    throw new EngineError("efirma.invalid_certificate", "El certificado no está autorizado para firmar (uso de llave).");
  }
}

/** Solo el certificado: para mostrar al titular antes de pedir la contraseña. */
export function inspectCertificate(bytes: Uint8Array): CertificateInfo {
  return parseCertificate(bytes).info;
}

export async function openCredentials(certificateBytes: Uint8Array, keyBytes: Uint8Array, password: string, now: Date = new Date()): Promise<Credentials> {
  const certificate = parseCertificate(certificateBytes);
  assertUsable(certificate.info, now);
  const privateKey = await decryptPrivateKey(keyBytes, password);
  if (!bytesEqual(privateKey.modulus, certificate.modulus)) {
    throw new EngineError("efirma.mismatch", "La llave privada (.key) no corresponde a este certificado (.cer). Revisa que sean del mismo trámite.");
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", owned(privateKey.pkcs8), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch (cause) {
    throw new EngineError("efirma.invalid_key", "El navegador no pudo importar la llave privada RSA.", { cause });
  } finally {
    privateKey.pkcs8.fill(0);
  }
  return { certificate, key };
}
