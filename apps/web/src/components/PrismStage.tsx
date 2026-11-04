import type { Category } from "../tools/registry.ts";

/** Un rayo por categoría: el documento entra al prisma y sale descompuesto en lo que necesitas. */
const RAYS: Array<{ category: Category; label: string; y: number }> = [
  { category: "tramites", label: "Trámites", y: 104 },
  { category: "organizar", label: "Organizar", y: 142 },
  { category: "optimizar", label: "Optimizar", y: 180 },
  { category: "convertir", label: "Convertir", y: 218 },
  { category: "seguridad", label: "Seguridad", y: 256 },
];

/**
 * Escena de la portada: la metáfora de la marca (Prysma = prisma) dibujada con el propio isotipo.
 * Es decorativa (aria-hidden); el texto del hero ya lo dice todo. Reacciona a un arrastre de archivos
 * sobre la ventana: la hoja entra al prisma y los rayos se intensifican.
 */
export function PrismStage({ active }: { active: boolean }) {
  return (
    <div className={`prism-stage${active ? " is-over" : ""}`} aria-hidden="true">
      <svg className="prism-svg" viewBox="0 0 600 360" fill="none">
        <defs>
          {RAYS.map((ray) => (
            <linearGradient key={ray.category} id={`ray-${ray.category}`} className="ray-gradient" data-category={ray.category} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
              <stop offset="0.7" stopColor="currentColor" stopOpacity="0.55" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Hoja que entra */}
        <g transform="translate(62 118)">
          <g className="prism-sheet">
            <rect width="100" height="124" rx="6" className="prism-paper" />
            <rect x="18" y="24" width="46" height="4" rx="2" className="prism-ink" />
            <rect x="18" y="40" width="64" height="4" rx="2" className="prism-ink" />
            <rect x="18" y="56" width="56" height="4" rx="2" className="prism-ink" />
            <rect x="18" y="72" width="38" height="4" rx="2" className="prism-ink" />
            <rect x="18" y="98" width="28" height="4" rx="2" className="prism-ink is-strong" />
          </g>
        </g>

        {/* Haz de entrada */}
        <line x1="170" y1="180" x2="236" y2="180" className="prism-beam" />

        {/* Prisma: el isotipo a escala */}
        <g transform="rotate(45 300 180)">
          <rect x="245" y="125" width="110" height="110" rx="30" className="prism-body" />
        </g>
        <path d="M266 150c8-11 19-20 34-26" className="prism-highlight" />

        {/* Rayos de salida, uno por categoría */}
        {RAYS.map((ray, index) => (
          <line
            key={ray.category}
            x1="364"
            y1="180"
            x2="496"
            y2={ray.y}
            pathLength={1}
            className="prism-ray"
            stroke={`url(#ray-${ray.category})`}
            style={{ animationDelay: `${0.25 + index * 0.08}s` }}
          />
        ))}
        {RAYS.map((ray) => (
          <text key={ray.category} x="508" y={ray.y + 4} className="prism-label">
            {ray.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
