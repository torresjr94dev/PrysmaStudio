import { useEffect, useRef } from "react";

const GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: "En toda la app",
    items: [
      { keys: ["/"], label: "Buscar herramienta" },
      { keys: ["Ctrl", "K"], label: "Buscar herramienta (también ⌘ K)" },
      { keys: ["Ctrl", "Enter"], label: "Procesar con la herramienta abierta (también ⌘ Enter)" },
      { keys: ["?"], label: "Este panel" },
      { keys: ["Esc"], label: "Cerrar menús y diálogos" },
    ],
  },
  {
    title: "Editor de páginas",
    items: [
      { keys: ["←", "→", "↑", "↓"], label: "Moverse entre páginas" },
      { keys: ["Shift", "clic"], label: "Seleccionar un rango" },
      { keys: ["Ctrl", "clic"], label: "Sumar o quitar una página de la selección" },
      { keys: ["Ctrl", "A"], label: "Seleccionar todas" },
      { keys: ["Alt", "←/→"], label: "Mover la selección" },
      { keys: ["R"], label: "Girar a la derecha (Shift R a la izquierda)" },
      { keys: ["D"], label: "Duplicar" },
      { keys: ["Supr"], label: "Eliminar" },
      { keys: ["Espacio"], label: "Seleccionar, girar o cortar según la herramienta" },
    ],
  },
  {
    title: "Lista de archivos",
    items: [
      { keys: ["Alt", "←/→"], label: "Cambiar el orden del archivo enfocado" },
      { keys: ["Supr"], label: "Quitar el archivo enfocado" },
    ],
  },
];

/** Panel de atajos: «?» lo abre desde cualquier parte. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog shortcuts"
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="shortcuts-title">Atajos de teclado</h2>
        <kbd aria-hidden="true">esc</kbd>
      </div>
      <div className="shortcuts-grid">
        {GROUPS.map((group) => (
          <section key={group.title} className="shortcuts-group" aria-labelledby={`shortcuts-${group.title}`}>
            <h3 id={`shortcuts-${group.title}`}>{group.title}</h3>
            <dl>
              {group.items.map((item) => (
                <div key={item.label} className="shortcut">
                  <dt>
                    {item.keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </dt>
                  <dd>{item.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
