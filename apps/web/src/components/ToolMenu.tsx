import { useEffect, useId, useRef, useState } from "react";
import { linkHandler } from "../lib/router.ts";
import type { Capabilities } from "../lib/server.ts";
import { CATEGORIES, TOOLS, toolStatus } from "../tools/registry.ts";
import { Icon } from "./Icon.tsx";
import { ToolStatusChip } from "./ToolStatus.tsx";

/** Panel con todas las herramientas por categoría: cambiar de herramienta sin volver al inicio. */
export function ToolMenu({ capabilities, currentSlug }: { capabilities: Capabilities | null | undefined; currentSlug: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    rootRef.current?.querySelector<HTMLAnchorElement>(".menu-panel a")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="menu" ref={rootRef}>
      <button type="button" className="menu-trigger" aria-expanded={open} aria-controls={id} aria-haspopup="true" onClick={() => setOpen((current) => !current)}>
        Herramientas
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div id={id} className="menu-panel">
          <div className="menu-columns">
            {CATEGORIES.map((category) => {
              const items = TOOLS.filter((tool) => tool.category === category.id);
              return (
                <div key={category.id} className="menu-group">
                  <p className="menu-group-title">
                    <span className="section-mark" data-category={category.id} aria-hidden="true" />
                    {category.title}
                  </p>
                  <ul>
                    {items.map((tool) => {
                      const status = toolStatus(tool, capabilities);
                      return (
                        <li key={tool.slug}>
                          <a
                            href={`/${tool.slug}`}
                            className="menu-item"
                            aria-label={tool.title}
                            aria-describedby={`${id}-${tool.slug}-summary`}
                            aria-current={tool.slug === currentSlug ? "page" : undefined}
                            data-status={tool.runtime === "server" ? status : undefined}
                            onClick={(event) => {
                              linkHandler(`/${tool.slug}`)(event);
                              close();
                            }}
                          >
                            <span className="tool-icon is-small" data-category={tool.category}>
                              <Icon name={tool.icon} size={16} />
                            </span>
                            <span className="menu-item-text">
                              <span className="menu-item-title">{tool.title}</span>
                              <span id={`${id}-${tool.slug}-summary`} className="menu-item-summary">
                                {tool.summary}
                              </span>
                            </span>
                            {tool.runtime === "server" && <ToolStatusChip status={status} variant="dot" />}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="menu-footer">
            <span>
              <kbd>/</kbd> busca cualquier herramienta desde donde estés
            </span>
            <a
              href="/"
              onClick={(event) => {
                linkHandler("/")(event);
                close();
              }}
            >
              Ver la portada
              <Icon name="arrowLeft" size={14} className="is-flipped" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
