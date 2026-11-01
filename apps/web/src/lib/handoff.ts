// Traspaso de archivos entre rutas: soltar archivos en la portada y elegir herramienta después.
// Vive solo en memoria; una recarga lo descarta, como debe ser con documentos privados.
let pending: File[] = [];

export function handOffFiles(files: File[]): void {
  pending = files;
}

export function takeHandedOffFiles(): File[] {
  const taken = pending;
  pending = [];
  return taken;
}
