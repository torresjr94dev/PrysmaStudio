import { dragSort, expect, makeEncryptedPdf, makePdf, makePng, readPdf, saveDownload, test } from "./fixtures.ts";

test("unir: miniaturas, arrastrar para ordenar y el resultado respeta el orden", async ({ page }) => {
  await page.goto("/unir-pdf");
  await page.locator('input[type="file"]').first().setInputFiles([makePdf(2, "A"), makePdf(1, "B")]);
  const tiles = page.locator(".file-grid .file-tile:not(.is-add)");
  await expect(tiles).toHaveCount(2);
  await expect(tiles.first()).toContainText("2 páginas");
  await expect(page.locator(".file-grid img")).toHaveCount(2);

  await dragSort(page, tiles.nth(1), tiles.nth(0));
  await expect(tiles.first()).toContainText("B.pdf");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unir PDF" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  expect((await readPdf(await saveDownload(await download))).texts).toEqual(["B1", "A1", "A2"]);
});

test("unir: un PDF protegido se marca y bloquea el proceso", async ({ page }) => {
  await page.goto("/unir-pdf");
  await page.locator('input[type="file"]').first().setInputFiles([makePdf(1, "A"), makeEncryptedPdf("x-123456")]);
  await expect(page.locator(".file-tile[data-issue]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Unir PDF" })).toBeDisabled();
  await page.locator(".file-tile[data-issue]").hover();
  await page.locator(".file-tile[data-issue]").getByRole("button", { name: "Quitar" }).click();
  await page.locator('input[type="file"]').first().setInputFiles(makePdf(1, "C"));
  await expect(page.getByRole("button", { name: "Unir PDF" })).toBeEnabled();
});

test("imágenes a PDF: una página por imagen", async ({ page }) => {
  await page.goto("/imagenes-a-pdf");
  await page.locator('input[type="file"]').first().setInputFiles([makePng(300, 200, "uno.png"), makePng(200, 300, "dos.png")]);
  await expect(page.locator(".file-grid img")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Crear PDF" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  expect((await readPdf(await saveDownload(await download))).pages).toBe(2);
});

test("INE: frente y reverso en una hoja", async ({ page }) => {
  await page.goto("/ine-ambos-lados");
  await expect(page.getByRole("button", { name: "Crear hoja" })).toBeDisabled();
  const inputs = page.locator('.slot input[type="file"]');
  await inputs.nth(0).setInputFiles(makePng(856, 540, "frente.png"));
  await inputs.nth(1).setInputFiles(makePng(856, 540, "reverso.png"));
  await expect(page.locator(".slot-body img")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Crear hoja" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  expect((await readPdf(await saveDownload(await download))).pages).toBe(1);
});
