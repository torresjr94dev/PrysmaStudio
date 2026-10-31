import type { InputFile } from "@vitropdf/engine";

export async function toInput(file: File): Promise<InputFile> {
  return { name: file.name, bytes: await file.arrayBuffer() };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
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

/**
 * Presupuesto de memoria para procesar en el navegador. MuPDF necesita el archivo completo en su heap
 * y el resultado al lado: ~8 % de la RAM reportada es conservador. `deviceMemory` solo existe en Chromium;
 * sin él se asume un equipo de 4 GB.
 */
export function clientByteBudget(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const gigabytes = typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 ? nav.deviceMemory : 4;
  return Math.round(gigabytes * 1024 * 1024 * 1024 * 0.08);
}
