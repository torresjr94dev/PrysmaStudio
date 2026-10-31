/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL pública del repositorio. Obligatoria en producción (AGPL-3.0 §13). */
  readonly VITE_SOURCE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
