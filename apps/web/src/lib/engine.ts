import { EngineClient } from "@vitropdf/engine";
import EngineWorker from "@vitropdf/engine/worker?worker";

let client: EngineClient | null = null;

/** Cliente único del motor: el worker (y sus ~10 MB de WASM) se crea en el primer uso, no al cargar la página. */
export function engine(): EngineClient {
  client ??= new EngineClient(() => new EngineWorker({ name: "vitropdf-engine" }));
  return client;
}
