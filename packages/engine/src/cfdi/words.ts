// Importe con letra al estilo mexicano: «MIL CIENTO SESENTA PESOS 00/100 M.N.».

const UNITS = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const TEENS = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
const TWENTIES = ["VEINTE", "VEINTIÚN", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const TENS = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const HUNDREDS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function belowThousand(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(HUNDREDS[hundreds] as string);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10] as string);
  else if (rest >= 20 && rest < 30) parts.push(TWENTIES[rest - 20] as string);
  else if (rest >= 30) {
    const units = rest % 10;
    parts.push(units === 0 ? (TENS[Math.floor(rest / 10)] as string) : `${TENS[Math.floor(rest / 10)]} Y ${UNITS[units]}`);
  } else if (rest > 0) parts.push(UNITS[rest] as string);
  return parts.join(" ");
}

/** Entero no negativo (hasta 999 999 999 999) en palabras, en mayúsculas. */
export function integerToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999_999_999) throw new RangeError(`Fuera de rango: ${value}`);
  if (value === 0) return "CERO";
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];
  if (millions === 1) parts.push("UN MILLÓN");
  else if (millions > 1) parts.push(`${integerToWords(millions)} MILLONES`);
  if (thousands === 1) parts.push("MIL");
  else if (thousands > 1) parts.push(`${belowThousand(thousands)} MIL`);
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(" ");
}

const CURRENCY_NAMES: Record<string, { one: string; many: string; suffix: string }> = {
  MXN: { one: "PESO", many: "PESOS", suffix: "M.N." },
  USD: { one: "DÓLAR", many: "DÓLARES", suffix: "USD" },
  EUR: { one: "EURO", many: "EUROS", suffix: "EUR" },
};

/** «UN MIL CIENTO SESENTA PESOS 50/100 M.N.» a partir del importe decimal del XML. */
export function amountInWords(raw: string, currency: string): string {
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(raw);
  if (!match) return "";
  const integer = Number(match[1]);
  const cents = Math.round(Number(`0.${match[2] ?? "0"}`) * 100);
  const names = CURRENCY_NAMES[currency] ?? { one: currency, many: currency, suffix: currency };
  const whole = cents === 100 ? integer + 1 : integer;
  const centsText = cents === 100 ? "00" : String(cents).padStart(2, "0");
  let words = integerToWords(whole);
  // «UN MILLÓN DE PESOS», pero «UN MILLÓN CIEN PESOS».
  if (/MILL(ÓN|ONES)$/.test(words)) words += " DE";
  const noun = whole === 1 ? names.one : names.many;
  return `${words} ${noun} ${centsText}/100 ${names.suffix}`;
}
