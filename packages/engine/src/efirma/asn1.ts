// Lector y escritor DER mínimos para lo que necesita la e.firma: certificados X.509, llaves PKCS#8
// cifradas y la estructura CMS SignedData de la firma. Sin dependencias: corre igual en el worker,
// en la interfaz y en Node.
import { EngineError } from "../errors.ts";
import type { EngineErrorCode } from "../protocol.ts";

export const TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  null: 0x05,
  oid: 0x06,
  utf8String: 0x0c,
  printableString: 0x13,
  t61String: 0x14,
  ia5String: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18,
  bmpString: 0x1e,
  sequence: 0x30,
  set: 0x31,
} as const;

/** Límite de anidamiento: un DER legítimo de estas estructuras no pasa de ~12 niveles. */
const MAX_DEPTH = 32;

export interface DerNode {
  /** Octeto de identificación completo (clase + constructed + número de etiqueta, solo etiquetas < 31). */
  tag: number;
  constructed: boolean;
  /** Bytes del TLV completo (cabecera incluida), como vista sobre el buffer original. */
  raw: Uint8Array;
  /** Bytes del contenido (sin cabecera). */
  content: Uint8Array;
}

export class DerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DerError";
  }
}

/** Copia a un buffer propio: WebCrypto exige vistas sobre ArrayBuffer (no SharedArrayBuffer ni Buffer de Node). */
export function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function readHeader(bytes: Uint8Array, offset: number): { tag: number; constructed: boolean; start: number; length: number } {
  if (offset + 2 > bytes.length) throw new DerError("Estructura DER truncada.");
  const tag = bytes[offset] ?? 0;
  if ((tag & 0x1f) === 0x1f) throw new DerError("Etiqueta DER de varios octetos no admitida.");
  let cursor = offset + 1;
  let first = bytes[cursor] ?? 0;
  cursor++;
  let length: number;
  if (first < 0x80) {
    length = first;
  } else {
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new DerError("Longitud DER indefinida o desmesurada.");
    if (cursor + count > bytes.length) throw new DerError("Estructura DER truncada.");
    length = 0;
    for (let i = 0; i < count; i++) {
      first = bytes[cursor + i] ?? 0;
      length = length * 256 + first;
    }
    cursor += count;
    if (length < 0x80) throw new DerError("Longitud DER no mínima.");
  }
  if (cursor + length > bytes.length) throw new DerError("Estructura DER truncada.");
  return { tag, constructed: (tag & 0x20) !== 0, start: cursor, length };
}

/** Lee el TLV que empieza en `offset`. */
export function readDer(bytes: Uint8Array, offset = 0): DerNode {
  const header = readHeader(bytes, offset);
  return {
    tag: header.tag,
    constructed: header.constructed,
    raw: bytes.subarray(offset, header.start + header.length),
    content: bytes.subarray(header.start, header.start + header.length),
  };
}

/** Lee el único TLV que debe ocupar todo el buffer. */
export function readDerExact(bytes: Uint8Array): DerNode {
  const node = readDer(bytes, 0);
  if (node.raw.length !== bytes.length) throw new DerError("Hay datos después de la estructura DER.");
  return node;
}

/** Hijos de un nodo constructed, en orden. */
export function childrenOf(node: DerNode, depth = 0): DerNode[] {
  if (!node.constructed) throw new DerError("Se esperaba una estructura DER compuesta.");
  if (depth > MAX_DEPTH) throw new DerError("Estructura DER demasiado anidada.");
  const out: DerNode[] = [];
  let offset = 0;
  while (offset < node.content.length) {
    const child = readDer(node.content, offset);
    out.push(child);
    offset += child.raw.length;
  }
  return out;
}

export function expectTag(node: DerNode, tag: number, what: string): DerNode {
  if (node.tag !== tag) throw new DerError(`${what}: se esperaba la etiqueta 0x${tag.toString(16)} y llegó 0x${node.tag.toString(16)}.`);
  return node;
}

export function sequenceOf(node: DerNode, what: string): DerNode[] {
  return childrenOf(expectTag(node, TAG.sequence, what));
}

/** Etiqueta específica de contexto [n] (constructed o primitiva). */
export function isContext(node: DerNode, number: number): boolean {
  return (node.tag & 0xc0) === 0x80 && (node.tag & 0x1f) === number;
}

export function oidOf(node: DerNode): string {
  expectTag(node, TAG.oid, "OID");
  const bytes = node.content;
  if (bytes.length === 0) throw new DerError("OID vacío.");
  const parts: number[] = [];
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER) throw new DerError("OID desmesurado.");
    if ((byte & 0x80) === 0) {
      if (parts.length === 0) {
        const first = value < 40 ? 0 : value < 80 ? 1 : 2;
        parts.push(first, value - first * 40);
      } else {
        parts.push(value);
      }
      value = 0;
    }
  }
  if (value !== 0) throw new DerError("OID truncado.");
  return parts.join(".");
}

/** INTEGER como bytes big-endian sin el cero de signo. Los negativos no tienen sentido aquí. */
export function integerBytesOf(node: DerNode): Uint8Array {
  expectTag(node, TAG.integer, "INTEGER");
  let bytes = node.content;
  if (bytes.length === 0) throw new DerError("INTEGER vacío.");
  if (((bytes[0] ?? 0) & 0x80) !== 0) throw new DerError("INTEGER negativo inesperado.");
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  return bytes;
}

/** INTEGER pequeño (versiones, iteraciones, tamaños). */
export function smallIntegerOf(node: DerNode): number {
  const bytes = integerBytesOf(node);
  if (bytes.length > 4) throw new DerError("INTEGER demasiado grande.");
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

export function octetStringOf(node: DerNode): Uint8Array {
  return expectTag(node, TAG.octetString, "OCTET STRING").content;
}

/** BIT STRING como bytes (ignora los bits de relleno; aquí siempre son 0 o se usan como banderas). */
export function bitStringOf(node: DerNode): { unusedBits: number; bytes: Uint8Array } {
  expectTag(node, TAG.bitString, "BIT STRING");
  if (node.content.length === 0) throw new DerError("BIT STRING vacío.");
  return { unusedBits: node.content[0] ?? 0, bytes: node.content.subarray(1) };
}

const utf8 = new TextDecoder("utf-8", { fatal: false });
const latin1 = new TextDecoder("latin1");

/** Cadenas de nombres X.500: UTF8, Printable, IA5, T61 (se asume Latin-1) y BMP (UTF-16BE). */
export function stringOf(node: DerNode): string {
  switch (node.tag) {
    case TAG.utf8String:
      return utf8.decode(node.content);
    case TAG.printableString:
    case TAG.ia5String:
    case TAG.t61String:
      return latin1.decode(node.content);
    case TAG.bmpString: {
      let out = "";
      for (let i = 0; i + 1 < node.content.length; i += 2) out += String.fromCharCode(((node.content[i] ?? 0) << 8) | (node.content[i + 1] ?? 0));
      return out;
    }
    default:
      throw new DerError(`Tipo de cadena DER no admitido (0x${node.tag.toString(16)}).`);
  }
}

/** UTCTime (YYMMDDHHMMSSZ) o GeneralizedTime (YYYYMMDDHHMMSSZ) a Date. */
export function timeOf(node: DerNode): Date {
  const text = latin1.decode(node.content);
  let match: RegExpExecArray | null;
  let year: number;
  if (node.tag === TAG.utcTime) {
    match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text);
    if (!match) throw new DerError(`UTCTime inválido: ${text}`);
    const short = Number(match[1]);
    year = short < 50 ? 2000 + short : 1900 + short;
  } else if (node.tag === TAG.generalizedTime) {
    match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(text);
    if (!match) throw new DerError(`GeneralizedTime inválido: ${text}`);
    year = Number(match[1]);
  } else {
    throw new DerError("Se esperaba una fecha.");
  }
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? "0")));
  if (Number.isNaN(date.getTime())) throw new DerError(`Fecha inválida: ${text}`);
  return date;
}

// ---------- Escritura ----------

function encodeLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let rest = length;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function tlv(tag: number, content: Uint8Array): Uint8Array {
  return concat([Uint8Array.from([tag, ...encodeLength(content.length)]), content]);
}

export const der = {
  sequence: (...items: Uint8Array[]): Uint8Array => tlv(TAG.sequence, concat(items)),
  /** SET OF en DER: los elementos van ordenados por su codificación. */
  setOf: (...items: Uint8Array[]): Uint8Array => tlv(TAG.set, concat([...items].sort(compareBytes))),
  /** SET (no "OF") con un solo elemento: el orden no aplica. */
  set: (...items: Uint8Array[]): Uint8Array => tlv(TAG.set, concat(items)),
  oid: (text: string): Uint8Array => {
    const parts = text.split(".").map(Number);
    if (parts.length < 2 || parts.some((part) => !Number.isInteger(part) || part < 0)) throw new DerError(`OID inválido: ${text}`);
    const bytes: number[] = [];
    const push = (value: number) => {
      const chunk: number[] = [value & 0x7f];
      let rest = Math.floor(value / 128);
      while (rest > 0) {
        chunk.unshift((rest & 0x7f) | 0x80);
        rest = Math.floor(rest / 128);
      }
      bytes.push(...chunk);
    };
    push((parts[0] ?? 0) * 40 + (parts[1] ?? 0));
    for (const part of parts.slice(2)) push(part);
    return tlv(TAG.oid, Uint8Array.from(bytes));
  },
  integer: (value: number | Uint8Array): Uint8Array => {
    let bytes: number[];
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0) throw new DerError("Solo se codifican enteros no negativos.");
      bytes = [];
      let rest = value;
      do {
        bytes.unshift(rest & 0xff);
        rest = Math.floor(rest / 256);
      } while (rest > 0);
    } else {
      bytes = Array.from(value);
      while (bytes.length > 1 && bytes[0] === 0) bytes.shift();
    }
    if (((bytes[0] ?? 0) & 0x80) !== 0) bytes.unshift(0);
    return tlv(TAG.integer, Uint8Array.from(bytes));
  },
  octetString: (bytes: Uint8Array): Uint8Array => tlv(TAG.octetString, bytes),
  null: (): Uint8Array => Uint8Array.from([TAG.null, 0]),
  utf8String: (text: string): Uint8Array => tlv(TAG.utf8String, new TextEncoder().encode(text)),
  /** [n] EXPLICIT: envuelve el contenido en una etiqueta de contexto constructed. */
  explicit: (number: number, ...items: Uint8Array[]): Uint8Array => tlv(0xa0 | number, concat(items)),
  /** [n] IMPLICIT sobre un SET OF: cambia la etiqueta del conjunto ya ordenado. */
  implicitSetOf: (number: number, ...items: Uint8Array[]): Uint8Array => tlv(0xa0 | number, concat([...items].sort(compareBytes))),
};

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

/** Quita la envoltura PEM si la hay (los .cer/.key del SAT son DER, pero mucha gente los convierte). */
export function pemToDer(bytes: Uint8Array, expectedLabel: RegExp): Uint8Array {
  const head = latin1.decode(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (!head.includes("-----BEGIN")) return bytes;
  const text = latin1.decode(bytes);
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!match) throw new DerError("Archivo PEM incompleto.");
  if (!expectedLabel.test(match[1] ?? "")) throw new DerError(`El archivo PEM contiene «${match[1]}», no lo que se esperaba.`);
  const base64 = (match[2] ?? "").replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch (cause) {
    throw new DerError("El archivo PEM no contiene base64 válido.", { cause });
  }
}

/** Convierte un fallo DER en un error tipado para el usuario; cualquier otro error se propaga. */
export function derError(cause: unknown, detail: string, code: EngineErrorCode = "input.invalid"): EngineError {
  if (cause instanceof DerError) return new EngineError(code, `${detail} (${cause.message})`, { cause });
  if (cause instanceof EngineError) return cause;
  return new EngineError(code, detail, { cause });
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new DerError("Hexadecimal inválido.");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && compareBytes(a, b) === 0;
}
