import { expect, makeDocx, makePdf, readPdf, saveDownload, test } from "./fixtures.ts";

// Solo corren contra el stack completo (E2E_BASE_URL); con `vite preview` no hay servidor.
test.describe("herramientas de servidor", () => {
  // OCR y LibreOffice compiten por la CPU del servidor: en serie, como los usaría una persona.
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ request }) => {
    const response = await request.get("/v1/capabilities").catch(() => null);
    const capabilities = response?.ok() ? ((await response.json()) as { tools: Array<{ id: string; available: boolean }> }) : null;
    test.skip(!capabilities?.tools.every((tool) => tool.available), "El servidor de vitroPDF no está disponible");
  });

  test("Word a PDF con LibreOffice", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/word-a-pdf");
    await page.locator('input[type="file"]').first().setInputFiles(await makeDocx(["Constancia de prueba vitroPDF"]));
    await expect(page.locator(".file-card")).toContainText("DOCX");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Convertir a PDF" }).click();
    await expect(page.getByRole("heading", { name: "¡Listo!" })).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: /^Descargar \d/ }).click();
    expect((await readPdf(await saveDownload(await download))).texts.join(" ")).toContain("Constancia de prueba vitroPDF");
  });

  test("OCR reconoce el texto de un PDF", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/ocr-pdf");
    await page.locator('input[type="file"]').first().setInputFiles(makePdf(1, "Constancia"));
    await page.getByText("Reconocerlas de nuevo").click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Reconocer texto" }).click();
    await expect(page.getByRole("heading", { name: "¡Listo!" })).toBeVisible({ timeout: 150_000 });
    await page.getByRole("button", { name: /^Descargar \d/ }).click();
    expect((await readPdf(await saveDownload(await download))).texts.join(" ")).toMatch(/Constancia/i);
  });
});
