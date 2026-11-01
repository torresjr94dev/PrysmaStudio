import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { usePreventFileNavigation } from "./components/FilePicker.tsx";
import { ToolMenu } from "./components/ToolMenu.tsx";
import { linkHandler, usePath, useDocumentTitle } from "./lib/router.ts";
import { fetchCapabilities, type Capabilities } from "./lib/server.ts";
import { Home } from "./pages/Home.tsx";
import { ToolPage } from "./pages/ToolPage.tsx";
import { findTool } from "./tools/registry.ts";

function NotFound() {
  useDocumentTitle("Página no encontrada · PrysmaStudio");
  return (
    <section className="tool-empty">
      <h1>Esta página no existe</h1>
      <p>
        <a href="/" onClick={linkHandler("/")}>
          Ver todas las herramientas
        </a>
      </p>
    </section>
  );
}

export function App() {
  const path = usePath();
  // undefined = comprobando; null = no hay servidor (la app sigue funcionando en modo solo-cliente).
  const [capabilities, setCapabilities] = useState<Capabilities | null | undefined>(undefined);
  usePreventFileNavigation();

  useEffect(() => {
    const controller = new AbortController();
    fetchCapabilities(controller.signal)
      .then(setCapabilities)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);

  const slug = path.replace(/^\/+|\/+$/g, "");
  const tool = slug ? findTool(slug) : undefined;
  const sourceUrl = import.meta.env.VITE_SOURCE_URL;

  return (
    // reducedMotion="user": con «reducir movimiento» activado, motion omite transform y layout.
    <MotionConfig reducedMotion="user">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <a href="/" className="brand" onClick={linkHandler("/")}>
            <img src="/icon.svg" alt="" width={24} height={24} />
            PrysmaStudio
          </a>
          <ToolMenu capabilities={capabilities} currentSlug={slug} />
        </div>
      </header>
      <main id="contenido" className="site-main">
        {slug === "" ? <Home capabilities={capabilities} /> : tool ? <ToolPage key={tool.slug} tool={tool} capabilities={capabilities} /> : <NotFound />}
      </main>
      <footer className="site-footer">
        <p>
          Software libre bajo licencia AGPL-3.0.
          {sourceUrl && (
            <>
              {" "}
              <a href={sourceUrl} rel="noopener">
                Código fuente
              </a>
              .
            </>
          )}
        </p>
      </footer>
      {/* theme="system": sigue prefers-color-scheme; los colores los ponen los tokens en styles.css. */}
      <Toaster theme="system" position="bottom-right" offset={20} duration={4000} visibleToasts={4} gap={10} />
    </MotionConfig>
  );
}
