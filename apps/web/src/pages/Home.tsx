import { useEffect, useRef, useState } from "react";
import { DropOverlay, useFilePicker, useWindowFileDrop } from "../components/FilePicker.tsx";
import { Icon } from "../components/Icon.tsx";
import { matchesAccept, pluralize } from "../lib/files.ts";
import { handOffFiles } from "../lib/handoff.ts";
import { linkHandler, navigate, useDocumentTitle } from "../lib/router.ts";
import type { Capabilities } from "../lib/server.ts";
import { CATEGORIES, acceptOf, availableTools, type Tool } from "../tools/registry.ts";

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

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

export function Home({ capabilities }: { capabilities: Capabilities | null | undefined }) {
  useDocumentTitle("PrysmaStudio · Herramientas PDF que no suben tus archivos");
  const [query, setQuery] = useState("");
  const [dropped, setDropped] = useState<File[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tools = availableTools(capabilities);
  const dropActive = useWindowFileDrop(setDropped, true);
  const picker = useFilePicker({ accept: ALL_ACCEPT, multiple: true, onFiles: setDropped });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable]");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
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

  const terms = normalize(query.trim());
  const matches = terms ? tools.filter((tool) => normalize(`${tool.title} ${tool.summary}`).includes(terms)) : tools;
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
        <p className="eyebrow">
          <Icon name="shield" size={16} />
          Tus archivos nunca salen de tu equipo
        </p>
        <h1>Todo lo que necesitas para tus PDF, sin subirlos a ningún lado</h1>
        <p className="home-lead">
          Une, divide, comprime y protege documentos directamente en tu navegador. Sin registro y sin límites. Arrastra un
          archivo a esta página para empezar.
        </p>
        <div className="home-search">
          <Icon name="search" size={20} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Buscar herramienta…"
            aria-label="Buscar herramienta"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd aria-hidden="true">/</kbd>
        </div>
        <button type="button" className="button is-ghost" onClick={picker.open}>
          <Icon name="upload" size={18} />
          Elegir archivos y ver qué puedo hacer
        </button>
        {picker.input}
      </section>

      {matches.length === 0 && <p className="empty-search">Ninguna herramienta coincide con «{query}».</p>}

      {CATEGORIES.map((category) => {
        const items = matches.filter((tool) => tool.category === category.id);
        if (items.length === 0) return null;
        return (
          <section key={category.id} className="tool-section" aria-labelledby={`cat-${category.id}`}>
            <h2 id={`cat-${category.id}`}>{category.title}</h2>
            <ul className="tool-grid">
              {items.map((tool) => (
                <li key={tool.slug}>
                  <a href={`/${tool.slug}`} className="tool-card" onClick={linkHandler(`/${tool.slug}`)}>
                    <span className="tool-icon" data-category={tool.category}>
                      <Icon name={tool.icon} size={22} />
                    </span>
                    <span className="tool-title">{tool.title}</span>
                    <span className="tool-summary">{tool.summary}</span>
                    {tool.runtime === "server" && (
                      <span className="tool-tag">
                        <Icon name="cloud" size={14} />
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
