import { motion } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DropOverlay, useFilePicker, useWindowFileDrop } from "../components/FilePicker.tsx";
import { Icon } from "../components/Icon.tsx";
import { PrismStage } from "../components/PrismStage.tsx";
import { IneArt, ToolArt } from "../components/ToolArt.tsx";
import { ToolStatusChip } from "../components/ToolStatus.tsx";
import { matchesAccept, pluralize } from "../lib/files.ts";
import { handOffFiles } from "../lib/handoff.ts";
import { linkHandler, navigate, useDocumentTitle } from "../lib/router.ts";
import type { Capabilities } from "../lib/server.ts";
import { CATEGORIES, TOOLS, acceptOf, toolStatus, type Tool } from "../tools/registry.ts";

/** Herramientas listas que pueden recibir exactamente estos archivos. */
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

interface Props {
  capabilities: Capabilities | null | undefined;
  /** Abre la paleta de comandos global (vive en App). */
  onSearch: () => void;
}

export function Home({ capabilities, onSearch }: Props) {
  useDocumentTitle("PrysmaStudio · Herramientas PDF que no suben tus archivos");
  const [dropped, setDropped] = useState<File[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dropActive = useWindowFileDrop(setDropped, true);
  const picker = useFilePicker({ accept: ALL_ACCEPT, multiple: true, onFiles: setDropped });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dropped.length > 0 && !dialog.open) dialog.showModal();
    if (dropped.length === 0 && dialog.open) dialog.close();
  }, [dropped]);

  const ready = TOOLS.filter((tool) => toolStatus(tool, capabilities) === "ready");
  const suggestions = toolsFor(dropped, ready);

  const openWith = (tool: Tool) => {
    handOffFiles(dropped);
    setDropped([]);
    navigate(`/${tool.slug}`);
  };

  return (
    <>
      <DropOverlay active={dropActive} label="Suelta tus archivos y elige qué hacer con ellos" />
      <section className="home-hero">
        <div className="hero-copy">
          <p className="chip is-success">
            <span className="chip-dot" aria-hidden="true" />
            Tus archivos nunca salen de tu equipo
          </p>
          <h1>Todo lo que necesitas para tus PDF, sin subirlos a ningún lado</h1>
          <p className="home-lead">
            Une, divide, comprime y protege documentos directamente en tu navegador. Sin registro y sin límites. Arrastra un
            archivo a esta página para empezar.
          </p>
          <div className="hero-actions">
            <button type="button" className="search-trigger" onClick={onSearch}>
              <Icon name="search" size={20} />
              <span>Buscar herramienta…</span>
              <kbd aria-hidden="true">/</kbd>
              <span className="beam" aria-hidden="true" />
            </button>
            <button type="button" className="button is-secondary is-large" onClick={picker.open}>
              <Icon name="upload" size={18} />
              Elegir archivos
            </button>
          </div>
          {picker.input}
        </div>
        <PrismStage active={dropActive} />
      </section>

      <div className="spectrum-line" aria-hidden="true" />

      {CATEGORIES.map((category) => {
        const items = TOOLS.filter((tool) => tool.category === category.id);
        if (items.length === 0) return null;
        return (
          <section key={category.id} className="tool-section" aria-labelledby={`cat-${category.id}`}>
            <h2 id={`cat-${category.id}`}>
              <span className="section-mark" data-category={category.id} aria-hidden="true" />
              {category.title}
              <span className="section-count" aria-hidden="true">
                {String(items.length).padStart(2, "0")}
              </span>
            </h2>
            <ul className="tool-grid" onPointerMove={trackSpotlight}>
              {items.map((tool) => (
                <li key={tool.slug} className={tool.featured ? "is-featured" : undefined}>
                  <a href={`/${tool.slug}`} className={`tool-card${tool.featured ? " is-featured" : ""}`} onClick={linkHandler(`/${tool.slug}`)}>
                    <span className="tool-card-body">
                      <motion.span className="tool-icon" data-category={tool.category} layoutId={`tool-${tool.slug}`}>
                        <Icon name={tool.icon} size={22} />
                      </motion.span>
                      <span className="tool-title">{tool.title}</span>
                      <span className="tool-summary">{tool.summary}</span>
                      {tool.runtime === "server" && (
                        <span className="tool-tag">
                          <ToolStatusChip status={toolStatus(tool, capabilities)} />
                        </span>
                      )}
                    </span>
                    {tool.featured ? <IneArt /> : <ToolArt slug={tool.slug} />}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="features" aria-label="Por qué PrysmaStudio">
        <article className="feature">
          <span className="tool-icon" data-category="optimizar">
            <Icon name="laptop" size={22} />
          </span>
          <h3>Se procesa en tu equipo</h3>
          <p>El motor PDF corre dentro de tu navegador. Puedes comprobarlo: funciona hasta sin internet.</p>
        </article>
        <article className="feature">
          <span className="tool-icon" data-category="organizar">
            <Icon name="shield" size={22} />
          </span>
          <h3>Sin cuentas ni rastreo</h3>
          <p>No pedimos registro, no guardamos tus documentos y no hay publicidad.</p>
        </article>
        <article className="feature">
          <span className="tool-icon" data-category="tramites">
            <Icon name="idCard" size={22} />
          </span>
          <h3>Hecho para trámites en México</h3>
          <p>INE por ambos lados, papel oficio y compresión al peso exacto que pide cada portal.</p>
        </article>
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
                  <span className="tool-icon is-small" data-category={tool.category}>
                    <Icon name={tool.icon} size={18} />
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
