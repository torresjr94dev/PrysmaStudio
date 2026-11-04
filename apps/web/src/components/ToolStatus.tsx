import type { ToolStatus } from "../tools/registry.ts";

const LABELS: Record<ToolStatus, { full: string; short: string; tone: string }> = {
  ready: { full: "Usa tu servidor", short: "Servidor", tone: "is-warning" },
  checking: { full: "Comprobando servidor…", short: "Servidor…", tone: "" },
  offline: { full: "Servidor no disponible", short: "Sin servidor", tone: "is-danger" },
};

type Variant = "full" | "compact" | "dot";

/**
 * Estado de una herramienta de servidor: nunca se oculta, se explica. `dot` es solo el punto emisor
 * (para listas apretadas) con el texto completo para lectores de pantalla y como tooltip.
 */
export function ToolStatusChip({ status, variant = "full" }: { status: ToolStatus; variant?: Variant }) {
  const label = LABELS[status];
  if (variant === "dot") {
    return (
      <span className={`chip is-dot ${label.tone}`.trim()} title={label.full}>
        <span className="chip-dot" aria-hidden="true" />
        <span className="visually-hidden">{label.full}</span>
      </span>
    );
  }
  return (
    <span className={`chip ${label.tone}${variant === "compact" ? " is-compact" : ""}`.trim()} title={variant === "compact" ? label.full : undefined}>
      <span className="chip-dot" aria-hidden="true" />
      {variant === "compact" ? label.short : label.full}
    </span>
  );
}
