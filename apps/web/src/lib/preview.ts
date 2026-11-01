import { EngineFailure, type PageSize } from "@vitropdf/engine";
import { useEffect, useState } from "react";
import { previewEngine } from "./engine.ts";
import { isPdf } from "./files.ts";

export interface DocumentPreview {
  status: "idle" | "loading" | "ready" | "encrypted" | "error";
  pageCount: number;
  /** Tamaño de cada página (en el alcance pedido) ya con su /Rotate original aplicado. */
  pages: PageSize[];
  /** Object URL de la miniatura de cada página; `undefined` mientras se renderiza o si falló. */
  thumbnails: Array<string | undefined>;
  /** Cuántas miniaturas va a haber en total (las páginas más allá del tope se muestran sin imagen). */
  expected: number;
  error: string | null;
}

const IDLE: DocumentPreview = { status: "idle", pageCount: 0, pages: [], thumbnails: [], expected: 0, error: null };

/** Lado mayor de la miniatura según la densidad de la pantalla: nítida en Retina sin inflar el JPEG. */
function maxEdgeFor(scope: "first" | "all"): number {
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  return Math.round((scope === "all" ? 180 : 260) * ratio);
}

/**
 * Miniaturas de un PDF renderizadas por MuPDF en un worker dedicado. Las actualizaciones se agrupan por
 * frame (300 miniaturas no son 300 renders de React) y todos los object URL se revocan al desmontar.
 */
export function useDocumentPreview(file: File | null, scope: "first" | "all"): DocumentPreview {
  const [state, setState] = useState<DocumentPreview>(IDLE);

  useEffect(() => {
    if (!file || !isPdf(file)) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    const urls: string[] = [];
    let pending: Array<{ index: number; url: string }> = [];
    let frame = 0;

    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      setState((current) => {
        const thumbnails = current.thumbnails.slice();
        for (const { index, url } of batch) thumbnails[index] = url;
        return { ...current, thumbnails };
      });
    };

    setState({ ...IDLE, status: "loading" });

    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        if (controller.signal.aborted) return;
        await previewEngine().preview(
          { name: file.name, bytes },
          { scope, maxEdge: maxEdgeFor(scope) },
          {
            signal: controller.signal,
            onInfo: (info) => {
              setState({
                status: info.encrypted ? "encrypted" : "loading",
                pageCount: info.pageCount,
                pages: info.pages,
                thumbnails: [],
                expected: info.thumbnails,
                error: null,
              });
            },
            onPage: (thumbnail) => {
              const url = URL.createObjectURL(new Blob([thumbnail.jpeg], { type: "image/jpeg" }));
              urls.push(url);
              pending.push({ index: thumbnail.index, url });
              frame ||= requestAnimationFrame(flush);
            },
          },
        );
        if (controller.signal.aborted) return;
        if (frame) {
          cancelAnimationFrame(frame);
          flush();
        }
        setState((current) => (current.status === "encrypted" ? current : { ...current, status: "ready" }));
      } catch (error) {
        if (controller.signal.aborted || (error instanceof EngineFailure && error.code === "cancelled")) return;
        const message = error instanceof EngineFailure ? error.message : "No se pudo leer el archivo.";
        if (!(error instanceof EngineFailure)) console.error(error);
        setState({ ...IDLE, status: "error", error: message });
      }
    })();

    return () => {
      controller.abort();
      if (frame) cancelAnimationFrame(frame);
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [file, scope]);

  return state;
}

/** Object URL para previsualizar una imagen local; se revoca al cambiar o desmontar. */
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  return url;
}
