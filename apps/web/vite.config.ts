import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (mode === "production" && !/^https:\/\/\S+$/.test(env.VITE_SOURCE_URL ?? "")) {
    // AGPL-3.0 §13: quien use el servicio por red debe poder obtener el código fuente.
    throw new Error("VITE_SOURCE_URL (https://…) es obligatorio en producción: la AGPL exige enlazar el código fuente.");
  }

  // og:image debe ser absoluta. VITE_SITE_URL (https://tu-dominio) la fija en producción; sin ella queda relativa.
  const site = (env.VITE_SITE_URL ?? "").replace(/\/+$/, "");
  const ogImage = `${site}/og.png`;

  return {
    plugins: [
      react(),
      {
        name: "prysma-html-env",
        transformIndexHtml: (html) => html.replaceAll("%VITE_OG_IMAGE%", ogImage),
      },
    ],
    // El worker usa import() diferido para cargar MuPDF: requiere formato ES.
    worker: { format: "es" },
    // MuPDF localiza su .wasm con import.meta.url: pre-empaquetarlo rompería la ruta en desarrollo.
    optimizeDeps: { exclude: ["mupdf"] },
    build: {
      target: "es2023",
      sourcemap: false,
      // Nada de data: URIs; todo como archivo con hash, cacheable e inmutable.
      assetsInlineLimit: 0,
    },
    server: {
      proxy: { "/v1": "http://localhost:8080" },
    },
  };
});
