import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { navigate } from "../lib/router.ts";
import { CATEGORIES, type Tool } from "../tools/registry.ts";
import { Icon } from "./Icon.tsx";

/** Búsqueda sin acentos ni mayúsculas: «comprimir» encuentra «Comprimir PDF»; «ine», «INE». */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

interface Props {
  tools: Tool[];
  open: boolean;
  onClose: () => void;
}

/**
 * Paleta de comandos (estilo ⌘K): se abre con «/» o Ctrl/⌘+K, filtra mientras se escribe y se navega
 * con las flechas. Es un <dialog> nativo: trampa de foco, Escape y devolver el foco vienen gratis.
 */
export function CommandMenu({ tools, open, onClose }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const terms = normalize(query.trim());
  const matches = terms ? tools.filter((tool) => normalize(`${tool.title} ${tool.summary}`).includes(terms)) : tools;
  const index = Math.min(active, matches.length - 1);
  const current = matches[index];

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const choose = (tool: Tool) => {
    onClose();
    navigate(`/${tool.slug}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive(Math.min(matches.length - 1, index + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive(Math.max(0, index - 1));
        return;
      case "Enter":
        event.preventDefault();
        if (current) choose(current);
        return;
      default:
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog command"
      aria-label="Buscar herramienta"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-input">
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          type="search"
          placeholder="¿Qué quieres hacer con tu PDF?"
          aria-label="Buscar herramienta"
          aria-controls={`${id}-list`}
          aria-activedescendant={current ? `${id}-${current.slug}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true">esc</kbd>
      </div>
      {matches.length === 0 ? (
        <p className="command-empty">Ninguna herramienta coincide con «{query}». Prueba con «unir», «comprimir» o «INE».</p>
      ) : (
        <ul ref={listRef} id={`${id}-list`} className="command-list" role="listbox" aria-label="Herramientas">
          {CATEGORIES.map((category) => {
            const items = matches.filter((tool) => tool.category === category.id);
            if (items.length === 0) return null;
            return [
              <li key={`title-${category.id}`} role="presentation" className="command-group-title">
                {category.title}
              </li>,
              ...items.map((tool) => (
                <li
                  key={tool.slug}
                  id={`${id}-${tool.slug}`}
                  role="option"
                  aria-selected={tool === current}
                  className="command-item"
                  onPointerMove={() => setActive(matches.indexOf(tool))}
                  onClick={() => choose(tool)}
                >
                  <span className="tool-icon" data-category={tool.category}>
                    <Icon name={tool.icon} size={18} />
                  </span>
                  <span className="command-item-text">
                    <span className="tool-title">{tool.title}</span>
                    <span className="tool-summary">{tool.summary}</span>
                  </span>
                  <kbd className="command-item-hint" aria-hidden="true">
                    ↵
                  </kbd>
                </li>
              )),
            ];
          })}
        </ul>
      )}
      <div className="command-footer" aria-hidden="true">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navegar
        </span>
        <span>
          <kbd>↵</kbd> abrir
        </span>
        <span>
          <kbd>esc</kbd> cerrar
        </span>
      </div>
    </dialog>
  );
}
