import { linkHandler, useDocumentTitle } from "../lib/router.ts";
import type { Capabilities } from "../lib/server.ts";
import { TOOLS } from "../tools/registry.ts";

export function Home({ capabilities }: { capabilities: Capabilities | null | undefined }) {
  useDocumentTitle("vitroPDF · Herramientas PDF que no suben tus archivos");

  const visible = TOOLS.filter(
    (tool) => tool.runtime === "client" || capabilities?.tools.some((item) => item.id === tool.serverTool && item.available),
  );

  return (
    <>
      <section className="hero">
        <h1>Herramientas PDF que no suben tus archivos</h1>
        <p>
          Une, comprime, protege y organiza tus PDF directamente en tu navegador. Sin registro, sin límites y sin que tus
          documentos salgan de tu equipo.
        </p>
      </section>
      <ul className="tool-grid">
        {visible.map((tool) => (
          <li key={tool.slug}>
            <a href={`/${tool.slug}`} className="tool-card" onClick={linkHandler(`/${tool.slug}`)}>
              <span className="tool-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <span className="tool-title">{tool.title}</span>
              <span className="tool-summary">{tool.summary}</span>
              {tool.runtime === "server" && <span className="tool-tag">Usa el servidor</span>}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
