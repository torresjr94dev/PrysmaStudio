// Descifrado de la llave privada de la e.firma (PKCS#8 EncryptedPrivateKeyInfo, DER o PEM).
// El SAT la entrega con PBES2 → PBKDF2-HMAC-SHA1 (2048 iteraciones) → des-ede3-cbc. Se admiten además
// AES-CBC (llaves regeneradas con herramientas modernas) y el PBE de PKCS#12 con SHA-1 y 3DES.
import { EngineError } from "../errors.ts";
import {
  DerError,
  childrenOf,
  derError,
  integerBytesOf,
  octetStringOf,
  oidOf,
  owned,
  pemToDer,
  readDerExact,
  sequenceOf,
  smallIntegerOf,
} from "./asn1.ts";
import { tripleDesCbcDecrypt, unpad } from "./des.ts";

const OID = {
  pbes2: "1.2.840.113549.1.5.13",
  pbkdf2: "1.2.840.113549.1.5.12",
  pbeSha1TripleDes: "1.2.840.113549.1.12.1.3",
  hmacSha1: "1.2.840.113549.2.7",
  hmacSha224: "1.2.840.113549.2.8",
  hmacSha256: "1.2.840.113549.2.9",
  hmacSha384: "1.2.840.113549.2.10",
  hmacSha512: "1.2.840.113549.2.11",
  desEde3Cbc: "1.2.840.113549.3.7",
  aes128Cbc: "2.16.840.1.101.3.4.1.2",
  aes192Cbc: "2.16.840.1.101.3.4.1.22",
  aes256Cbc: "2.16.840.1.101.3.4.1.42",
  rsaEncryption: "1.2.840.113549.1.1.1",
} as const;

const PRF: Record<string, string> = {
  [OID.hmacSha1]: "SHA-1",
  [OID.hmacSha256]: "SHA-256",
  [OID.hmacSha384]: "SHA-384",
  [OID.hmacSha512]: "SHA-512",
};

const CIPHER: Record<string, { name: "3des" | "aes"; keyBytes: number; ivBytes: number }> = {
  [OID.desEde3Cbc]: { name: "3des", keyBytes: 24, ivBytes: 8 },
  [OID.aes128Cbc]: { name: "aes", keyBytes: 16, ivBytes: 16 },
  [OID.aes192Cbc]: { name: "aes", keyBytes: 24, ivBytes: 16 },
  [OID.aes256Cbc]: { name: "aes", keyBytes: 32, ivBytes: 16 },
};

/** Tope de iteraciones: evita que un archivo malicioso cuelgue el navegador. OpenSSL usa 2048; moderno 600k. */
const MAX_ITERATIONS = 10_000_000;

export interface PrivateKey {
  /** PrivateKeyInfo (PKCS#8) en claro, listo para WebCrypto importKey("pkcs8"). */
  pkcs8: Uint8Array;
  /** Módulo RSA (big-endian, sin cero de signo) para cotejar con el certificado. */
  modulus: Uint8Array;
}

function wrongPassword(): EngineError {
  return new EngineError("efirma.wrong_password", "La contraseña de la llave privada no es correcta.");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, hash: string, bytes: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: owned(salt), iterations, hash }, material, bytes * 8));
}

/** KDF de PKCS#12 (RFC 7292, apéndice B) con SHA-1: la contraseña va como BMPString con terminador. */
async function pkcs12Kdf(password: string, salt: Uint8Array, iterations: number, id: 1 | 2, bytes: number): Promise<Uint8Array> {
  const v = 64;
  const u = 20;
  const pass = new Uint8Array((password.length + 1) * 2);
  for (let i = 0; i < password.length; i++) {
    const code = password.charCodeAt(i);
    pass[i * 2] = code >> 8;
    pass[i * 2 + 1] = code & 0xff;
  }
  const repeat = (source: Uint8Array): Uint8Array => {
    if (source.length === 0) return new Uint8Array(0);
    const out = new Uint8Array(v * Math.ceil(source.length / v));
    for (let i = 0; i < out.length; i++) out[i] = source[i % source.length] ?? 0;
    return out;
  };
  const d = new Uint8Array(v).fill(id);
  const combined = new Uint8Array(repeat(salt).length + repeat(pass).length);
  combined.set(repeat(salt), 0);
  combined.set(repeat(pass), repeat(salt).length);
  const out = new Uint8Array(bytes);
  let produced = 0;
  while (produced < bytes) {
    let a = new Uint8Array(await crypto.subtle.digest("SHA-1", new Uint8Array([...d, ...combined])));
    for (let r = 1; r < iterations; r++) a = new Uint8Array(await crypto.subtle.digest("SHA-1", owned(a)));
    out.set(a.subarray(0, Math.min(u, bytes - produced)), produced);
    produced += u;
    // I_j = (I_j + B + 1) mod 2^v para cada bloque de v bytes.
    const b = new Uint8Array(v);
    for (let i = 0; i < v; i++) b[i] = a[i % u] ?? 0;
    for (let j = 0; j < combined.length; j += v) {
      let carry = 1;
      for (let i = v - 1; i >= 0; i--) {
        const sum = (combined[j + i] ?? 0) + (b[i] ?? 0) + carry;
        combined[j + i] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return out;
}

async function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", owned(key), "AES-CBC", false, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: owned(iv) }, cryptoKey, owned(data)));
  } catch (cause) {
    // WebCrypto valida el relleno PKCS#7: con la contraseña equivocada falla aquí.
    throw new EngineError("efirma.wrong_password", "La contraseña de la llave privada no es correcta.", { cause });
  }
}

/** Extrae el módulo del PrivateKeyInfo en claro; con la contraseña equivocada esto no parsea. */
function modulusOf(pkcs8: Uint8Array): Uint8Array {
  const [version, algorithm, privateKey] = sequenceOf(readDerExact(pkcs8), "PrivateKeyInfo");
  if (!version || !algorithm || !privateKey) throw new DerError("PrivateKeyInfo incompleto.");
  smallIntegerOf(version);
  const [oid] = sequenceOf(algorithm, "AlgorithmIdentifier");
  if (!oid || oidOf(oid) !== OID.rsaEncryption) throw new EngineError("efirma.invalid_key", "La llave privada no es RSA.");
  const rsa = sequenceOf(readDerExact(octetStringOf(privateKey)), "RSAPrivateKey");
  const modulus = rsa[1];
  if (!modulus) throw new DerError("RSAPrivateKey sin módulo.");
  return integerBytesOf(modulus);
}

/**
 * Descifra una llave privada .key del SAT con su contraseña. Lanza `efirma.wrong_password` si la
 * contraseña no corresponde y `efirma.invalid_key` si el archivo no es una llave PKCS#8 cifrada.
 */
export async function decryptPrivateKey(bytes: Uint8Array, password: string): Promise<PrivateKey> {
  if (password.length === 0) throw new EngineError("efirma.wrong_password", "Escribe la contraseña de la llave privada.");
  let plain: Uint8Array;
  try {
    const der = pemToDer(bytes, /^ENCRYPTED PRIVATE KEY$/);
    const [algorithm, encrypted] = sequenceOf(readDerExact(der), "EncryptedPrivateKeyInfo");
    if (!algorithm || !encrypted) throw new DerError("EncryptedPrivateKeyInfo incompleto.");
    const [schemeOid, params] = sequenceOf(algorithm, "AlgorithmIdentifier");
    if (!schemeOid || !params) throw new DerError("Algoritmo de cifrado incompleto.");
    const data = octetStringOf(encrypted);
    const scheme = oidOf(schemeOid);

    if (scheme === OID.pbes2) {
      const [kdf, cipher] = sequenceOf(params, "PBES2-params");
      if (!kdf || !cipher) throw new DerError("PBES2-params incompleto.");
      const [kdfOid, kdfParams] = sequenceOf(kdf, "KDF");
      if (!kdfOid || !kdfParams || oidOf(kdfOid) !== OID.pbkdf2) throw new DerError("PBES2 sin PBKDF2.");
      const kdfFields = sequenceOf(kdfParams, "PBKDF2-params");
      const saltNode = kdfFields[0];
      const iterationsNode = kdfFields[1];
      if (!saltNode || !iterationsNode) throw new DerError("PBKDF2-params incompleto.");
      const salt = octetStringOf(saltNode);
      const iterations = smallIntegerOf(iterationsNode);
      if (iterations < 1 || iterations > MAX_ITERATIONS) throw new DerError("Iteraciones de PBKDF2 fuera de rango.");
      // Opcionales: keyLength INTEGER y prf AlgorithmIdentifier (por defecto HMAC-SHA1).
      let hash = "SHA-1";
      for (const extra of kdfFields.slice(2)) {
        if (extra.tag === 0x30) {
          const [prfOid] = childrenOf(extra);
          const prf = prfOid ? PRF[oidOf(prfOid)] : undefined;
          if (!prf) throw new DerError("PRF de PBKDF2 no admitida.");
          hash = prf;
        }
      }
      const [cipherOid, ivNode] = sequenceOf(cipher, "EncryptionScheme");
      if (!cipherOid || !ivNode) throw new DerError("Esquema de cifrado incompleto.");
      const spec = CIPHER[oidOf(cipherOid)];
      if (!spec) throw new DerError(`Cifrado no admitido (${oidOf(cipherOid)}).`);
      const iv = octetStringOf(ivNode);
      if (iv.length !== spec.ivBytes) throw new DerError("IV de tamaño incorrecto.");
      const key = await pbkdf2(password, salt, iterations, hash, spec.keyBytes);
      if (spec.name === "aes") {
        plain = await aesCbcDecrypt(key, iv, data);
      } else {
        const padded = unpad(tripleDesCbcDecrypt(key, iv, data), 8);
        if (!padded) throw wrongPassword();
        plain = padded;
      }
    } else if (scheme === OID.pbeSha1TripleDes) {
      const [saltNode, iterationsNode] = sequenceOf(params, "PBE-params");
      if (!saltNode || !iterationsNode) throw new DerError("PBE-params incompleto.");
      const salt = octetStringOf(saltNode);
      const iterations = smallIntegerOf(iterationsNode);
      if (iterations < 1 || iterations > MAX_ITERATIONS) throw new DerError("Iteraciones de PBE fuera de rango.");
      const key = await pkcs12Kdf(password, salt, iterations, 1, 24);
      const iv = await pkcs12Kdf(password, salt, iterations, 2, 8);
      const padded = unpad(tripleDesCbcDecrypt(key, iv, data), 8);
      if (!padded) throw wrongPassword();
      plain = padded;
    } else {
      throw new DerError(`Esquema de cifrado no admitido (${scheme}).`);
    }
  } catch (cause) {
    if (cause instanceof EngineError) throw cause;
    throw derError(cause, "El archivo .key no es una llave privada cifrada del SAT.", "efirma.invalid_key");
  }

  // Con la contraseña equivocada el relleno puede ser válido por azar (1/256 con 3DES): el DER lo delata.
  let modulus: Uint8Array;
  try {
    modulus = modulusOf(plain);
  } catch (cause) {
    if (cause instanceof EngineError) throw cause;
    throw new EngineError("efirma.wrong_password", "La contraseña de la llave privada no es correcta.", { cause });
  }
  return { pkcs8: plain, modulus };
}
