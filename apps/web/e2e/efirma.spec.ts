import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, makePdf, readPdf, saveDownload, test, type FilePayload } from "./fixtures.ts";

const FIXTURES = new URL("../../../packages/engine/test/fixtures/efirma/", import.meta.url);
const PASSWORD = "12345678a";

function credential(name: string): FilePayload {
  return { name, mimeType: "application/octet-stream", buffer: readFileSync(new URL(name, FIXTURES)) };
}

interface Signature {
  byteRange: number[];
  cms: Buffer;
  signed: Buffer;
  dictionary: string;
}

function signatureOf(bytes: Buffer): Signature {
  const text = bytes.toString("latin1");
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  if (!match) throw new Error("El PDF no tiene /ByteRange");
  const byteRange = match.slice(1).map(Number);
  const dictionary = text.slice(text.lastIndexOf(" obj", match.index), text.indexOf("endobj", match.index));
  const contents = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(dictionary);
  if (!contents) throw new Error("El PDF no tiene /Contents");
  const raw = Buffer.from(contents[1] ?? "", "hex");
  const lengthBytes = (raw[1] ?? 0) & 0x7f;
  let length = 0;
  for (let i = 0; i < lengthBytes; i++) length = length * 256 + (raw[2 + i] ?? 0);
  const [a = 0, b = 0, c = 0, d = 0] = byteRange;
  return { byteRange, cms: raw.subarray(0, 2 + lengthBytes + length), signed: Buffer.concat([bytes.subarray(a, a + b), bytes.subarray(c, c + d)]), dictionary };
}

function opensslVerifies(signature: Signature): boolean | null {
  const dir = mkdtempSync(join(tmpdir(), "prysma-e2e-"));
  writeFileSync(join(dir, "sig.der"), signature.cms);
  writeFileSync(join(dir, "content.bin"), signature.signed);
  try {
    execFileSync("openssl", ["version"], { stdio: "pipe" });
  } catch {
    return null;
  }
  try {
    execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-in", join(dir, "sig.der"), "-content", join(dir, "content.bin"), "-binary", "-noverify", "-out", join(dir, "out.bin")], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

test("firmar con e.firma: muestra al titular, rechaza la contraseña incorrecta y produce una firma PAdES verificable", async ({ page }) => {
  await page.goto("/firmar-efirma");
  await expect(page.getByRole("button", { name: "Firmar" })).toBeDisabled();
  const inputs = page.locator('.slot input[type="file"]');
  await inputs.nth(0).setInputFiles(makePdf(2, "Contrato"));
  await expect(page.locator(".slot.is-filled .thumb img")).toHaveCount(1);
  await inputs.nth(1).setInputFiles(credential("fiel.cer"));
  await expect(page.locator(".credentials-name")).toHaveText("MARIA GOMEZ LOPEZ");
  await expect(page.locator(".credentials-panel")).toContainText("GOLM850101AB1");
  await expect(page.locator(".credentials-panel")).toContainText("00001000000700005000");

  await inputs.nth(2).setInputFiles(credential("fiel.key"));
  const password = page.getByLabel("Contraseña de la llave privada");
  await password.fill("incorrecta");
  await expect(page.locator(".credentials-panel .notice.is-error")).toContainText("contraseña");
  await expect(page.getByRole("button", { name: "Firmar" })).toBeDisabled();

  await password.fill(PASSWORD);
  await expect(page.locator(".credentials-status.is-ok")).toContainText("Llave verificada");
  await expect(page.getByRole("button", { name: "Firmar" })).toBeEnabled();
  await page.getByLabel("Motivo (opcional)").fill("Conformidad con el contrato");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Firmar" }).click();
  await expect(page.getByRole("heading", { name: "¡Listo!" })).toBeVisible();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("Contrato-firmado.pdf");
  const path = await saveDownload(downloaded);
  expect((await readPdf(path)).pages).toBe(2);

  const bytes = readFileSync(path);
  const signature = signatureOf(bytes);
  expect(signature.dictionary).toContain("/SubFilter/ETSI.CAdES.detached");
  expect(signature.dictionary).toContain("/Reason(Conformidad con el contrato)");
  expect(signature.byteRange[0]).toBe(0);
  expect((signature.byteRange[2] ?? 0) + (signature.byteRange[3] ?? 0)).toBe(bytes.length);
  const verified = opensslVerifies(signature);
  if (verified !== null) expect(verified).toBe(true);
});

test("firmar con e.firma: un CSD o un certificado vencido se rechazan antes de pedir la contraseña", async ({ page }) => {
  await page.goto("/firmar-efirma");
  const inputs = page.locator('.slot input[type="file"]');
  await inputs.nth(0).setInputFiles(makePdf(1, "Contrato"));
  await inputs.nth(1).setInputFiles(credential("csd.cer"));
  await expect(page.locator(".credentials-panel .notice.is-error")).toContainText("Sello Digital");
  await inputs.nth(2).setInputFiles(credential("fiel.key"));
  await page.getByLabel("Contraseña de la llave privada").fill(PASSWORD);
  await expect(page.getByRole("button", { name: "Firmar" })).toBeDisabled();

  await page.locator(".slot").nth(1).getByRole("button", { name: /Quitar/ }).click();
  await inputs.nth(1).setInputFiles(credential("vencido.cer"));
  await expect(page.locator(".credentials-panel .notice.is-error")).toContainText("venció");
  await expect(page.getByRole("button", { name: "Firmar" })).toBeDisabled();
});
