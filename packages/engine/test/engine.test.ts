import { describe, expect, it } from "vitest";
import { runOp, runPreview } from "../src/engine.ts";
import { EngineError } from "../src/errors.ts";
import type { EngineErrorCode, EngineOp, InputFile, PageThumbnail, PreviewInfo } from "../src/protocol.ts";
import { parsePageRanges } from "../src/ranges.ts";
import {
  countImages,
  imagePdf,
  noProgress,
  openOutput,
  pageText,
  pngImage,
  sampleColor,
  textPdf,
} from "./fixtures.ts";

function run(op: EngineOp) {
  return runOp(op, noProgress);
}

function expectCode(fn: () => unknown, code: EngineErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`Se esperaba un EngineError con código ${code}`);
}

function onlyOutput(op: EngineOp): ArrayBuffer {
  const { outputs } = run(op);
  expect(outputs).toHaveLength(1);
  const [first] = outputs;
  if (!first) throw new Error("sin salida");
  return first.bytes;
}

describe("parsePageRanges", () => {
  it("convierte rangos 1-based a índices 0-based y entiende «z»", () => {
    expect(parsePageRanges("1-2, 4, 5-z", 6)).toEqual([[0, 1], [3], [4, 5]]);
  });

  it.each(["3-1", "0", "1-9", "a", "1--2", ""])("rechaza «%s»", (ranges) => {
    expectCode(() => parsePageRanges(ranges, 5), "input.invalid");
  });
});

describe("merge", () => {
  it("une documentos respetando el orden", () => {
    const doc = openOutput(onlyOutput({ op: "merge", inputs: [textPdf(2, "A"), textPdf(3, "B")] }));
    expect(doc.countPages()).toBe(5);
    expect([0, 1, 2, 3, 4].map((i) => pageText(doc, i))).toEqual(["A1", "A2", "B1", "B2", "B3"]);
  });

  it("exige al menos dos archivos", () => {
    expectCode(() => run({ op: "merge", inputs: [textPdf(1, "A")] }), "input.invalid");
  });

  it("rechaza archivos que no son PDF", () => {
    const garbage = { name: "x.pdf", bytes: new Uint8Array([1, 2, 3, 4, 5]).buffer };
    expectCode(() => run({ op: "merge", inputs: [textPdf(1, "A"), garbage] }), "pdf.corrupt");
  });

  it("no abre PDFs cifrados sin contraseña", () => {
    const locked = onlyOutput({ op: "protect", input: textPdf(1, "L"), userPassword: "clave", permissions: [] });
    expectCode(() => run({ op: "merge", inputs: [textPdf(1, "A"), { name: "l.pdf", bytes: locked }] }), "pdf.encrypted");
  });
});

describe("split", () => {
  it("por rangos genera un archivo por rango", () => {
    const { outputs } = run({ op: "split", input: textPdf(5, "S"), mode: "ranges", ranges: "1-2,4-z" });
    expect(outputs.map((file) => file.name)).toEqual(["S-p1-2.pdf", "S-p4-5.pdf"]);
    const second = outputs[1];
    if (!second) throw new Error("falta la segunda parte");
    const doc = openOutput(second.bytes);
    expect([pageText(doc, 0), pageText(doc, 1)]).toEqual(["S4", "S5"]);
  });

  it("cada N páginas deja el resto en la última parte", () => {
    const { outputs } = run({ op: "split", input: textPdf(5, "S"), mode: "every", every: 2 });
    expect(outputs.map((file) => openOutput(file.bytes).countPages())).toEqual([2, 2, 1]);
  });

  it("rechaza un tamaño de parte inválido", () => {
    expectCode(() => run({ op: "split", input: textPdf(3, "S"), mode: "every", every: 0 }), "input.invalid");
  });
});

describe("rotate", () => {
  it("rota solo las páginas indicadas", () => {
    const doc = openOutput(onlyOutput({ op: "rotate", input: textPdf(3, "R"), angle: 90, pages: "2" }));
    expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 612, 792]);
    expect(doc.loadPage(1).getBounds()).toEqual([0, 0, 792, 612]);
  });

  it("acumula la rotación existente", () => {
    const once = onlyOutput({ op: "rotate", input: textPdf(1, "R"), angle: 270 });
    const twice = openOutput(onlyOutput({ op: "rotate", input: { name: "r.pdf", bytes: once }, angle: 180 }));
    expect(twice.loadPage(0).getObject().get("Rotate").asNumber()).toBe(90);
  });
});

describe("organize", () => {
  it("reordena, elimina y duplica páginas", () => {
    const doc = openOutput(onlyOutput({ op: "organize", input: textPdf(3, "O"), pages: "3,1,1" }));
    expect([0, 1, 2].map((i) => pageText(doc, i))).toEqual(["O3", "O1", "O1"]);
  });

  it("rechaza índices inexistentes", () => {
    expectCode(() => run({ op: "organize", input: textPdf(2, "O"), pages: "1,6" }), "input.invalid");
  });
});

describe("arrange", () => {
  it("reordena, elimina y gira cada página por separado", () => {
    const doc = openOutput(
      onlyOutput({
        op: "arrange",
        input: textPdf(3, "A"),
        purpose: "organize",
        pages: [
          { source: 2, rotate: 90 },
          { source: 0, rotate: 0 },
        ],
      }),
    );
    expect(doc.countPages()).toBe(2);
    expect([0, 1].map((i) => pageText(doc, i))).toEqual(["A3", "A1"]);
    expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 792, 612]);
    expect(doc.loadPage(1).getBounds()).toEqual([0, 0, 612, 792]);
  });

  it("los duplicados son páginas independientes (regresión: rearrangePages compartía el objeto)", () => {
    const { outputs, warnings } = run({
      op: "arrange",
      input: textPdf(2, "D"),
      purpose: "organize",
      pages: [
        { source: 0, rotate: 0 },
        { source: 0, rotate: 180 },
        { source: 1, rotate: 0 },
      ],
    });
    const [output] = outputs;
    if (!output) throw new Error("sin salida");
    const doc = openOutput(output.bytes);
    expect([0, 1, 2].map((i) => pageText(doc, i))).toEqual(["D1", "D1", "D2"]);
    expect(doc.findPage(0).asIndirect()).not.toBe(doc.findPage(1).asIndirect());
    expect(doc.findPage(0).getInheritable("Rotate").isNumber() ? doc.findPage(0).getInheritable("Rotate").asNumber() : 0).toBe(0);
    expect(doc.findPage(1).getInheritable("Rotate").asNumber()).toBe(180);
    expect(warnings.some((warning) => warning.includes("marcadores"))).toBe(true);
  });

  it("acumula el giro existente y nombra según el propósito", () => {
    const once = onlyOutput({ op: "rotate", input: textPdf(1, "R"), angle: 90 });
    const { outputs } = run({ op: "arrange", input: { name: "carta.pdf", bytes: once }, purpose: "rotate", pages: [{ source: 0, rotate: 270 }] });
    const [output] = outputs;
    if (!output) throw new Error("sin salida");
    expect(output.name).toBe("carta-rotado.pdf");
    expect(openOutput(output.bytes).findPage(0).get("Rotate").asNumber()).toBe(0);
  });

  it("rechaza páginas inexistentes, giros inválidos y resultados vacíos", () => {
    expectCode(() => run({ op: "arrange", input: textPdf(2, "X"), purpose: "organize", pages: [{ source: 5, rotate: 0 }] }), "input.invalid");
    expectCode(
      () => run({ op: "arrange", input: textPdf(2, "X"), purpose: "organize", pages: [{ source: 0, rotate: 45 as 90 }] }),
      "input.invalid",
    );
    expectCode(() => run({ op: "arrange", input: textPdf(2, "X"), purpose: "organize", pages: [] }), "input.invalid");
  });
});

function collectPreview(input: InputFile, scope: "first" | "all") {
  let info: PreviewInfo | null = null;
  const thumbnails: PageThumbnail[] = [];
  runPreview(input, { scope, maxEdge: 200 }, { info: (value) => (info = value), page: (thumb) => thumbnails.push(thumb) });
  return { info: info as PreviewInfo | null, thumbnails };
}

describe("preview", () => {
  it("envía tamaños de todas las páginas y una miniatura JPEG por página", () => {
    const rotated = onlyOutput({ op: "rotate", input: textPdf(3, "V"), angle: 90, pages: "2" });
    const { info, thumbnails } = collectPreview({ name: "v.pdf", bytes: rotated }, "all");
    expect(info?.pageCount).toBe(3);
    expect(info?.pages[1]).toEqual({ width: 792, height: 612 });
    expect(thumbnails.map((thumb) => thumb.index)).toEqual([0, 1, 2]);
    const first = new Uint8Array(thumbnails[0]?.jpeg ?? new ArrayBuffer(0));
    expect([first[0], first[1]]).toEqual([0xff, 0xd8]);
    expect(Math.max(thumbnails[1]?.width ?? 0, thumbnails[1]?.height ?? 0)).toBe(200);
    expect(thumbnails[1]?.width).toBeGreaterThan(thumbnails[1]?.height ?? 0);
  });

  it("con alcance «first» solo renderiza la portada pero reporta el total", () => {
    const { info, thumbnails } = collectPreview(textPdf(4, "F"), "first");
    expect(info?.pageCount).toBe(4);
    expect(info?.pages).toHaveLength(1);
    expect(thumbnails).toHaveLength(1);
  });

  it("un PDF cifrado se reporta como protegido, sin error", () => {
    const locked = onlyOutput({ op: "protect", input: textPdf(1, "L"), userPassword: "secreto-1", permissions: [] });
    const { info, thumbnails } = collectPreview({ name: "l.pdf", bytes: locked }, "all");
    expect(info).toEqual({ pageCount: 0, encrypted: true, pages: [], thumbnails: 0 });
    expect(thumbnails).toHaveLength(0);
  });

  it("un archivo que no es PDF falla con error tipado", () => {
    expectCode(() => collectPreview({ name: "x.pdf", bytes: new TextEncoder().encode("hola").buffer }, "all"), "pdf.corrupt");
  });
});

describe("protect / unlock", () => {
  it("cifra con AES-256 y aplica permisos", () => {
    const bytes = onlyOutput({ op: "protect", input: textPdf(1, "P"), userPassword: "méxico-2026", permissions: ["print"] });
    const doc = openOutput(bytes);
    expect(doc.needsPassword()).toBe(true);
    expect(doc.getMetaData("encryption")).toMatch(/AES/);
    expect(doc.getMetaData("encryption")).toMatch(/256/);
    expect(doc.authenticatePassword("méxico-2026")).toBeGreaterThan(0);
    expect(doc.hasPermission("print")).toBe(true);
    expect(doc.hasPermission("copy")).toBe(false);
    expect(doc.hasPermission("edit")).toBe(false);
  });

  it("rechaza comas en la contraseña (inyectarían opciones de escritura)", () => {
    expectCode(
      () => run({ op: "protect", input: textPdf(1, "P"), userPassword: "a,encrypt=none", permissions: [] }),
      "input.invalid",
    );
  });

  it("desbloquea con la contraseña correcta y falla con la incorrecta", () => {
    const locked = { name: "l.pdf", bytes: onlyOutput({ op: "protect", input: textPdf(2, "U"), userPassword: "abc", permissions: [] }) };
    expectCode(() => run({ op: "unlock", input: locked, password: "xyz" }), "pdf.wrong_password");
    const doc = openOutput(onlyOutput({ op: "unlock", input: locked, password: "abc" }));
    expect(doc.needsPassword()).toBe(false);
    expect(doc.getTrailer().get("Encrypt").isNull()).toBe(true);
    expect(pageText(doc, 1)).toBe("U2");
  });
});

describe("compress", () => {
  it("reduce una página escaneada sin voltear ni perder la imagen", () => {
    const input = imagePdf();
    const result = run({ op: "compress", input, target: { kind: "preset", preset: "balanced" } });
    const output = result.outputs[0];
    if (!output) throw new Error("sin salida");
    expect(output.bytes.byteLength).toBeLessThan(input.bytes.byteLength / 3);

    const doc = openOutput(output.bytes);
    expect(countImages(doc)).toBe(1);
    // Cuadrantes: rojo arriba-izq, verde arriba-der, azul abajo-izq, blanco abajo-der.
    const [r1, g1, b1] = sampleColor(doc, 0, 0.25, 0.25);
    const [r2, g2, b2] = sampleColor(doc, 0, 0.75, 0.25);
    const [r3, g3, b3] = sampleColor(doc, 0, 0.25, 0.75);
    const [r4, g4, b4] = sampleColor(doc, 0, 0.75, 0.75);
    expect(r1).toBeGreaterThan(Math.max(g1, b1) + 100);
    expect(g2).toBeGreaterThan(Math.max(r2, b2) + 100);
    expect(b3).toBeGreaterThan(Math.max(r3, g3) + 100);
    expect(Math.min(r4, g4, b4)).toBeGreaterThan(200);
  });

  it("sin pérdida conserva la imagen intacta (regresión: resolve() en mupdf.js borraba streams)", () => {
    const result = run({ op: "compress", input: imagePdf(800, 600), target: { kind: "preset", preset: "lossless" } });
    const output = result.outputs[0];
    if (!output) throw new Error("sin salida");
    const doc = openOutput(output.bytes);
    expect(countImages(doc)).toBe(1);
    const [r, g, b] = sampleColor(doc, 0, 0.25, 0.25);
    expect(r).toBeGreaterThan(Math.max(g, b) + 100);
  });

  it("con peso objetivo alcanzable lo cumple", () => {
    const input = imagePdf();
    const maxBytes = 400 * 1024;
    const result = run({ op: "compress", input, target: { kind: "maxBytes", maxBytes } });
    expect(result.outputs[0]?.bytes.byteLength).toBeLessThanOrEqual(maxBytes);
    expect(result.warnings.filter((w) => w.includes("No fue posible"))).toHaveLength(0);
  });

  it("con peso objetivo imposible avisa y entrega el mínimo alcanzado", () => {
    const result = run({ op: "compress", input: imagePdf(), target: { kind: "maxBytes", maxBytes: 10 * 1024 } });
    expect(result.warnings.some((w) => w.includes("No fue posible"))).toBe(true);
    expect(result.outputs).toHaveLength(1);
  });

  it("si ya cumple el peso objetivo no lo toca y lo explica", () => {
    const input = textPdf(1, "T");
    const result = run({ op: "compress", input, target: { kind: "maxBytes", maxBytes: 5 * 1024 * 1024 } });
    expect(result.outputs[0]?.bytes.byteLength).toBe(input.bytes.byteLength);
    expect(result.warnings.some((w) => w.includes("no hizo falta comprimirlo"))).toBe(true);
  });

  it("nunca devuelve un archivo más pesado que el original", () => {
    const input = textPdf(1, "T");
    const result = run({ op: "compress", input, target: { kind: "preset", preset: "max" } });
    expect(result.outputs[0]?.bytes.byteLength).toBeLessThanOrEqual(input.bytes.byteLength);
  });
});

describe("imágenes", () => {
  it("orienta la página según la imagen en papel Carta", () => {
    const doc = openOutput(onlyOutput({ op: "imagesToPdf", inputs: [pngImage(800, 400), pngImage(300, 600)], paper: "letter" }));
    expect(doc.countPages()).toBe(2);
    expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 792, 612]);
    expect(doc.loadPage(1).getBounds()).toEqual([0, 0, 612, 792]);
  });

  it("rechaza archivos que no son imagen", () => {
    expectCode(() => run({ op: "imagesToPdf", inputs: [{ name: "x.jpg", bytes: new Uint8Array([0, 1, 2]).buffer }], paper: "fit" }), "input.unsupported_type");
  });

  it("INE por ambos lados: una hoja Carta con frente y reverso", () => {
    const doc = openOutput(
      // Tamaños distintos: MuPDF deduplica imágenes idénticas y contaría una sola.
      onlyOutput({ op: "ineSheet", front: pngImage(856, 540, "frente.png"), back: pngImage(860, 542, "reverso.png"), paper: "letter" }),
    );
    expect(doc.countPages()).toBe(1);
    expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 612, 792]);
    expect(countImages(doc)).toBe(2);
    // El frente queda centrado arriba: el centro horizontal de su caja debe tener color, el margen no.
    const [r] = sampleColor(doc, 0, 0.4, 0.14);
    const margin = sampleColor(doc, 0, 0.05, 0.14);
    expect(r).toBeGreaterThan(150);
    expect(Math.min(...margin)).toBeGreaterThan(245);
  });
});
