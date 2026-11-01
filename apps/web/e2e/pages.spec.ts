import { dragSort, expect, makeEncryptedPdf, makePdf, readPdf, saveDownload, test, zipEntries } from "./fixtures.ts";

async function openWith(page: import("@playwright/test").Page, slug: string, pdf: ReturnType<typeof makePdf>, pages: number) {
  await page.goto(`/${slug}`);
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  await expect(page.locator(".page-tile img")).toHaveCount(pages);
}

test("organizar: teclado para mover, girar, duplicar y eliminar; el PDF refleja el resultado", async ({ page }) => {
  await openWith(page, "organizar-pdf", makePdf(3, "O"), 3);

  await page.getByRole("option", { name: "Página 3" }).click();
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("r");
  await expect(page.locator(".page-tile").first()).toHaveAttribute("aria-label", "Página 3, girada 90°");

  await page.getByRole("option", { name: "Página 1" }).click();
  await page.keyboard.press("d");
  await page.getByRole("option", { name: "Página 2" }).click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".toolbar-status")).toHaveText("3 páginas");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar PDF" }).click();
  await expect(page.getByRole("heading", { name: "¡Listo!" })).toBeVisible();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  const pdf = await readPdf(await saveDownload(await download));
  expect(pdf.texts).toEqual(["O3", "O1", "O1"]);
  expect(pdf.rotations).toEqual([90, 0, 0]);
});

test("organizar: arrastrar y soltar reordena páginas", async ({ page }) => {
  await openWith(page, "organizar-pdf", makePdf(3, "D"), 3);
  const third = page.getByRole("option", { name: "Página 3" });
  const first = page.getByRole("option", { name: "Página 1" });
  await dragSort(page, third, first);
  await expect(page.locator(".page-tile").first()).toHaveAttribute("aria-label", "Página 3");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar PDF" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  expect((await readPdf(await saveDownload(await download))).texts).toEqual(["D3", "D1", "D2"]);
});

test("rotar: clic en una página la gira y solo esa cambia", async ({ page }) => {
  await openWith(page, "rotar-pdf", makePdf(2, "R"), 2);
  await expect(page.getByRole("button", { name: "Guardar PDF" })).toBeEnabled();
  await page.getByRole("button", { name: "Guardar PDF" }).click();
  await expect(page.locator(".notice.is-error")).toHaveText("Gira al menos una página.");

  await page.getByRole("listitem", { name: "Página 2" }).click();
  await expect(page.getByRole("listitem", { name: "Página 2, girada 90°" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar PDF" }).click();
  await page.getByRole("button", { name: /^Descargar \d/ }).click();
  expect((await readPdf(await saveDownload(await download))).rotations).toEqual([0, 90]);
});

test("dividir: cortes con tijeras y descarga en ZIP", async ({ page }) => {
  await openWith(page, "dividir-pdf", makePdf(4, "S"), 4);
  await page.getByRole("button", { name: "Dividir" }).click();
  await expect(page.locator(".notice.is-error")).toHaveText("Marca al menos un corte entre dos páginas.");

  await page.getByRole("button", { name: "Cortar después de la página 2" }).click();
  await expect(page.locator(".toolbar-status")).toHaveText("4 páginas → 2 archivos");
  await page.getByRole("button", { name: "Dividir" }).click();
  await expect(page.getByText("Se generaron 2 archivos.")).toBeVisible();
  await expect(page.locator(".result-list li")).toHaveCount(2);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar todo (.zip)" }).click();
  const zip = await download;
  expect(zip.suggestedFilename()).toBe("S-dividir-pdf.zip");
  expect(await zipEntries(await saveDownload(zip))).toBe(2);
});

test("dividir cada N páginas dibuja los cortes automáticamente", async ({ page }) => {
  await openWith(page, "dividir-pdf", makePdf(5, "N"), 5);
  await page.getByText("Cada N páginas").click();
  await page.getByRole("button", { name: "Aumentar" }).click();
  await expect(page.locator(".toolbar-status")).toHaveText("5 páginas → 2 archivos");
});

test("un PDF protegido muestra aviso y bloquea las herramientas de páginas", async ({ page }) => {
  await page.goto("/organizar-pdf");
  await page.locator('input[type="file"]').first().setInputFiles(makeEncryptedPdf("clave-123"));
  await expect(page.getByText("Este PDF está protegido con contraseña.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar PDF" })).toBeDisabled();
});
