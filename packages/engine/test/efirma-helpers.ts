import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { EngineError } from "../src/errors.ts";
import type { EngineErrorCode } from "../src/protocol.ts";

export const PASSWORD = "12345678a";

export function fixture(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`./fixtures/efirma/${name}`, import.meta.url)));
}

export async function expectCode(promise: Promise<unknown> | (() => unknown), code: EngineErrorCode, detail?: RegExp): Promise<void> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    if (detail) expect((error as EngineError).detail).toMatch(detail);
    return;
  }
  throw new Error(`Se esperaba un EngineError con código ${code}`);
}

export function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Verifica un CMS separado con OpenSSL (firma + messageDigest); la cadena no se valida (AC de prueba). */
export function opensslVerify(cms: Uint8Array, content: Uint8Array): { ok: boolean; signer: Uint8Array; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "prysma-cms-"));
  writeFileSync(join(dir, "sig.der"), cms);
  writeFileSync(join(dir, "content.bin"), content);
  try {
    const output = execFileSync(
      "openssl",
      ["cms", "-verify", "-inform", "DER", "-in", join(dir, "sig.der"), "-content", join(dir, "content.bin"), "-binary", "-noverify", "-signer", join(dir, "signer.pem"), "-out", join(dir, "verified.bin")],
      { stdio: "pipe" },
    ).toString();
    const signerPem = readFileSync(join(dir, "signer.pem"), "utf8");
    const signer = Uint8Array.from(atob(signerPem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")), (char) => char.charCodeAt(0));
    return { ok: true, signer, output };
  } catch (error) {
    return { ok: false, signer: new Uint8Array(0), output: String(error) };
  }
}

