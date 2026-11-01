import { defineConfig, devices } from "@playwright/test";

// Por defecto prueba el build de producción con `vite preview` (sin servidor: las herramientas de servidor
// se omiten). Para probar el stack completo con Caddy + CSP real + servidor:
//   E2E_BASE_URL=https://localhost:8443 pnpm --filter @vitropdf/web e2e
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Cada página levanta dos workers con ~10 MB de WASM y el OCR satura la VM de Docker: con más de 2
  // navegadores en paralelo aparecen esperas de minutos que no son bugs de la app (medido: load avg > 10).
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: external ?? "http://localhost:4173",
    ignoreHTTPSErrors: Boolean(external),
    acceptDownloads: true,
    trace: "retain-on-failure",
    locale: "es-MX",
  },
  // channel "chromium": Chromium completo en headless nuevo (el mismo motor que el navegador del usuario).
  // El headless shell por defecto se congelaba de forma intermitente cargando módulos WASM en workers.
  projects: [{ name: "chromium-desktop", use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1440, height: 900 } } }],
  ...(external
    ? {}
    : {
        webServer: {
          command: "pnpm build && pnpm preview --port 4173 --strictPort",
          url: "http://localhost:4173",
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          env: { VITE_SOURCE_URL: "https://example.com/vitropdf-e2e" },
        },
      }),
});
