import { EngineError } from "../errors.ts";
import { assertInputs, baseName, openPdf, savePdf, using } from "../pdf.ts";
import type { InputFile, OutputFile, Permission } from "../protocol.ts";
import type { Report } from "./types.ts";

// Valor /P sin permisos: bits reservados 7-8 y 13-32 a 1 (ISO 32000-2, tabla 22).
const P_NONE = -3904;
const PERMISSION_BITS: Record<Permission, number> = {
  print: 4 | 2048, // imprimir + impresión en alta calidad
  copy: 16 | 512, // copiar texto + extracción para accesibilidad
  modify: 8 | 1024, // modificar + ensamblar páginas
  annotate: 32 | 256, // anotar + rellenar formularios
};

// PDF 2.0 (AES-256, R6) trunca contraseñas a 127 bytes UTF-8.
const MAX_PASSWORD_BYTES = 127;

/**
 * MuPDF recibe las contraseñas dentro de un string de opciones separado por comas.
 * Una coma en la contraseña inyectaría opciones de escritura, así que se rechaza.
 */
function assertPassword(password: string, label: string): void {
  if (password.length === 0) throw new EngineError("input.invalid", `La ${label} no puede estar vacía.`);
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    throw new EngineError("input.invalid", `La ${label} es demasiado larga (máximo ${MAX_PASSWORD_BYTES} bytes).`);
  }
  if (/[,\u0000-\u001f\u007f]/.test(password)) {
    throw new EngineError("input.invalid", `La ${label} no puede contener comas ni caracteres de control.`);
  }
}

function randomOwnerPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function protect(
  input: InputFile,
  userPassword: string,
  ownerPassword: string | undefined,
  permissions: Permission[],
  report: Report,
): OutputFile[] {
  assertInputs([input]);
  assertPassword(userPassword, "contraseña de apertura");
  if (ownerPassword !== undefined) {
    assertPassword(ownerPassword, "contraseña de propietario");
    if (ownerPassword === userPassword) {
      throw new EngineError("input.invalid", "La contraseña de propietario debe ser distinta de la de apertura.");
    }
  }
  const unknown = permissions.filter((permission) => !(permission in PERMISSION_BITS));
  if (unknown.length > 0) throw new EngineError("input.invalid", `Permisos desconocidos: ${unknown.join(", ")}.`);

  // Sin contraseña de propietario explícita se genera una aleatoria: si coincidiera con la de apertura
  // (o quedara vacía), cualquiera con la de apertura podría quitar las restricciones.
  const owner = ownerPassword ?? randomOwnerPassword();
  const p = permissions.reduce((acc, permission) => acc | PERMISSION_BITS[permission], P_NONE);

  return using(openPdf(input), (doc) => {
    report(0.5, "Cifrando con AES-256");
    const options = `encrypt=aes-256,user-password=${userPassword},owner-password=${owner},permissions=${p},garbage=compact,compress`;
    return [{ name: `${baseName(input.name)}-protegido.pdf`, mime: "application/pdf", bytes: savePdf(doc, options) }];
  });
}

export function unlock(input: InputFile, password: string, report: Report, warnings: string[]): OutputFile[] {
  assertInputs([input]);
  return using(openPdf(input, password), (doc) => {
    if (doc.getTrailer().get("Encrypt").isNull()) {
      warnings.push("El PDF no estaba cifrado; se devuelve sin cambios de seguridad.");
    }
    report(0.5, "Quitando cifrado");
    return [
      {
        name: `${baseName(input.name)}-desbloqueado.pdf`,
        mime: "application/pdf",
        bytes: savePdf(doc, "encrypt=none,garbage=compact,compress"),
      },
    ];
  });
}
