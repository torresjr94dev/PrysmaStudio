// Lector XML mínimo y estricto para CFDI. Corre dentro del Web Worker, donde no existe DOMParser.
//
// Un CFDI es XML generado por máquina: bien formado, UTF-8, con todos los datos en atributos y sin
// DTD. Este lector solo acepta ese subconjunto y rechaza todo lo demás: nada de DOCTYPE (no hay
// expansión de entidades ni referencias externas), profundidad y tamaño acotados. Cualquier cosa fuera
// del formato se reporta como `input.invalid` con un motivo legible.
import { EngineError } from "../errors.ts";

export interface XmlElement {
  /** URI del espacio de nombres ya resuelto ("" si no tiene). */
  ns: string;
  /** Nombre local, sin prefijo. */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

export const XML_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxDepth: 64,
  maxElements: 200_000,
  maxAttributeLength: 10_000,
} as const;

const NAME_START = /[A-Za-z_:\u00C0-\uFFFD]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-\u00B7\u00C0-\uFFFD]/;

function invalid(detail: string): EngineError {
  return new EngineError("input.invalid", `El XML no es válido: ${detail}.`);
}

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z]+);/g, (match, body: string) => {
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        if (body[0] !== "#") throw invalid(`entidad desconocida «${match}»`);
        const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
          throw invalid(`referencia de carácter inválida «${match}»`);
        }
        return String.fromCodePoint(code);
      }
    }
  });
}

interface Frame {
  element: XmlElement;
  /** Prefijo → URI declarado en este elemento o heredado. */
  scope: Map<string, string>;
}

/**
 * Analiza un documento XML y devuelve su elemento raíz. Ignora texto, comentarios, instrucciones de
 * proceso y CDATA: en un CFDI nada de eso lleva datos fiscales.
 */
export function parseXml(source: string): XmlElement {
  if (source.length > XML_LIMITS.maxBytes) throw new EngineError("limits.exceeded", "El XML supera los 10 MB.");

  let pos = 0;
  const length = source.length;
  const stack: Frame[] = [];
  let root: XmlElement | null = null;
  let elements = 0;

  const skipWhitespace = (): void => {
    while (pos < length && (source[pos] === " " || source[pos] === "\n" || source[pos] === "\r" || source[pos] === "\t")) pos++;
  };

  const readName = (): string => {
    const start = pos;
    if (pos >= length || !NAME_START.test(source[pos] as string)) throw invalid(`se esperaba un nombre en la posición ${pos}`);
    pos++;
    while (pos < length && NAME_CHAR.test(source[pos] as string)) pos++;
    return source.slice(start, pos);
  };

  const readAttributes = (): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (;;) {
      skipWhitespace();
      const char = source[pos];
      if (char === undefined) throw invalid("etiqueta sin cerrar");
      if (char === "/" || char === ">") return attrs;
      const name = readName();
      skipWhitespace();
      if (source[pos] !== "=") throw invalid(`el atributo «${name}» no tiene valor`);
      pos++;
      skipWhitespace();
      const quote = source[pos];
      if (quote !== '"' && quote !== "'") throw invalid(`el atributo «${name}» no está entre comillas`);
      pos++;
      const end = source.indexOf(quote, pos);
      if (end < 0) throw invalid(`el atributo «${name}» no cierra sus comillas`);
      const raw = source.slice(pos, end);
      if (raw.includes("<")) throw invalid(`el atributo «${name}» contiene «<»`);
      if (raw.length > XML_LIMITS.maxAttributeLength) throw new EngineError("limits.exceeded", `El atributo «${name}» es demasiado largo.`);
      if (name in attrs) throw invalid(`atributo «${name}» repetido`);
      attrs[name] = decodeEntities(raw);
      pos = end + 1;
    }
  };

  const resolve = (qualified: string, scope: Map<string, string>, isAttribute: boolean): { ns: string; name: string } => {
    const colon = qualified.indexOf(":");
    if (colon < 0) return { ns: isAttribute ? "" : (scope.get("") ?? ""), name: qualified };
    const prefix = qualified.slice(0, colon);
    const name = qualified.slice(colon + 1);
    if (prefix === "xml") return { ns: "http://www.w3.org/XML/1998/namespace", name };
    const ns = scope.get(prefix);
    if (ns === undefined) throw invalid(`prefijo «${prefix}» sin declarar`);
    return { ns, name };
  };

  while (pos < length) {
    const open = source.indexOf("<", pos);
    if (open < 0) {
      if (stack.length > 0) throw invalid("faltan etiquetas de cierre");
      break;
    }
    pos = open + 1;

    if (source.startsWith("!--", pos)) {
      const end = source.indexOf("-->", pos + 3);
      if (end < 0) throw invalid("comentario sin cerrar");
      pos = end + 3;
      continue;
    }
    if (source.startsWith("![CDATA[", pos)) {
      const end = source.indexOf("]]>", pos + 8);
      if (end < 0) throw invalid("CDATA sin cerrar");
      pos = end + 3;
      continue;
    }
    if (source[pos] === "!") throw invalid("no se permiten declaraciones DOCTYPE");
    if (source[pos] === "?") {
      const end = source.indexOf("?>", pos + 1);
      if (end < 0) throw invalid("instrucción de proceso sin cerrar");
      pos = end + 2;
      continue;
    }

    if (source[pos] === "/") {
      pos++;
      const qualified = readName();
      skipWhitespace();
      if (source[pos] !== ">") throw invalid(`etiqueta de cierre «${qualified}» mal formada`);
      pos++;
      const frame = stack.pop();
      if (!frame) throw invalid(`cierre «${qualified}» sin apertura`);
      const expected = resolve(qualified, frame.scope, false);
      if (expected.ns !== frame.element.ns || expected.name !== frame.element.name) {
        throw invalid(`se esperaba el cierre de «${frame.element.name}» y llegó «${qualified}»`);
      }
      continue;
    }

    const qualified = readName();
    const attrs = readAttributes();
    const selfClosing = source[pos] === "/";
    if (selfClosing) pos++;
    if (source[pos] !== ">") throw invalid(`etiqueta «${qualified}» mal formada`);
    pos++;

    if (++elements > XML_LIMITS.maxElements) throw new EngineError("limits.exceeded", "El XML tiene demasiados elementos.");
    if (stack.length >= XML_LIMITS.maxDepth) throw new EngineError("limits.exceeded", "El XML está anidado demasiado profundo.");

    const parentScope = stack.at(-1)?.scope ?? new Map<string, string>();
    let scope = parentScope;
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        if (scope === parentScope) scope = new Map(parentScope);
        scope.set(name === "xmlns" ? "" : name.slice(6), value);
      }
    }

    const { ns, name } = resolve(qualified, scope, false);
    const element: XmlElement = { ns, name, attrs: {}, children: [] };
    for (const [attrName, value] of Object.entries(attrs)) {
      if (attrName === "xmlns" || attrName.startsWith("xmlns:")) continue;
      element.attrs[resolve(attrName, scope, true).name] = value;
    }

    const parent = stack.at(-1);
    if (parent) parent.element.children.push(element);
    else if (root) throw invalid("hay más de un elemento raíz");
    else root = element;

    if (!selfClosing) stack.push({ element, scope });
  }

  if (stack.length > 0) throw invalid(`la etiqueta «${stack[stack.length - 1]?.element.name}» no se cerró`);
  if (!root) throw invalid("no contiene ningún elemento");
  return root;
}

/** Decodifica los bytes según la declaración `encoding` del prólogo (UTF-8 si no hay). */
export function decodeXmlBytes(bytes: ArrayBuffer): string {
  const head = new TextDecoder("latin1").decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 200)));
  const declared = /<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(declared, { fatal: true });
  } catch {
    throw new EngineError("input.unsupported_type", `El XML declara una codificación no compatible (${declared}).`);
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new EngineError("input.invalid", `El archivo no es texto ${declared.toUpperCase()} válido.`);
  }
}

export function child(element: XmlElement, ns: string, name: string): XmlElement | undefined {
  return element.children.find((item) => item.ns === ns && item.name === name);
}

export function children(element: XmlElement, ns: string, name: string): XmlElement[] {
  return element.children.filter((item) => item.ns === ns && item.name === name);
}
