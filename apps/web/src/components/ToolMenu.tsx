import { useEffect, useId, useRef, useState } from "react";
import { linkHandler } from "../lib/router.ts";
import type { Capabilities } from "../lib/server.ts";
import { CATEGORIES, availableTools } from "../tools/registry.ts";
import { Icon } from "./Icon.tsx";

/** Menú desplegable con todas las herramientas por categoría: cambiar de herramienta sin volver al inicio. */
export function ToolMenu({ capabilities, currentSlug }: { capabilities: Capabilities | null | undefined; currentSlug: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const tools = availableTools(capabilities);

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

  return (
    <div className="menu" ref={rootRef}>
      <button type="button" className="menu-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}>
        Herramientas
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div id={id} className="menu-panel">
          {CATEGORIES.map((category) => {
            const items = tools.filter((tool) => tool.category === category.id);
            if (items.length === 0) return null;
            return (
              <div key={category.id} className="menu-group">
                <p className="menu-group-title">{category.title}</p>
                <ul>
                  {items.map((tool) => (
                    <li key={tool.slug}>
                      <a
                        href={`/${tool.slug}`}
                        className="menu-item"
                        aria-current={tool.slug === currentSlug ? "page" : undefined}
                        onClick={(event) => {
                          linkHandler(`/${tool.slug}`)(event);
                          setOpen(false);
                        }}
                      >
                        <span className="menu-item-icon">
                          <Icon name={tool.icon} size={18} />
                        </span>
                        {tool.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
