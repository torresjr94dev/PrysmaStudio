import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // MuPDF carga ~10 MB de WASM por archivo de test.
    testTimeout: 60_000,
  },
});
