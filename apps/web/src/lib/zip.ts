// ZIP mínimo (método "store", sin compresión): los PDF ya van comprimidos y así no hace falta una
// dependencia. Nombres en UTF-8 (bit 11) para que «página-1.pdf» se vea bien en Windows y macOS.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Evita entradas repetidas: «a.pdf», «a (2).pdf»… */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}` : `${name} (${count + 1})`;
  });
}

const MAX_ZIP_BYTES = 2 ** 31;

export async function zipFiles(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
  if (files.length === 0 || files.length > 65_000) throw new Error("Número de archivos inválido para un ZIP.");
  const total = files.reduce((sum, file) => sum + file.blob.size, 0);
  if (total > MAX_ZIP_BYTES) throw new Error("Los archivos son demasiado grandes para un solo ZIP.");

  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const names = uniqueNames(files.map((file) => file.name));
  const parts: BlobPart[] = [];
  const central: Array<Uint8Array<ArrayBuffer>> = [];
  let offset = 0;

  for (const [index, file] of files.entries()) {
    const name = new Uint8Array(encoder.encode(names[index] ?? `archivo-${index + 1}`));
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, data);

    const entry = new DataView(new ArrayBuffer(46 + name.byteLength));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.byteLength, true);
    entry.setUint32(24, data.byteLength, true);
    entry.setUint16(28, name.byteLength, true);
    entry.setUint32(42, offset, true);
    new Uint8Array(entry.buffer).set(name, 46);
    central.push(new Uint8Array(entry.buffer));

    offset += 30 + name.byteLength + data.byteLength;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
