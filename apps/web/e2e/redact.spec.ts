import { expect, makeTextPdf, readPdf, saveDownload, test } from "./fixtures.ts";

const CURP = "GOAM850101MJCMLR09";
const RFC = "GOAM850101AB1";

test("tapar datos: encuentra CURP y RFC, deja fuera lo que se desmarca y el PDF ya no contiene lo tapado", async ({ page }) => {
  await page.goto("/tapar-datos");
  await page.locator('input[type="file"]').first().setInputFiles(makeTextPdf([["Nombre: Maria Gomez", `CURP: ${CURP}`], [`RFC: ${RFC}`, "Tel. 55 1234 5678"]]));
  await expect(page.locator(".page-tile img")).toHaveCount(2);
  await expect(page.locator(".redact-item")).toHaveCount(2);
  await expect(page.locator(".redact-mark")).toHaveCount(2);
  await expect(page.locator(".toolbar-status")).toHaveText("2 zonas marcadas en 2 páginas");

  // Un clic en la marca de la miniatura la excluye y la lista lo refleja; desde la lista se vuelve a incluir.
  await page.locator(".redact-mark").nth(1).click();
  await expect(page.getByRole("checkbox", { name: new RegExp(RFC) })).not.toBeChecked();
  await expect(page.locator(".toolbar-status")).toHaveText("1 zona marcada en 2 páginas");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tapar datos" }).click();
  await expect(page.getByRole("heading", { name: "¡Listo!" })).toBeVisible();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  const pdf = await readPdf(await saveDownload(await download));
  expect(pdf.pages).toBe(2);
  expect(pdf.texts[0]).toContain("Nombre: Maria Gomez");
  expect(pdf.texts[0]).not.toContain(CURP);
  expect(pdf.texts[1]).toContain(RFC);
});

test("tapar datos: términos propios y teléfonos se añaden a la búsqueda; sin selección no se procesa", async ({ page }) => {
  await page.goto("/tapar-datos");
  await page.locator('input[type="file"]').first().setInputFiles(makeTextPdf([["Nombre: Maria Gomez", "Tel. 55 1234 5678"]]));
  await expect(page.locator(".redact-panel")).toContainText("No se encontró ningún dato");

  await page.getByLabel("Otros datos a tapar").fill("maría gómez");
  await expect(page.locator(".redact-item")).toHaveCount(1);
  await page.getByRole("switch", { name: "Teléfonos" }).check({ force: true });
  await expect(page.locator(".redact-item")).toHaveCount(2);

  await page.getByRole("button", { name: "Ninguno" }).click();
  await page.getByRole("button", { name: "Tapar datos" }).click();
  await expect(page.locator(".notice.is-error")).toHaveText("No hay ningún dato seleccionado para tapar.");

  await page.getByRole("button", { name: "Todos" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tapar datos" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  const pdf = await readPdf(await saveDownload(await download));
  expect(pdf.texts[0]).not.toContain("Maria Gomez");
  expect(pdf.texts[0]).not.toContain("1234 5678");
  expect(pdf.texts[0]).toContain("Nombre:");
});
