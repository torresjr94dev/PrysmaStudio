import { useEffect, useState } from "react";
import { linkHandler, usePath, useDocumentTitle } from "./lib/router.ts";
import { fetchCapabilities, type Capabilities } from "./lib/server.ts";
import { Home } from "./pages/Home.tsx";
import { ToolPage } from "./pages/ToolPage.tsx";
import { findTool } from "./tools/registry.ts";

function NotFound() {
  useDocumentTitle("Página no encontrada · vitroPDF");
  return (
    <section className="hero">
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
    <>
      <header className="site-header">
        <a href="/" className="brand" onClick={linkHandler("/")}>
          <img src="/icon.svg" alt="" width={28} height={28} />
          vitroPDF
        </a>
      </header>
      <main className="site-main">
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
    </>
  );
}
