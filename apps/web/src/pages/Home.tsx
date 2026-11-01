import { useEffect, useRef, useState, type PointerEvent } from "react";
import { CommandMenu } from "../components/CommandMenu.tsx";
import { DropOverlay, useFilePicker, useWindowFileDrop } from "../components/FilePicker.tsx";
import { Icon } from "../components/Icon.tsx";
import { matchesAccept, pluralize } from "../lib/files.ts";
import { handOffFiles } from "../lib/handoff.ts";
import { linkHandler, navigate, useDocumentTitle } from "../lib/router.ts";
import type { Capabilities } from "../lib/server.ts";
import { CATEGORIES, acceptOf, availableTools, type Tool } from "../tools/registry.ts";

/** Herramientas que pueden recibir exactamente estos archivos. */
function toolsFor(files: File[], tools: Tool[]): Tool[] {
  return tools.filter((tool) => {
    if (!files.every((file) => matchesAccept(file, acceptOf(tool)))) return false;
    const workspace = tool.workspace;
    switch (workspace.kind) {
      case "files":
        return files.length <= workspace.max;
      case "slots":
        return files.length <= workspace.slots.length;
      default:
        return files.length === 1;
    }
  });
}

const ALL_ACCEPT = "application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf";

/** El foco de luz de cada tarjeta sigue al cursor: una sola escucha por cuadrícula y dos variables CSS. */
function trackSpotlight(event: PointerEvent<HTMLElement>): void {
  const card = (event.target as HTMLElement).closest<HTMLElement>(".tool-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  card.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

export function Home({ capabilities }: { capabilities: Capabilities | null | undefined }) {
  useDocumentTitle("PrysmaStudio · Herramientas PDF que no suben tus archivos");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropped, setDropped] = useState<File[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tools = availableTools(capabilities);
  const dropActive = useWindowFileDrop(setDropped, true);
  const picker = useFilePicker({ accept: ALL_ACCEPT, multiple: true, onFiles: setDropped });

  // «/» o Ctrl/⌘+K abren la paleta desde cualquier parte, salvo mientras se escribe en un campo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable]");
      const slash = event.key === "/" && !typing;
      const commandK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (slash || commandK) {
        event.preventDefault();
        setMenuOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dropped.length > 0 && !dialog.open) dialog.showModal();
    if (dropped.length === 0 && dialog.open) dialog.close();
  }, [dropped]);

  const suggestions = toolsFor(dropped, tools);

  const openWith = (tool: Tool) => {
    handOffFiles(dropped);
    setDropped([]);
    navigate(`/${tool.slug}`);
  };

  return (
    <>
      <DropOverlay active={dropActive} label="Suelta tus archivos y elige qué hacer con ellos" />
      <section className="home-hero">
        <p className="chip is-success">
          <span className="chip-dot" aria-hidden="true" />
          Tus archivos nunca salen de tu equipo
        </p>
        <h1>Todo lo que necesitas para tus PDF, sin subirlos a ningún lado</h1>
        <p className="home-lead">
          Une, divide, comprime y protege documentos directamente en tu navegador. Sin registro y sin límites. Arrastra un
          archivo a esta página para empezar.
        </p>
        <button type="button" className="search-trigger" onClick={() => setMenuOpen(true)}>
          <Icon name="search" size={20} />
          <span>Buscar herramienta…</span>
          <kbd aria-hidden="true">/</kbd>
          <span className="beam" aria-hidden="true" />
        </button>
        <button type="button" className="button is-secondary" onClick={picker.open}>
          <Icon name="upload" size={18} />
          Elegir archivos y ver qué puedo hacer
        </button>
        {picker.input}
      </section>

      {CATEGORIES.map((category) => {
        const items = tools.filter((tool) => tool.category === category.id);
        if (items.length === 0) return null;
        return (
          <section key={category.id} className="tool-section" aria-labelledby={`cat-${category.id}`}>
            <h2 id={`cat-${category.id}`}>{category.title}</h2>
            <ul className="tool-grid" onPointerMove={trackSpotlight}>
              {items.map((tool) => (
                <li key={tool.slug}>
                  <a href={`/${tool.slug}`} className="tool-card" onClick={linkHandler(`/${tool.slug}`)}>
                    <span className="tool-icon" data-category={tool.category}>
                      <Icon name={tool.icon} size={22} />
                    </span>
                    <span className="tool-title">{tool.title}</span>
                    <span className="tool-summary">{tool.summary}</span>
                    {tool.runtime === "server" && (
                      <span className="chip is-warning tool-tag">
                        <span className="chip-dot" aria-hidden="true" />
                        Usa tu servidor
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="features" aria-label="Por qué PrysmaStudio">
        <div className="feature">
          <Icon name="laptop" size={22} />
          <h3>Se procesa en tu equipo</h3>
          <p>El motor PDF corre dentro de tu navegador. Puedes comprobarlo: funciona hasta sin internet.</p>
        </div>
        <div className="feature">
          <Icon name="shield" size={22} />
          <h3>Sin cuentas ni rastreo</h3>
          <p>No pedimos registro, no guardamos tus documentos y no hay publicidad.</p>
        </div>
        <div className="feature">
          <Icon name="idCard" size={22} />
          <h3>Hecho para trámites en México</h3>
          <p>INE por ambos lados, papel oficio y compresión al peso exacto que pide cada portal.</p>
        </div>
      </section>

      <CommandMenu tools={tools} open={menuOpen} onClose={() => setMenuOpen(false)} />

      <dialog ref={dialogRef} className="dialog" aria-labelledby="pick-title" onClose={() => setDropped([])}>
        <div className="dialog-header">
          <h2 id="pick-title">¿Qué quieres hacer con {dropped.length === 1 ? `«${dropped[0]?.name}»` : pluralize(dropped.length, "archivo", "archivos")}?</h2>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={() => setDropped([])}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {suggestions.length > 0 ? (
          <ul className="dialog-list">
            {suggestions.map((tool) => (
              <li key={tool.slug}>
                <button type="button" className="dialog-option" onClick={() => openWith(tool)}>
                  <span className="tool-icon" data-category={tool.category}>
                    <Icon name={tool.icon} size={20} />
                  </span>
                  <span>
                    <span className="tool-title">{tool.title}</span>
                    <span className="tool-summary">{tool.summary}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="notice is-warning">
            <Icon name="alert" size={18} />
            <span>Ninguna herramienta acepta esta combinación de archivos. Prueba con PDF, imágenes JPG/PNG o documentos de Office.</span>
          </p>
        )}
      </dialog>
    </>
  );
}
