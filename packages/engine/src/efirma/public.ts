// Lectura de credenciales fuera del worker (interfaz): son operaciones ligeras y sin MuPDF, así la
// interfaz muestra al titular y confirma la contraseña al instante. Los errores salen como EngineFailure,
// igual que los del worker, para que la interfaz los trate del mismo modo.
import { EngineFailure } from "../client.ts";
import { isEngineError } from "../errors.ts";
import type { CertificateInfo } from "../protocol.ts";
import { assertUsable, inspectCertificate as inspect, openCredentials } from "./credentials.ts";

function asFailure(error: unknown, fallback: string): EngineFailure {
  if (isEngineError(error)) return new EngineFailure(error.code, error.detail);
  return new EngineFailure("internal", fallback);
}

/** Lee un .cer y comprueba vigencia y tipo. Lanza EngineFailure con el código correspondiente. */
export function inspectCertificate(bytes: ArrayBuffer): CertificateInfo {
  try {
    const info = inspect(new Uint8Array(bytes));
    assertUsable(info);
    return info;
  } catch (error) {
    throw asFailure(error, "No se pudo leer el certificado.");
  }
}

/** Descifra la .key con la contraseña y confirma que corresponde al .cer. */
export async function verifyCredentials(certificate: ArrayBuffer, privateKey: ArrayBuffer, password: string): Promise<CertificateInfo> {
  try {
    const credentials = await openCredentials(new Uint8Array(certificate), new Uint8Array(privateKey), password);
    return credentials.certificate.info;
  } catch (error) {
    throw asFailure(error, "No se pudo abrir la llave privada.");
  }
}
