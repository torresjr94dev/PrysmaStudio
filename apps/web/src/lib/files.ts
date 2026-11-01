import type { InputFile } from "@vitropdf/engine";

export async function toInput(file: File): Promise<InputFile> {
  return { name: file.name, bytes: await file.arrayBuffer() };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString("es-MX")} ${count === 1 ? singular : plural}`;
}

/** Descarga un Blob con un nombre. El object URL se revoca después: Safari necesita tiempo para iniciarla. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** ¿El archivo cumple un `accept` estilo <input type=file>? Se valida por extensión o tipo MIME. */
export function matchesAccept(file: File, accept: string): boolean {
  const rules = accept.split(",").map((rule) => rule.trim().toLowerCase());
  const name = file.name.toLowerCase();
  return rules.some((rule) => (rule.startsWith(".") ? name.endsWith(rule) : file.type === rule));
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  return match?.[1]?.toUpperCase() ?? "";
}

/** Clave estable para listas de React: el mismo archivo agregado dos veces son dos elementos distintos. */
export function newKey(): string {
  return crypto.randomUUID();
}

/**
 * Presupuesto de memoria para procesar en el navegador. MuPDF necesita el archivo completo en su heap
 * y el resultado al lado: ~8 % de la RAM reportada es conservador. `deviceMemory` solo existe en Chromium;
 * sin él (Safari, Firefox) se asume un equipo de escritorio de 8 GB.
 */
export function clientByteBudget(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const gigabytes = typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 ? nav.deviceMemory : 8;
  return Math.round(gigabytes * 1024 * 1024 * 1024 * 0.08);
}
