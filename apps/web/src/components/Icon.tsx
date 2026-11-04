// Iconos de trazo 24×24 provisionales. Sustitúyelos por el set definitivo conservando los nombres:
// toda la UI los referencia por nombre, así que cambiar el dibujo no toca ningún componente.
const PATHS = {
  upload: "M12 15V3 M7 8l5-5 5 5 M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5",
  fileText: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6 M9 9h1",
  merge: "M6 3v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3 M12 14v7",
  split: "M12 3v7 M12 10l-6 6v5 M12 10l6 6v5",
  organize: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  rotateCw: "M21 12a9 9 0 1 1-2.64-6.36L21 8 M21 3v5h-5",
  rotateCcw: "M3 12a9 9 0 1 0 2.64-6.36L3 8 M3 3v5h5",
  compress: "M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7",
  lock: "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M8 11V7a4 4 0 0 1 7.75-1.4",
  image:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M21 15l-5-5L5 21 M7 8.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
  idCard:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M6 16h5 M14 10h4 M14 14h4 M6.5 10.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  scanText: "M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 8h10 M7 12h10 M7 16h6",
  trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6",
  copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  x: "M18 6 6 18 M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  download: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
  scissors:
    "M3 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M20 4 8.12 15.88 M14.47 14.48 20 20 M8.12 8.12 12 12",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  arrowLeft: "M19 12H5 M12 19l-7-7 7-7",
  chevronDown: "M6 9l6 6 6-6",
  grip: "M9 6h.01 M9 12h.01 M9 18h.01 M15 6h.01 M15 12h.01 M15 18h.01",
  alert: "M12 3 2 20h20z M12 10v4 M12 17h.01",
  info: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 11v5 M12 8h.01",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  search: "M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-5-5",
  sortAz: "M3 7h9 M3 12h6 M3 17h3 M17 5v14 M14 16l3 3 3-3",
  undo: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  reverse: "M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4",
  cloud: "M7 18a5 5 0 1 1 .9-9.92A6 6 0 0 1 19 10a4 4 0 0 1-1 8z",
  laptop: "M5 5h14a1 1 0 0 1 1 1v10H4V6a1 1 0 0 1 1-1z M2 19h20",
  archive: "M3 4h18v4H3z M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8 M10 12h4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  eyeOff:
    "M3 3l18 18 M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9 M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2",
  selectAll: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z M5.5 7l1.5 1.5L9 5.5 M15.5 7l1.5 1.5 2-3",
  code: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
  bug: "M8 2l1.5 2 M16 2l-1.5 2 M9 7h6a3 3 0 0 1 3 3v6a6 6 0 0 1-12 0v-6a3 3 0 0 1 3-3z M3 13h3 M18 13h3 M4 20l3-2 M20 20l-3-2 M4 7l3 2 M20 7l-3 2",
  scale: "M12 3v18 M5 21h14 M3 7l4 8h-8z M17 7l4 8h-8z M3 7h18",
} as const;

export type IconName = keyof typeof PATHS;

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  /** Texto para lectores de pantalla. Sin él, el icono es decorativo. */
  label?: string;
}

export function Icon({ name, size = 20, className, label }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
