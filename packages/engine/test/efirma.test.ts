import { describe, expect, it } from "vitest";
import { childrenOf, der, hexToBytes, oidOf, readDerExact, sequenceOf } from "../src/efirma/asn1.ts";
import { buildSignedData } from "../src/efirma/cms.ts";
import { assertUsable, inspectCertificate, openCredentials } from "../src/efirma/credentials.ts";
import { tripleDesCbcDecrypt, unpad } from "../src/efirma/des.ts";
import { decryptPrivateKey } from "../src/efirma/pkcs8.ts";
import { parseCertificate } from "../src/efirma/x509.ts";
import { PASSWORD, expectCode, fixture, hasOpenssl, opensslVerify } from "./efirma-helpers.ts";

const VIGENTE = new Date("2027-06-01T00:00:00Z");

describe("DES", () => {
  it("descifra 3DES-CBC igual que OpenSSL (vector generado con openssl enc)", () => {
    const key = hexToBytes("0123456789abcdeffedcba9876543210a1b2c3d4e5f60718");
    const iv = hexToBytes("1122334455667788");
    const ciphertext = hexToBytes("ff75c01ecffc771f30679983b4e90a33f62abb0b28f9afa9a0282a5980906933b171335a8e3b39a60473d9ad3029219287fa948f59e7ff24");
    const plain = unpad(tripleDesCbcDecrypt(key, iv, ciphertext), 8);
    expect(plain).not.toBeNull();
    expect(new TextDecoder().decode(plain ?? new Uint8Array())).toBe("El veloz murcielago hindu comia feliz cardillo y kiwi.\n");
  });

  it("rechaza relleno inválido (síntoma de contraseña incorrecta)", () => {
    expect(unpad(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]), 8)).toBeNull();
    expect(unpad(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 0]), 8)).toBeNull();
    expect(unpad(new Uint8Array([1, 2, 3, 4, 5, 6, 2, 2]), 8)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });
});

describe("llave privada (.key)", () => {
  it("descifra la llave tal como la entrega el SAT (PBES2 + PBKDF2-SHA1 + 3DES)", async () => {
    const key = await decryptPrivateKey(fixture("fiel.key"), PASSWORD);
    expect(key.modulus.length).toBe(256);
    expect(key.modulus).toEqual(parseCertificate(fixture("fiel.cer")).modulus);
  });

  it("descifra variantes AES-256 (PBKDF2-SHA256), PBE de PKCS#12 y PEM", async () => {
    const expected = parseCertificate(fixture("fiel.cer")).modulus;
    for (const name of ["fiel-aes256.key", "fiel-pbe.key", "fiel.key.pem"]) {
      const key = await decryptPrivateKey(fixture(name), PASSWORD);
      expect(key.modulus, name).toEqual(expected);
    }
  });

  it("contraseña incorrecta o vacía → efirma.wrong_password", async () => {
    await expectCode(decryptPrivateKey(fixture("fiel.key"), "incorrecta"), "efirma.wrong_password");
    await expectCode(decryptPrivateKey(fixture("fiel-aes256.key"), "incorrecta"), "efirma.wrong_password");
    await expectCode(decryptPrivateKey(fixture("fiel-pbe.key"), "incorrecta"), "efirma.wrong_password");
    await expectCode(decryptPrivateKey(fixture("fiel.key"), ""), "efirma.wrong_password");
  });

  it("un archivo que no es PKCS#8 cifrado → efirma.invalid_key", async () => {
    await expectCode(decryptPrivateKey(fixture("fiel.cer"), PASSWORD), "efirma.invalid_key");
    await expectCode(decryptPrivateKey(new TextEncoder().encode("hola"), PASSWORD), "efirma.invalid_key");
    await expectCode(decryptPrivateKey(new TextEncoder().encode("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----"), PASSWORD), "efirma.invalid_key", /PEM/);
  });
});

describe("certificado (.cer)", () => {
  it("extrae titular, RFC, CURP, emisor, número de certificado del SAT y vigencia", () => {
    const { info } = parseCertificate(fixture("fiel.cer"));
    expect(info.subjectName).toBe("MARIA GOMEZ LOPEZ");
    expect(info.rfc).toBe("GOLM850101AB1");
    expect(info.curp).toBe("GOLM850101MDFMPR05");
    expect(info.email).toBe("maria@example.com");
    expect(info.issuerName).toBe("AC PRUEBAS PRYSMASTUDIO");
    expect(info.serialNumber).toBe("00001000000700005000");
    expect(info.notAfter.slice(0, 4)).toBe("2030");
    expect(info.keyUsage).toEqual(["digitalSignature", "nonRepudiation", "keyEncipherment", "dataEncipherment", "keyAgreement"]);
    expect(info.kind).toBe("fiel");
    expect(info.rsaBits).toBe(2048);
    expect(info.signatureAlgorithm).toBe("sha256WithRSAEncryption");
    expect(info.branch).toBeNull();
  });

  it("lee PEM además de DER", () => {
    expect(parseCertificate(fixture("fiel.cer.pem")).info).toEqual(parseCertificate(fixture("fiel.cer")).info);
  });

  it("distingue un CSD (sello para facturar) de la e.firma", () => {
    const { info } = parseCertificate(fixture("csd.cer"));
    expect(info.kind).toBe("csd");
    expect(info.branch).toBe("Sucursal 1");
    expect(() => assertUsable(info, VIGENTE)).toThrow(/Sello Digital/);
  });

  it("vigencia: vencido o aún no válido → efirma.certificate_expired", async () => {
    const vencido = parseCertificate(fixture("vencido.cer")).info;
    await expectCode(() => assertUsable(vencido, VIGENTE), "efirma.certificate_expired", /venció/);
    const fiel = parseCertificate(fixture("fiel.cer")).info;
    await expectCode(() => assertUsable(fiel, new Date("2020-01-01T00:00:00Z")), "efirma.certificate_expired", /todavía/);
    expect(() => assertUsable(fiel, VIGENTE)).not.toThrow();
    expect(() => inspectCertificate(fixture("fiel.cer"))).not.toThrow();
  });

  it("basura → efirma.invalid_certificate", async () => {
    await expectCode(() => parseCertificate(fixture("fiel.key")), "efirma.invalid_certificate");
    await expectCode(() => parseCertificate(new TextEncoder().encode("%PDF-1.7")), "efirma.invalid_certificate");
  });
});

describe("credenciales", () => {
  it("abre el par .cer + .key y la llave firma algo que la llave pública del certificado verifica", async () => {
    const credentials = await openCredentials(fixture("fiel.cer"), fixture("fiel.key"), PASSWORD, VIGENTE);
    const message = new TextEncoder().encode("hola");
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", credentials.key, message);
    const n = btoa(String.fromCharCode(...credentials.certificate.modulus)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const publicKey = await crypto.subtle.importKey("jwk", { kty: "RSA", n, e: "AQAB" }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, message)).toBe(true);
  });

  it("llave de otro certificado → efirma.mismatch; CSD → efirma.not_fiel; vencido → certificate_expired", async () => {
    await expectCode(openCredentials(fixture("otra.cer"), fixture("fiel.key"), PASSWORD, VIGENTE), "efirma.mismatch");
    await expectCode(openCredentials(fixture("csd.cer"), fixture("fiel.key"), PASSWORD, VIGENTE), "efirma.not_fiel");
    await expectCode(openCredentials(fixture("vencido.cer"), fixture("fiel.key"), PASSWORD, VIGENTE), "efirma.certificate_expired");
  });
});

describe("CMS SignedData", () => {
  it("lleva content-type, message-digest y signing-certificate-v2 firmados, y OpenSSL lo verifica", async () => {
    const credentials = await openCredentials(fixture("fiel.cer"), fixture("fiel.key"), PASSWORD, VIGENTE);
    const content = new TextEncoder().encode("contenido firmado de prueba");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", content));
    const cms = await buildSignedData(digest, credentials.certificate, async (data) => new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", credentials.key, new Uint8Array(data))));

    const [contentType, explicit] = sequenceOf(readDerExact(cms), "ContentInfo");
    expect(contentType && oidOf(contentType)).toBe("1.2.840.113549.1.7.2");
    const signedData = sequenceOf(childrenOf(explicit ?? readDerExact(cms))[0] ?? readDerExact(cms), "SignedData");
    const signerInfos = childrenOf(signedData[4] ?? readDerExact(cms));
    const signerInfo = sequenceOf(signerInfos[0] ?? readDerExact(cms), "SignerInfo");
    const signedAttrs = childrenOf(signerInfo[3] ?? readDerExact(cms));
    const attributeOids = signedAttrs.map((attribute) => oidOf(childrenOf(attribute)[0] ?? attribute));
    expect(attributeOids.sort()).toEqual(["1.2.840.113549.1.9.16.2.47", "1.2.840.113549.1.9.3", "1.2.840.113549.1.9.4"]);
    // Sin signing-time: PAdES lo prohíbe (la hora va en /M).
    expect(attributeOids).not.toContain("1.2.840.113549.1.9.5");

    if (!hasOpenssl()) return;
    const result = opensslVerify(cms, content);
    expect(result.ok, result.output).toBe(true);
    expect(result.signer).toEqual(credentials.certificate.der);
    // Contenido manipulado → la verificación falla.
    expect(opensslVerify(cms, new TextEncoder().encode("otro contenido")).ok).toBe(false);
  });

  it("der.setOf ordena por codificación como exige DER", () => {
    const set = der.setOf(der.integer(300), der.integer(1), der.octetString(new Uint8Array([0])));
    expect(Array.from(set.subarray(0, 5))).toEqual([0x31, 10, 0x02, 0x01, 0x01]);
  });
});
