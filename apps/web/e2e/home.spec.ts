import { dropFiles, expect, makePdf, test } from "./fixtures.ts";

test("la portada agrupa herramientas y el buscador filtra con «/»", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("sin subirlos");
  await expect(page.getByRole("heading", { name: "Trámites en México", exact: true })).toBeVisible();

  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Buscar herramienta" })).toBeFocused();
  await page.keyboard.type("rotar");
  await expect(page.locator(".tool-card")).toHaveCount(1);
  await expect(page.locator(".tool-card")).toContainText("Rotar PDF");
});

test("soltar PDFs en la portada sugiere herramientas y los lleva a la elegida", async ({ page }) => {
  await page.goto("/");
  await dropFiles(page, "main", [makePdf(1, "A"), makePdf(1, "B")]);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("2 archivos");
  await expect(dialog.getByRole("button", { name: /Rotar PDF/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: /Unir PDF/ }).click();
  await expect(page).toHaveURL(/\/unir-pdf$/);
  await expect(page.locator(".file-grid .file-tile:not(.is-add)")).toHaveCount(2);
});

test("el menú de herramientas navega sin recargar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Herramientas", exact: true }).click();
  await page.getByRole("link", { name: "Comprimir PDF", exact: true }).click();
  await expect(page).toHaveURL(/\/comprimir-pdf$/);
  await expect(page.getByRole("heading", { name: "Comprimir PDF" })).toBeVisible();
});
