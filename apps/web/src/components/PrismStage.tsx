import { CATEGORIES, type Category } from "../tools/registry.ts";

/** Orden de los rayos tal como salen del prisma en el logo (de arriba abajo: magenta → verde). */
const RAY_ORDER: Category[] = ["tramites", "organizar", "optimizar", "convertir", "seguridad"];

/**
 * Escena de la portada: el logo (prisma de vidrio con haz y espectro) sobre un escenario oscuro de
 * vidrio, con la hoja que entra por el haz y la leyenda de categorías como «espectro» de salida.
 * Es decorativa (aria-hidden); el texto del hero ya lo dice todo. Reacciona a un arrastre de archivos
 * sobre la ventana: la hoja viaja hacia el prisma y la luz se intensifica.
 */
export function PrismStage({ active }: { active: boolean }) {
  return (
    <div className={`prism-stage${active ? " is-over" : ""}`} aria-hidden="true">
      <div className="prism-scene">
        <img
          className="prism-logo"
          src="/brand/prisma.webp"
          srcSet="/brand/prisma-700.webp 700w, /brand/prisma.webp 1400w"
          sizes="(max-width: 900px) 100vw, 640px"
          width={1400}
          height={493}
          alt=""
          decoding="async"
          fetchPriority="high"
          draggable={false}
        />
        {/* Misma caja de coordenadas que la imagen: la hoja queda alineada con el haz. */}
        <svg className="prism-overlay" viewBox="0 0 1400 493" fill="none">
          {/* El grupo exterior posiciona la hoja sobre el haz (y ≈ 192 en x ≈ 98); el interior se anima con CSS. */}
          <g transform="translate(52 134)">
            <g className="prism-sheet">
              <rect width="92" height="116" rx="7" className="prism-paper" />
              <rect x="16" y="22" width="44" height="5" rx="2.5" className="prism-ink" />
              <rect x="16" y="38" width="60" height="5" rx="2.5" className="prism-ink" />
              <rect x="16" y="54" width="52" height="5" rx="2.5" className="prism-ink" />
              <rect x="16" y="70" width="36" height="5" rx="2.5" className="prism-ink" />
              <rect x="16" y="94" width="26" height="5" rx="2.5" className="prism-ink is-strong" />
            </g>
          </g>
        </svg>
      </div>
      <ul className="prism-legend">
        {RAY_ORDER.map((id) => (
          <li key={id} data-category={id}>
            <span className="prism-legend-dot" />
            {CATEGORIES.find((category) => category.id === id)?.title.replace("Trámites en México", "Trámites")}
          </li>
        ))}
      </ul>
    </div>
  );
}
