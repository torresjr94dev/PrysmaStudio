import { CFDI_UUID, expect, makeCfdi, readPdf, saveDownload, test } from "./fixtures.ts";

test("CFDI a PDF: representación impresa con folio fiscal, totales, importe con letra y pie legal", async ({ page }) => {
  await page.goto("/cfdi-a-pdf");
  await page.locator('input[type="file"]').first().setInputFiles([makeCfdi()]);
  await expect(page.locator(".file-grid .doc-extension")).toHaveText("XML");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Crear PDF" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  const pdf = await readPdf(await saveDownload(await download));
  expect(pdf.pages).toBe(1);
  const text = pdf.texts[0] ?? "";
  for (const needle of [CFDI_UUID, "EKU9003173C9", "ESCUELA KEMPER URGATE", "$905.67", "NOVECIENTOS CINCO PESOS 67/100 M.N.", "representación impresa de un CFDI", "SPR190613I52"]) {
    expect(text, needle).toContain(needle);
  }
});

test("CFDI a PDF: un XML que no es del SAT explica el error con el nombre del archivo", async ({ page }) => {
  await page.goto("/cfdi-a-pdf");
  await page.locator('input[type="file"]').first().setInputFiles([{ name: "otro.xml", mimeType: "text/xml", buffer: Buffer.from("<nota>hola</nota>", "utf8") }]);
  await page.getByRole("button", { name: "Crear PDF" }).click();
  await expect(page.locator(".notice.is-error")).toContainText("«otro.xml»");
  await expect(page.locator(".notice.is-error")).toContainText("no es un CFDI");
});
