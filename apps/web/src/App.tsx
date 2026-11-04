import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { CommandMenu } from "./components/CommandMenu.tsx";
import { usePreventFileNavigation } from "./components/FilePicker.tsx";
import { Icon } from "./components/Icon.tsx";
import { ShortcutsDialog } from "./components/ShortcutsDialog.tsx";
import { ToolMenu } from "./components/ToolMenu.tsx";
import { linkHandler, usePath, useDocumentTitle } from "./lib/router.ts";
import { fetchCapabilities, type Capabilities } from "./lib/server.ts";
import { Home } from "./pages/Home.tsx";
import { ToolPage } from "./pages/ToolPage.tsx";
import { CATEGORIES, TOOLS, findTool, type Tool } from "./tools/registry.ts";

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

function Brand() {
  return (
    <a href="/" className="brand" onClick={linkHandler("/")}>
      <img src="/icon.svg" alt="" width={24} height={24} draggable={false} />
      PrysmaStudio
    </a>
  );
}

function Footer({ tools, sourceUrl }: { tools: Tool[]; sourceUrl: string | undefined }) {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Brand />
          <p>Herramientas PDF que trabajan en tu dispositivo. Sin cuentas, sin rastreo y sin subir tus documentos a ningún lado.</p>
          <span className="chip is-success">
            <span className="chip-dot" aria-hidden="true" />
            Procesamiento local
          </span>
        </div>
        {CATEGORIES.map((category) => {
          const items = tools.filter((tool) => tool.category === category.id);
          if (items.length === 0) return null;
          return (
            <nav key={category.id} className="footer-col" aria-labelledby={`footer-${category.id}`}>
              <p id={`footer-${category.id}`} className="footer-col-title">
                {category.title}
              </p>
              <ul>
                {items.map((tool) => (
                  <li key={tool.slug}>
                    <a href={`/${tool.slug}`} onClick={linkHandler(`/${tool.slug}`)}>
                      {tool.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          );
        })}
        <nav className="footer-col" aria-labelledby="footer-proyecto">
          <p id="footer-proyecto" className="footer-col-title">
            Proyecto
          </p>
          <ul>
            {sourceUrl && (
              <>
                <li>
                  <a href={sourceUrl} rel="noopener">
                    <Icon name="code" size={14} />
                    Código fuente
                  </a>
                </li>
                <li>
                  <a href={`${sourceUrl}/issues`} rel="noopener">
                    <Icon name="bug" size={14} />
                    Reportar un problema
                  </a>
                </li>
              </>
            )}
            <li>
              <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">
                <Icon name="scale" size={14} />
                Licencia AGPL-3.0
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="footer-bottom">
        <p>© {new Date().getFullYear()} PrysmaStudio · Software libre bajo licencia AGPL-3.0.</p>
        <p>Hecho para trámites en México.</p>
      </div>
    </footer>
  );
}

export function App() {
  const path = usePath();
  // undefined = comprobando; null = no hay servidor (la app sigue funcionando en modo solo-cliente).
  const [capabilities, setCapabilities] = useState<Capabilities | null | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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

  // «/» o Ctrl/⌘+K abren la paleta y «?» el panel de atajos desde cualquier página, salvo mientras
  // se escribe en un campo o hay otro diálogo abierto.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable]");
      if (typing || document.querySelector("dialog[open]")) return;
      const commandK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (event.key === "/" || commandK) {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const slug = path.replace(/^\/+|\/+$/g, "");
  const tool = slug ? findTool(slug) : undefined;
  const sourceUrl = import.meta.env.VITE_SOURCE_URL;
  const openSearch = () => setSearchOpen(true);

  return (
    // reducedMotion="user": con «reducir movimiento» activado, motion omite transform y layout.
    <MotionConfig reducedMotion="user">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <button type="button" className="header-search" onClick={openSearch} aria-label="Buscar herramienta">
            <Icon name="search" size={16} />
            <span>Buscar herramienta…</span>
            <kbd aria-hidden="true">/</kbd>
          </button>
          <nav className="header-actions" aria-label="Principal">
            <ToolMenu capabilities={capabilities} currentSlug={slug} />
            {sourceUrl && (
              <a className="header-link" href={sourceUrl} rel="noopener" aria-label="Código fuente">
                <Icon name="code" size={16} />
                <span>Código</span>
              </a>
            )}
          </nav>
        </div>
      </header>
      <main id="contenido" className="site-main">
        {/* La página saliente se queda en posición absoluta mientras se desvanece; la losa del icono viaja
            de la tarjeta a la herramienta por layoutId. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={slug || "inicio"}
            className="route"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, position: "absolute", top: 0, left: 0, right: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {slug === "" ? (
              <Home capabilities={capabilities} onSearch={openSearch} />
            ) : tool ? (
              <ToolPage key={tool.slug} tool={tool} capabilities={capabilities} />
            ) : (
              <NotFound />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer tools={TOOLS} sourceUrl={sourceUrl} />
      <CommandMenu tools={TOOLS} capabilities={capabilities} open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {/* theme="system": sigue prefers-color-scheme; los colores los ponen los tokens en styles.css. */}
      <Toaster theme="system" position="bottom-right" offset={20} duration={4000} visibleToasts={4} gap={10} />
    </MotionConfig>
  );
}
