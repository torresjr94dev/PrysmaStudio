import { renderCfdi } from "../cfdi/render.ts";
import { readCfdi } from "../cfdi/model.ts";
import { decodeXmlBytes, parseXml } from "../cfdi/xml.ts";
import { EngineError, isEngineError } from "../errors.ts";
import { assertInputs, baseName } from "../pdf.ts";
import type { InputFile, OutputFile } from "../protocol.ts";
import type { Report } from "./types.ts";

/** Cada XML del SAT se convierte en su representación impresa; un PDF por archivo. */
export function cfdiToPdf(inputs: InputFile[], report: Report, warnings: string[]): OutputFile[] {
  assertInputs(inputs);
  return inputs.map((file, index) => {
    report(index / inputs.length, `Leyendo ${file.name}`);
    const fileWarnings: string[] = [];
    let bytes: ArrayBuffer;
    try {
      const cfdi = readCfdi(parseXml(decodeXmlBytes(file.bytes)));
      bytes = renderCfdi(cfdi, fileWarnings);
    } catch (cause) {
      if (isEngineError(cause)) throw new EngineError(cause.code, `«${file.name}»: ${cause.detail}`, { cause });
      throw new EngineError("internal", `No se pudo generar el PDF de «${file.name}».`, { cause });
    }
    for (const warning of fileWarnings) warnings.push(inputs.length > 1 ? `«${file.name}»: ${warning}` : warning);
    report((index + 1) / inputs.length, `Generado ${file.name}`);
    return { name: `${baseName(file.name)}.pdf`, mime: "application/pdf", bytes };
  });
}
