import { expect, makeEncryptedPdf, makePdf, readPdf, saveDownload, test } from "./fixtures.ts";

test("proteger: valida contraseñas y genera un PDF cifrado", async ({ page }) => {
  await page.goto("/proteger-pdf");
  await page.locator('input[type="file"]').first().setInputFiles(makePdf(1, "P"));
  await expect(page.locator(".file-card img")).toBeVisible();

  await page.getByLabel("Contraseña", { exact: true }).fill("méxico-2026");
  await page.getByLabel("Repite la contraseña").fill("otra-cosa");
  await page.getByRole("button", { name: "Proteger PDF" }).click();
  await expect(page.locator(".notice.is-error")).toHaveText("Las contraseñas no coinciden.");

  await page.getByLabel("Repite la contraseña").fill("méxico-2026");
  await page.getByRole("switch", { name: "Copiar texto" }).check({ force: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Proteger PDF" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  const path = await saveDownload(await download);
  expect((await readPdf(path)).encrypted).toBe(true);
  expect((await readPdf(path, "méxico-2026")).texts).toEqual(["P1"]);
});

test("quitar contraseña: con la correcta entrega un PDF sin cifrado", async ({ page }) => {
  await page.goto("/desbloquear-pdf");
  await page.locator('input[type="file"]').first().setInputFiles(makeEncryptedPdf("clave-123"));
  await expect(page.locator(".file-card")).toContainText("Protegido con contraseña");

  await page.getByLabel("Contraseña actual").fill("incorrecta");
  await page.getByRole("button", { name: "Quitar contraseña" }).click();
  await expect(page.locator(".notice.is-error")).toContainText("no es correcta");

  await page.getByLabel("Contraseña actual").fill("clave-123");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Quitar contraseña" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  const pdf = await readPdf(await saveDownload(await download));
  expect(pdf.encrypted).toBe(false);
  expect(pdf.texts).toEqual(["S1", "S2"]);
});

test("comprimir a un peso objetivo muestra el resultado y permite seguir editando", async ({ page }) => {
  await page.goto("/comprimir-pdf");
  await page.locator('input[type="file"]').first().setInputFiles(makePdf(3, "C"));
  await page.getByText("Que pese menos de…").click();
  await expect(page.getByLabel("Peso máximo")).toHaveValue("2");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("heading", { name: "¡Listo!" })).toBeVisible();
  await page.getByRole("button", { name: "Seguir editando" }).click();
  await expect(page.locator(".file-card")).toContainText("C.pdf");
});
