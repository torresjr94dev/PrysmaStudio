// API pública para la UI. No importa MuPDF: el WASM solo se carga dentro del worker.
export { EngineClient, EngineFailure, type PreviewHandlers, type RunOptions } from "./client.ts";
export { inspectCertificate, verifyCredentials } from "./efirma/public.ts";
export type * from "./protocol.ts";
