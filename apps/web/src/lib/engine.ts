import { EngineClient } from "@vitropdf/engine";
import EngineWorker from "@vitropdf/engine/worker?worker";

let client: EngineClient | null = null;
let previewClient: EngineClient | null = null;

/** Cliente del motor para operaciones. El worker (y sus ~10 MB de WASM) se crea en el primer uso. */
export function engine(): EngineClient {
  client ??= new EngineClient(() => new EngineWorker({ name: "vitropdf-engine" }));
  return client;
}

/**
 * Worker aparte para miniaturas: renderizar 300 páginas no debe bloquear «Procesar» ni morir cuando
 * el usuario cancela una operación. En escritorio la segunda instancia de WASM (~30 MB) es asumible.
 */
export function previewEngine(): EngineClient {
  previewClient ??= new EngineClient(() => new EngineWorker({ name: "vitropdf-preview" }));
  return previewClient;
}
