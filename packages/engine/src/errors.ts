import type { EngineErrorCode } from "./protocol.ts";

/** Fallo esperado y tipado. El `detail` se muestra al usuario tal cual: debe ser claro y en español. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly detail: string;

  constructor(code: EngineErrorCode, detail: string, options?: { cause?: unknown }) {
    super(`${code}: ${detail}`, options);
    this.name = "EngineError";
    this.code = code;
    this.detail = detail;
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError;
}
