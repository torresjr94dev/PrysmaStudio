/**
 * Escena de la portada: el logo tal cual, transparente, sobre el fondo de la página en ambos temas.
 * Es decorativa (aria-hidden); el texto del hero ya lo dice todo. Al arrastrar archivos sobre la ventana
 * el prisma se acerca un poco: la pantalla de «suelta aquí» ya hace el resto.
 */
export function PrismStage({ active }: { active: boolean }) {
  return (
    <div className={`prism-stage${active ? " is-over" : ""}`} aria-hidden="true">
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
    </div>
  );
}
