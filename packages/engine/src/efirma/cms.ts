// CMS SignedData (RFC 5652) separado, como lo exige PAdES (ETSI EN 319 142-1) con el perfil B-B:
// atributos firmados content-type, message-digest y ESS signing-certificate-v2 (RFC 5035), sin
// signing-time (la hora va en /M del diccionario de firma). RSA PKCS#1 v1.5 con SHA-256.
import { der, owned } from "./asn1.ts";
import type { ParsedCertificate } from "./x509.ts";

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
} as const;

function attribute(oid: string, value: Uint8Array): Uint8Array {
  return der.sequence(der.oid(oid), der.set(value));
}

const sha256Algorithm = (): Uint8Array => der.sequence(der.oid(OID.sha256));

/**
 * Construye el ContentInfo/SignedData para `digest` (SHA-256 del contenido firmado) con el
 * certificado dado, firmando los atributos con `sign` (RSASSA-PKCS1-v1_5 + SHA-256 sobre los bytes).
 */
export async function buildSignedData(
  digest: Uint8Array,
  certificate: ParsedCertificate,
  sign: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const certHash = new Uint8Array(await crypto.subtle.digest("SHA-256", owned(certificate.der)));
  const issuerSerial = der.sequence(der.sequence(der.explicit(4, certificate.issuerDer)), der.integer(certificate.serialBytes));
  // ESSCertIDv2 sin hashAlgorithm: por defecto es SHA-256.
  const essCertId = der.sequence(der.octetString(certHash), issuerSerial);
  const signingCertificateV2 = der.sequence(der.sequence(essCertId));

  const signedAttributes = [
    attribute(OID.contentType, der.oid(OID.data)),
    attribute(OID.messageDigest, der.octetString(digest)),
    attribute(OID.signingCertificateV2, signingCertificateV2),
  ];
  // Lo que se firma es el SET OF con etiqueta universal (0x31); en el SignerInfo va como [0] IMPLICIT.
  const signature = await sign(der.setOf(...signedAttributes));

  const signerInfo = der.sequence(
    der.integer(1),
    der.sequence(certificate.issuerDer, der.integer(certificate.serialBytes)),
    sha256Algorithm(),
    der.implicitSetOf(0, ...signedAttributes),
    der.sequence(der.oid(OID.rsaEncryption), der.null()),
    der.octetString(signature),
  );

  const signedData = der.sequence(
    der.integer(1),
    der.setOf(sha256Algorithm()),
    der.sequence(der.oid(OID.data)),
    der.implicitSetOf(0, certificate.der),
    der.setOf(signerInfo),
  );
  return der.sequence(der.oid(OID.signedData), der.explicit(0, signedData));
}
