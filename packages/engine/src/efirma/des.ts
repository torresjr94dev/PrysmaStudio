// DES y Triple DES (EDE, 3 llaves) en modo CBC, solo descifrado. WebCrypto no implementa 3DES y las
// llaves privadas de la e.firma que entrega el SAT vienen cifradas con des-ede3-cbc (PBES2). Se usa
// una sola vez por firma sobre ~1.3 KB, así que prima la claridad sobre la velocidad: todo a nivel de bit.
// Tablas tal como las define FIPS 46-3; el test las contrasta con vectores producidos por OpenSSL.

const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];

const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23,
  15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33,
  48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const SBOX = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11,
    15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13,
    1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0,
    11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7,
    13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8,
    15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3,
    7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14,
    10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2,
    0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
  ],
];

type Bits = Uint8Array;

function bitsOf(bytes: Uint8Array, offset: number, count: number): Bits {
  const bits = new Uint8Array(count * 8);
  for (let i = 0; i < count; i++) {
    const byte = bytes[offset + i] ?? 0;
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = (byte >> (7 - b)) & 1;
  }
  return bits;
}

function bytesOf(bits: Bits): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i * 8 + b] ?? 0);
    out[i] = byte;
  }
  return out;
}

function permute(input: Bits, table: number[]): Bits {
  const out = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = input[(table[i] ?? 1) - 1] ?? 0;
  return out;
}

function rotateLeft(half: Bits, count: number): Bits {
  const out = new Uint8Array(half.length);
  for (let i = 0; i < half.length; i++) out[i] = half[(i + count) % half.length] ?? 0;
  return out;
}

/** Las 16 subllaves de 48 bits de una llave DES de 8 bytes. */
function subkeys(key: Uint8Array): Bits[] {
  const permuted = permute(bitsOf(key, 0, 8), PC1);
  let c = permuted.subarray(0, 28);
  let d = permuted.subarray(28, 56);
  const keys: Bits[] = [];
  for (const shift of SHIFTS) {
    c = rotateLeft(c, shift);
    d = rotateLeft(d, shift);
    const cd = new Uint8Array(56);
    cd.set(c, 0);
    cd.set(d, 28);
    keys.push(permute(cd, PC2));
  }
  return keys;
}

function feistel(right: Bits, subkey: Bits): Bits {
  const expanded = permute(right, E);
  for (let i = 0; i < 48; i++) expanded[i] = (expanded[i] ?? 0) ^ (subkey[i] ?? 0);
  const out = new Uint8Array(32);
  for (let box = 0; box < 8; box++) {
    const base = box * 6;
    const row = ((expanded[base] ?? 0) << 1) | (expanded[base + 5] ?? 0);
    const column = ((expanded[base + 1] ?? 0) << 3) | ((expanded[base + 2] ?? 0) << 2) | ((expanded[base + 3] ?? 0) << 1) | (expanded[base + 4] ?? 0);
    const value = SBOX[box]?.[row * 16 + column] ?? 0;
    for (let b = 0; b < 4; b++) out[box * 4 + b] = (value >> (3 - b)) & 1;
  }
  return permute(out, P);
}

/** Un bloque de 64 bits; `decrypt` recorre las subllaves al revés. */
function desBlock(block: Uint8Array, keys: Bits[], decrypt: boolean): Uint8Array {
  const permuted = permute(bitsOf(block, 0, 8), IP);
  let left = permuted.subarray(0, 32);
  let right = permuted.subarray(32, 64);
  for (let round = 0; round < 16; round++) {
    const subkey = keys[decrypt ? 15 - round : round] ?? new Uint8Array(48);
    const f = feistel(right, subkey);
    const next = new Uint8Array(32);
    for (let i = 0; i < 32; i++) next[i] = (left[i] ?? 0) ^ (f[i] ?? 0);
    left = right;
    right = next;
  }
  const joined = new Uint8Array(64);
  joined.set(right, 0);
  joined.set(left, 32);
  return bytesOf(permute(joined, FP));
}

/**
 * Descifra `data` con Triple DES EDE en modo CBC y quita el relleno PKCS#7. Una contraseña incorrecta
 * produce relleno inválido casi siempre; el llamador lo traduce a «contraseña incorrecta».
 */
export function tripleDesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 24) throw new Error("3DES requiere una llave de 24 bytes.");
  if (iv.length !== 8) throw new Error("3DES-CBC requiere un IV de 8 bytes.");
  if (data.length === 0 || data.length % 8 !== 0) throw new Error("El texto cifrado no es múltiplo del bloque.");
  const k1 = subkeys(key.subarray(0, 8));
  const k2 = subkeys(key.subarray(8, 16));
  const k3 = subkeys(key.subarray(16, 24));
  const out = new Uint8Array(data.length);
  let previous = iv;
  for (let offset = 0; offset < data.length; offset += 8) {
    const block = data.subarray(offset, offset + 8);
    const plain = desBlock(desBlock(desBlock(block, k3, true), k2, false), k1, true);
    for (let i = 0; i < 8; i++) out[offset + i] = (plain[i] ?? 0) ^ (previous[i] ?? 0);
    previous = block;
  }
  return out;
}

/** Quita relleno PKCS#7 de bloque 8 o 16; null si no es válido. */
export function unpad(data: Uint8Array, blockSize: number): Uint8Array | null {
  if (data.length === 0 || data.length % blockSize !== 0) return null;
  const pad = data[data.length - 1] ?? 0;
  if (pad < 1 || pad > blockSize) return null;
  for (let i = data.length - pad; i < data.length; i++) if (data[i] !== pad) return null;
  return data.subarray(0, data.length - pad);
}
