import { EngineClient } from "@prysmastudio/engine";
import EngineWorker from "@prysmastudio/engine/worker?worker";
import { useSyncExternalStore } from "react";

export interface EngineLoad {
  status: "idle" | "loading" | "ready";
  loaded: number;
  /** null cuando el servidor no informa el tamaño (compresión al vuelo). */
  total: number | null;
}

// Estado de descarga del motor, compartido por los dos workers. En cuanto uno lo tiene listo, el otro lo
// carga de la caché (service worker o HTTP) y sus avisos se ignoran para no reabrir el indicador.
let load: EngineLoad = { status: "idle", loaded: 0, total: null };
const listeners = new Set<() => void>();

function setLoad(next: EngineLoad): void {
  load = next;
  for (const listener of listeners) listener();
}

function track(client: EngineClient): EngineClient {
  client.onLoad((event) => {
    if (event.type === "engine.ready") {
      if (load.status !== "ready") setLoad({ status: "ready", loaded: load.loaded, total: load.total });
    } else if (load.status !== "ready") {
      setLoad({ status: "loading", loaded: event.loaded, total: event.total });
    }
  });
  return client;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Progreso de la primera descarga del motor, para mostrarlo en la interfaz. */
export function useEngineLoad(): EngineLoad {
  return useSyncExternalStore(subscribe, () => load);
}

let client: EngineClient | null = null;
let previewClient: EngineClient | null = null;

/** Cliente del motor para operaciones. El worker (y sus ~10 MB de WASM) se crea en el primer uso. */
export function engine(): EngineClient {
  client ??= track(new EngineClient(() => new EngineWorker({ name: "prysma-engine" })));
  return client;
}

/**
 * Worker aparte para miniaturas: renderizar 300 páginas no debe bloquear «Procesar» ni morir cuando
 * el usuario cancela una operación. En escritorio la segunda instancia de WASM (~30 MB) es asumible.
 */
export function previewEngine(): EngineClient {
  previewClient ??= track(new EngineClient(() => new EngineWorker({ name: "prysma-preview" })));
  return previewClient;
}
