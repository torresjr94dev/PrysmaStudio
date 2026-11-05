// Lectura del certificado .cer de la e.firma (X.509 v3 en DER o PEM). Solo se extrae lo que la firma
// y la interfaz necesitan: titular (nombre, RFC, CURP), emisor, número de serie en el formato del SAT,
// vigencia, uso de llave y la llave pública RSA para cotejarla con la .key.
import { EngineError } from "../errors.ts";
import type { CertificateInfo, CertificateKind } from "../protocol.ts";
import {
  DerError,
  bitStringOf,
  bytesToHex,
  childrenOf,
  derError,
  integerBytesOf,
  isContext,
  octetStringOf,
  oidOf,
  pemToDer,
  readDerExact,
  sequenceOf,
  smallIntegerOf,
  stringOf,
  timeOf,
  type DerNode,
} from "./asn1.ts";

const ATTRIBUTE: Record<string, string> = {
  "2.5.4.3": "commonName",
  "2.5.4.41": "name",
  "2.5.4.10": "organization",
  "2.5.4.11": "organizationalUnit",
  "2.5.4.6": "country",
  "2.5.4.5": "serialNumber",
  "2.5.4.45": "uniqueIdentifier",
  "1.2.840.113549.1.9.1": "email",
  "1.2.840.113549.1.9.2": "unstructuredName",
};

const KEY_USAGE = ["digitalSignature", "nonRepudiation", "keyEncipherment", "dataEncipherment", "keyAgreement", "keyCertSign", "cRLSign", "encipherOnly", "decipherOnly"] as const;
const OID_KEY_USAGE = "2.5.29.15";
const OID_RSA = "1.2.840.113549.1.1.1";
const SIGNATURE_ALGORITHMS: Record<string, string> = {
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
};

/** RFC mexicano: 3 letras (persona moral) o 4 (física), fecha y homoclave. */
const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const CURP_PATTERN = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

export interface ParsedCertificate {
  info: CertificateInfo;
  /** DER completo del certificado (va dentro del CMS). */
  der: Uint8Array;
  /** Name del emisor y serie tal cual (para IssuerAndSerialNumber). */
  issuerDer: Uint8Array;
  serialBytes: Uint8Array;
  /** Módulo RSA de la llave pública, para cotejar con la privada. */
  modulus: Uint8Array;
}

/** Name ::= SEQUENCE OF RDN; cada RDN es un SET de (OID, valor). Devuelve los atributos conocidos. */
function nameOf(node: DerNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rdn of sequenceOf(node, "Name")) {
    for (const attribute of childrenOf(rdn)) {
      const [type, value] = childrenOf(attribute);
      if (!type || !value) throw new DerError("Atributo de nombre incompleto.");
      const key = ATTRIBUTE[oidOf(type)];
      if (!key) continue;
      try {
        out[key] = stringOf(value).trim();
      } catch {
        // Tipos de cadena exóticos: se ignoran en lugar de rechazar el certificado.
      }
    }
  }
  return out;
}

/** El SAT codifica el número de certificado (20 dígitos) como los bytes ASCII de esos dígitos. */
function satSerial(bytes: Uint8Array): string {
  const ascii = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return /^\d{10,40}$/.test(ascii) ? ascii : bytesToHex(bytes).toUpperCase();
}

/** «RFC / CURP» en x500UniqueIdentifier → { rfc, curp }; también CURP sola en serialNumber (« / CURP»). */
function identifiers(subject: Record<string, string>): { rfc: string | null; curp: string | null } {
  const pieces = (subject.uniqueIdentifier ?? "").split("/").map((piece) => piece.trim().toUpperCase());
  let rfc: string | null = null;
  let curp: string | null = null;
  for (const piece of pieces) {
    if (!rfc && RFC_PATTERN.test(piece)) rfc = piece;
    else if (!curp && CURP_PATTERN.test(piece)) curp = piece;
  }
  if (!curp) {
    for (const piece of (subject.serialNumber ?? "").split("/")) {
      const candidate = piece.trim().toUpperCase();
      if (CURP_PATTERN.test(candidate)) curp = candidate;
    }
  }
  return { rfc, curp };
}

function keyUsageOf(extensions: DerNode | undefined): string[] {
  if (!extensions) return [];
  const usage: string[] = [];
  for (const extension of sequenceOf(childrenOf(extensions)[0] ?? extensions, "Extensions")) {
    const fields = childrenOf(extension);
    const id = fields[0];
    const value = fields[fields.length - 1];
    if (!id || !value || oidOf(id) !== OID_KEY_USAGE) continue;
    const bits = bitStringOf(readDerExact(octetStringOf(value)));
    KEY_USAGE.forEach((name, index) => {
      const byte = bits.bytes[Math.floor(index / 8)] ?? 0;
      if ((byte & (0x80 >> index % 8)) !== 0) usage.push(name);
    });
  }
  return usage;
}

/**
 * FIEL o CSD. El SAT emite la e.firma con cifrado de llave y datos (sirve para más que firmar); el
 * Certificado de Sello Digital solo con firma y no repudio, y lleva la sucursal en OU. Con señales
 * mezcladas se devuelve "unknown" para no rechazar un certificado legítimo por una heurística.
 */
function kindOf(keyUsage: string[], subject: Record<string, string>): CertificateKind {
  const encrypts = keyUsage.includes("keyEncipherment") || keyUsage.includes("dataEncipherment") || keyUsage.includes("keyAgreement");
  const branch = (subject.organizationalUnit ?? "").length > 0;
  if (encrypts && !branch) return "fiel";
  if (!encrypts && branch && keyUsage.length > 0) return "csd";
  return "unknown";
}

export function parseCertificate(bytes: Uint8Array): ParsedCertificate {
  try {
    const der = pemToDer(bytes, /^(?:TRUSTED )?CERTIFICATE$/);
    const [tbs, signatureAlgorithm] = sequenceOf(readDerExact(der), "Certificate");
    if (!tbs || !signatureAlgorithm) throw new DerError("Certificate incompleto.");
    const fields = sequenceOf(tbs, "TBSCertificate");
    let index = 0;
    const first = fields[0];
    if (first && isContext(first, 0)) {
      const [version] = childrenOf(first);
      if (!version || smallIntegerOf(version) !== 2) throw new DerError("Solo se admiten certificados X.509 v3.");
      index = 1;
    }
    const serial = fields[index];
    const issuer = fields[index + 2];
    const validity = fields[index + 3];
    const subject = fields[index + 4];
    const spki = fields[index + 5];
    if (!serial || !issuer || !validity || !subject || !spki) throw new DerError("TBSCertificate incompleto.");
    const extensions = fields.slice(index + 6).find((field) => isContext(field, 3));

    const [notBefore, notAfter] = sequenceOf(validity, "Validity");
    if (!notBefore || !notAfter) throw new DerError("Validity incompleto.");

    const [algorithm, publicKey] = sequenceOf(spki, "SubjectPublicKeyInfo");
    if (!algorithm || !publicKey) throw new DerError("SubjectPublicKeyInfo incompleto.");
    const [algorithmOid] = sequenceOf(algorithm, "AlgorithmIdentifier");
    if (!algorithmOid || oidOf(algorithmOid) !== OID_RSA) {
      throw new EngineError("efirma.invalid_certificate", "El certificado no usa una llave RSA; la e.firma del SAT siempre es RSA.");
    }
    const [modulusNode] = sequenceOf(readDerExact(bitStringOf(publicKey).bytes), "RSAPublicKey");
    if (!modulusNode) throw new DerError("RSAPublicKey sin módulo.");
    const modulus = integerBytesOf(modulusNode);

    const subjectAttributes = nameOf(subject);
    const issuerAttributes = nameOf(issuer);
    const keyUsage = keyUsageOf(extensions);
    const serialBytes = integerBytesOf(serial);
    const [signatureOid] = sequenceOf(signatureAlgorithm, "AlgorithmIdentifier");
    const { rfc, curp } = identifiers(subjectAttributes);

    const info: CertificateInfo = {
      subjectName: subjectAttributes.commonName ?? subjectAttributes.name ?? subjectAttributes.organization ?? "",
      organization: subjectAttributes.organization ?? null,
      branch: subjectAttributes.organizationalUnit ?? null,
      email: subjectAttributes.email ?? null,
      rfc,
      curp,
      issuerName: issuerAttributes.commonName ?? issuerAttributes.organization ?? "",
      serialNumber: satSerial(serialBytes),
      notBefore: timeOf(notBefore).toISOString(),
      notAfter: timeOf(notAfter).toISOString(),
      keyUsage,
      kind: kindOf(keyUsage, subjectAttributes),
      rsaBits: modulus.length * 8,
      signatureAlgorithm: signatureOid ? (SIGNATURE_ALGORITHMS[oidOf(signatureOid)] ?? oidOf(signatureOid)) : "",
    };
    return { info, der, issuerDer: issuer.raw, serialBytes, modulus };
  } catch (cause) {
    if (cause instanceof EngineError) throw cause;
    throw derError(cause, "El archivo .cer no es un certificado X.509 válido.", "efirma.invalid_certificate");
  }
}
