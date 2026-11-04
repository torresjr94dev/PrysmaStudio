/**
 * Micro-escenas por herramienta: tres piezas como mucho (hojas, una foto, un candado) y una animación
 * solo con transform al pasar el cursor por la tarjeta. Son decorativas: la tarjeta ya tiene título y
 * resumen. Las coreografías viven en styles.css bajo [data-art="…"].
 */
export function ToolArt({ slug }: { slug: string }) {
  switch (slug) {
    case "unir-pdf":
    case "organizar-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a" />
          <i className="art-sheet b" />
        </span>
      );
    case "dividir-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a" />
          <i className="art-sheet b" />
          <i className="art-cut" />
        </span>
      );
    case "rotar-pdf":
    case "comprimir-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a" />
        </span>
      );
    case "imagenes-a-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a" />
          <i className="art-photo" />
        </span>
      );
    case "proteger-pdf":
    case "desbloquear-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a" />
          <i className="art-lock">
            <i />
          </i>
        </span>
      );
    case "ocr-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a is-lined">
            <i />
            <i />
            <i />
          </i>
        </span>
      );
    case "word-a-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a" />
          <i className="art-tag">PDF</i>
        </span>
      );
    case "cfdi-a-pdf":
      return (
        <span className="tool-art" data-art={slug} aria-hidden="true">
          <i className="art-sheet a" />
          <i className="art-qr">
            <i />
            <i />
            <i />
            <i />
          </i>
        </span>
      );
    default:
      return null;
  }
}

/** Ilustración de la tarjeta destacada: hoja carta con la credencial por ambos lados, a tamaño real. */
export function IneArt() {
  return (
    <span className="ine-art" aria-hidden="true">
      <span className="ine-sheet">
        <span className="ine-card is-front">
          <i className="ine-photo" />
          <i className="ine-line" />
          <i className="ine-line" />
          <i className="ine-line is-short" />
        </span>
        <span className="ine-card is-back">
          <i className="ine-strip" />
          <i className="ine-line" />
          <i className="ine-line is-short" />
        </span>
      </span>
    </span>
  );
}
