import type { NumCell, RawCell } from "../types";

// ---------------------------------------------------------------- dates

export interface ParsedDate {
  y: number;
  m: number;
  d: number;
}

export type DateParse =
  | { ok: true; date: ParsedDate; note?: string }
  | { ok: false; reason: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1800 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dim[m - 1];
}

export function toISO(p: ParsedDate): string {
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function fromISO(iso: string): ParsedDate {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** Excel serial date (1900 system) → calendar date. Works without time zones. */
export function excelSerialToDate(serial: number): ParsedDate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  // Excel wrongly treats 1900 as a leap year; serial 60 is the fake 29-Feb-1900.
  const days = whole > 59 ? whole - 1 : whole;
  const ms = Date.UTC(1899, 11, 31) + days * 86400000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function expandYear(yy: number, currentYear: number): number {
  const pivot = currentYear % 100;
  return yy <= pivot ? 2000 + yy : 1900 + yy;
}

/**
 * Detect day/month order for a column from its text values.
 * Returns DMY if some first parts are > 12, MDY if some second parts are > 12.
 */
export function detectDateOrder(values: string[]): {
  order: "DMY" | "MDY" | "YMD" | null;
  ambiguous: boolean;
  evidence: string;
} {
  let dayFirst = 0;
  let monthFirst = 0;
  let ymd = 0;
  let numeric = 0;
  for (const raw of values) {
    const v = raw.trim();
    let m = v.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
    if (m) {
      ymd++;
      continue;
    }
    m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!m) continue;
    numeric++;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  }
  if (numeric === 0) {
    if (ymd > 0) return { order: "YMD", ambiguous: false, evidence: `${ymd} values written as year-month-day` };
    return { order: null, ambiguous: false, evidence: "no numeric dates found" };
  }
  if (dayFirst > 0 && monthFirst === 0)
    return { order: "DMY", ambiguous: false, evidence: `${dayFirst} values can only be day/month/year` };
  if (monthFirst > 0 && dayFirst === 0)
    return { order: "MDY", ambiguous: false, evidence: `${monthFirst} values can only be month/day/year` };
  if (monthFirst > 0 && dayFirst > 0)
    return {
      order: null,
      ambiguous: true,
      evidence: `mixed: ${dayFirst} values look day-first and ${monthFirst} look month-first`,
    };
  return { order: null, ambiguous: true, evidence: `all ${numeric} values could be read either way (day and month both ≤ 12)` };
}

/**
 * Parse a date from a raw cell. `order` decides how to read 03/04/1990.
 * Real Excel dates are taken directly; plain numbers are read as Excel serial dates.
 */
export function parseDate(cell: RawCell, order: "DMY" | "MDY" | "YMD", currentYear = new Date().getFullYear()): DateParse {
  if (cell === null) return { ok: false, reason: "empty" };
  if (typeof cell !== "string") {
    if (cell.d) return { ok: true, date: fromISO(cell.d) };
    const n = cell.n;
    if (Number.isInteger(n) && n >= 18000101 && n <= 22001231) {
      const s = String(n);
      const y = Number(s.slice(0, 4)), m = Number(s.slice(4, 6)), d = Number(s.slice(6, 8));
      if (isValidYMD(y, m, d)) return { ok: true, date: { y, m, d }, note: "number YYYYMMDD" };
    }
    // plausible Excel serial: 1900-01-01 .. 2100-12-31
    if (n >= 1 && n <= 73415) {
      const p = excelSerialToDate(n);
      if (p) return { ok: true, date: p, note: "Excel serial number" };
    }
    return { ok: false, reason: `"${cell.w}" is a number, not a date` };
  }
  const v = cell.trim().replace(/\s+/g, " ");
  if (!v) return { ok: false, reason: "empty" };

  // Strip a trailing time part: "1990-04-03 00:00:00", "03/04/1990 12:00 AM", ISO "T00:00:00Z"
  const s = v.replace(/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(AM|PM)?\s*(Z|[+-]\d{2}:?\d{2})?$/i, "").trim();

  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) return fin(Number(m[1]), Number(m[2]), Number(m[3]), v);

  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return fin(Number(m[1]), Number(m[2]), Number(m[3]), v, "text YYYYMMDD");

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    const twoDigit = m[3].length === 2;
    if (twoDigit) y = expandYear(y, currentYear);
    let d: number, mo: number;
    if (order === "MDY") {
      mo = a; d = b;
    } else {
      d = a; mo = b;
    }
    // A value that is impossible in the chosen order is NOT silently swapped.
    if (mo > 12) {
      return {
        ok: false,
        reason: `"${v}" is not valid as ${order === "MDY" ? "month/day/year" : "day/month/year"}`,
      };
    }
    return fin(y, mo, d, v, twoDigit ? "2-digit year" : undefined);
  }

  // 03-Apr-1990, 3 April 1990, 03 Apr 90
  m = s.match(/^(\d{1,2})[\s\-/.,]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{2}|\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return { ok: false, reason: `"${v}" has an unknown month name` };
    let y = Number(m[3]);
    if (m[3].length === 2) y = expandYear(y, currentYear);
    return fin(y, mo, Number(m[1]), v);
  }
  // April 3, 1990 / Apr 03 1990
  m = s.match(/^([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{1,2})(st|nd|rd|th)?[\s\-/.,]+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return { ok: false, reason: `"${v}" has an unknown month name` };
    return fin(Number(m[4]), mo, Number(m[2]), v);
  }
  // Numeric text that is an Excel serial (e.g. exported "32874")
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= 73415) {
      const p = excelSerialToDate(n);
      if (p) return { ok: true, date: p, note: "Excel serial number" };
    }
  }
  return { ok: false, reason: `"${v}" is not a recognisable date` };

  function fin(y: number, mo: number, d: number, original: string, note?: string): DateParse {
    if (!isValidYMD(y, mo, d)) return { ok: false, reason: `"${original}" is not a real calendar date` };
    return { ok: true, date: { y, m: mo, d }, note };
  }
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DATE_TOKENS = /YYYY|YY|MMM|MM|M|DD|D/g;

/** Format a date using tokens: YYYY YY MMM MM M DD D. */
export function formatDate(p: ParsedDate, format: string): string {
  return format.toUpperCase().replace(DATE_TOKENS, (tok) => {
    switch (tok) {
      case "YYYY": return String(p.y).padStart(4, "0");
      case "YY": return String(p.y % 100).padStart(2, "0");
      case "MMM": return MONTH_SHORT[p.m - 1];
      case "MM": return String(p.m).padStart(2, "0");
      case "M": return String(p.m);
      case "DD": return String(p.d).padStart(2, "0");
      default: return String(p.d);
    }
  });
}

/** Convert an Excel number format (e.g. "dd/mm/yyyy;@", "m/d/yy") into our token format. */
export function excelFormatToPattern(numFmt: string | undefined): string | undefined {
  if (!numFmt) return undefined;
  const f = numFmt
    .split(";")[0]
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\\"@]/g, "")
    .toLowerCase()
    .replace(/\s*(h|am\/pm).*$/, "")
    .trim();
  if (!/y/.test(f) || !/m/.test(f) || !/d/.test(f)) return undefined;
  return f.replace(/y+|m+|d+/g, (tok) => {
    const n = tok.length;
    if (tok[0] === "y") return n >= 3 ? "YYYY" : "YY";
    if (tok[0] === "m") return n >= 3 ? "MMM" : n === 2 ? "MM" : "M";
    return n >= 2 ? "DD" : "D";
  });
}

/** Our token pattern → Excel number format. */
export function patternToExcelFormat(pattern: string): string {
  const map: Record<string, string> = { YYYY: "yyyy", YY: "yy", MMM: "mmm", MM: "mm", M: "m", DD: "dd", D: "d" };
  return pattern.toUpperCase().replace(DATE_TOKENS, (tok) => map[tok]);
}

/** Infer our pattern from an example string like "31/12/1990" or "1990-12-31". */
export function patternFromExample(example: string): string | undefined {
  const v = example.trim();
  let m = v.match(/^(\d{4})([/\-.])(\d{1,2})\2(\d{1,2})$/);
  if (m) return `YYYY${m[2]}${m[3].length === 2 ? "MM" : "M"}${m[2]}${m[4].length === 2 ? "DD" : "D"}`;
  m = v.match(/^(\d{1,2})([/\-.])(\d{1,2})\2(\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const yy = m[4].length === 4 ? "YYYY" : "YY";
    const monthFirst = b > 12 && a <= 12;
    const first = monthFirst ? (m[1].length === 2 ? "MM" : "M") : m[1].length === 2 ? "DD" : "D";
    const second = monthFirst ? (m[3].length === 2 ? "DD" : "D") : m[3].length === 2 ? "MM" : "M";
    return `${first}${m[2]}${second}${m[2]}${yy}`;
  }
  m = v.match(/^(\d{1,2})([\s-])([A-Za-z]{3})\2(\d{2}|\d{4})$/);
  if (m) return `DD${m[2]}MMM${m[2]}${m[4].length === 4 ? "YYYY" : "YY"}`;
  return undefined;
}

// ---------------------------------------------------------------- numbers

export type NumberParse =
  | { ok: true; value: number; converted: boolean }
  | { ok: false; reason: string };

const CURRENCY = /^(ETB|BIRR|BR|KES|KSH|KSHS|UGX|USH|TZS|TSH|RWF|USD|EUR|GBP|\$|€|£)\.?\s*|\s*(ETB|BIRR|BR|KES|KSH|KSHS|UGX|USH|TZS|TSH|RWF|USD|EUR|GBP)\.?$/i;

/**
 * Parse a number without changing its value. Text like "1,500.00", "ETB 2,000", "(250.00)" is converted;
 * anything ambiguous (e.g. "1.234,56", "-", "N/A") is rejected rather than guessed.
 */
export function parseNumber(cell: RawCell, allowTextConversion: boolean): NumberParse {
  if (cell === null) return { ok: false, reason: "empty" };
  if (typeof cell !== "string") {
    if (cell.d) return { ok: false, reason: `"${cell.w}" is a date, not a number` };
    return { ok: true, value: cell.n, converted: false };
  }
  const original = cell.trim();
  if (!original) return { ok: false, reason: "empty" };
  let s = original.replace(/[ \s]+/g, " ");
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  s = s.replace(CURRENCY, "").trim();
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(CURRENCY, "").trim();
  let digits: string | null = null;
  if (/^\d+(\.\d+)?$/.test(s)) digits = s;
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) digits = s.replace(/,/g, "");
  else if (/^\d{1,3}( \d{3})+(\.\d+)?$/.test(s)) digits = s.replace(/ /g, "");
  else if (/^\.\d+$/.test(s)) digits = "0" + s;
  if (digits === null) {
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d{1,2}$/.test(s))
      return { ok: false, reason: `"${original}" uses an unclear decimal separator` };
    return { ok: false, reason: `"${original}" is not a number` };
  }
  const value = (negative ? -1 : 1) * Number(digits);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${original}" is not a number` };
  const plain = !negative && digits === original;
  if (!plain && !allowTextConversion)
    return { ok: false, reason: `"${original}" is a number stored as text` };
  return { ok: true, value, converted: true };
}

/**
 * Decimal places as Excel sees them. Excel keeps 15 significant digits, so binary floating-point noise
 * (49731.7 stored as 49731.700000000004) is not counted as extra decimals.
 */
export function decimalPlaces(value: number): number {
  const n = Number(value.toPrecision(15));
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return s.split(".")[1]?.length ?? 0;
}

// ---------------------------------------------------------------- identifiers

/**
 * Text of an identifier exactly as shown in the file. For numeric cells, Excel's displayed text keeps
 * zero-padding ("000123"); long numbers shown in scientific notation are expanded to all digits.
 */
export function identifierText(cell: RawCell): string {
  if (cell === null) return "";
  if (typeof cell === "string") return cell;
  return numericCellAsDigits(cell);
}

export function numericCellAsDigits(cell: NumCell): string {
  if (/^\d+$/.test(cell.w)) return cell.w;
  if (Number.isInteger(cell.n) && Math.abs(cell.n) < Number.MAX_SAFE_INTEGER) return cell.n.toFixed(0);
  return cell.w;
}

// ---------------------------------------------------------------- phones

export interface PhoneSettings {
  countryCode: string; // e.g. "251"
  nationalLength: number; // e.g. 9
}

export type PhoneParse =
  | { ok: true; national: string | null; international: string | null; lostZero: boolean; cleaned: string }
  | { ok: false; reason: string };

export function parsePhone(input: string, s: PhoneSettings): PhoneParse {
  const original = input.trim();
  if (!original) return { ok: false, reason: "empty" };
  if (/[a-z]/i.test(original.replace(/^tel:/i, "")))
    return { ok: false, reason: `"${original}" contains letters` };
  if (/[/;,|]|\s(or|and)\s/i.test(original) && original.replace(/\D/g, "").length > s.nationalLength + 4)
    return { ok: false, reason: `"${original}" seems to contain more than one phone number` };
  const plus = original.startsWith("+");
  const digits = original.replace(/\D/g, "");
  const cc = s.countryCode;
  const L = s.nationalLength;
  const cleaned = (plus ? "+" : "") + digits;
  if (digits.length === L + 1 && digits.startsWith("0"))
    return { ok: true, national: digits.slice(1), international: null, lostZero: false, cleaned };
  if (digits.length === L && !plus)
    return { ok: true, national: digits, international: null, lostZero: true, cleaned };
  if (digits.length === cc.length + L && digits.startsWith(cc))
    return { ok: true, national: digits.slice(cc.length), international: null, lostZero: false, cleaned };
  if (digits.length === cc.length + L + 2 && digits.startsWith("00" + cc))
    return { ok: true, national: digits.slice(cc.length + 2), international: null, lostZero: false, cleaned };
  if (plus && digits.length >= 8 && digits.length <= 15 && !digits.startsWith(cc))
    return { ok: true, national: null, international: "+" + digits, lostZero: false, cleaned };
  return {
    ok: false,
    reason: `"${original}" is not a valid phone number (expected ${L + 1} digits starting with 0, or +${cc} followed by ${L} digits)`,
  };
}

export function formatPhone(
  p: Extract<PhoneParse, { ok: true }>,
  format: "local" | "international" | "international_no_plus" | "keep",
  s: PhoneSettings,
): string {
  if (p.national === null) return p.international ?? p.cleaned; // foreign number: keep as written
  switch (format) {
    case "local": return "0" + p.national;
    case "international": return "+" + s.countryCode + p.national;
    case "international_no_plus": return s.countryCode + p.national;
    default: return p.cleaned;
  }
}

/** Is a value already exactly in the requested phone format? */
export function phoneInFormat(value: string, format: "local" | "international" | "international_no_plus" | "keep", s: PhoneSettings): boolean {
  const L = s.nationalLength;
  if (format === "local") return new RegExp(`^0\\d{${L}}$`).test(value);
  if (format === "international") return new RegExp(`^\\+${s.countryCode}\\d{${L}}$`).test(value) || /^\+\d{8,15}$/.test(value);
  if (format === "international_no_plus") return new RegExp(`^${s.countryCode}\\d{${L}}$`).test(value);
  return /^\+?\d{7,15}$/.test(value);
}

/** Guess the phone format of a template example value. */
export function phoneFormatFromExample(example: string, s: PhoneSettings): "local" | "international" | "international_no_plus" | undefined {
  const v = example.replace(/[\s\-()]/g, "");
  if (new RegExp(`^0\\d{${s.nationalLength}}$`).test(v)) return "local";
  if (new RegExp(`^\\+${s.countryCode}\\d{${s.nationalLength}}$`).test(v)) return "international";
  if (new RegExp(`^${s.countryCode}\\d{${s.nationalLength}}$`).test(v)) return "international_no_plus";
  if (/^\+\d{8,15}$/.test(v)) return "international";
  return undefined;
}

// ---------------------------------------------------------------- gender / codes

const MALE = new Set(["m", "male", "man", "boy", "mr", "ወንድ", "ወ", "masculine"]);
const FEMALE = new Set(["f", "female", "woman", "girl", "mrs", "ms", "miss", "ሴት", "ሴ", "feminine"]);

export function genderOf(value: string): "male" | "female" | null {
  const v = value.trim().toLowerCase().replace(/\.$/, "");
  if (MALE.has(v)) return "male";
  if (FEMALE.has(v)) return "female";
  return null;
}

/** Pick the allowed value that represents male / female in the template's list. */
export function genderOutputValues(allowed: string[], style: "M/F" | "Male/Female"): { male: string; female: string } {
  const male = allowed.find((a) => genderOf(a) === "male");
  const female = allowed.find((a) => genderOf(a) === "female");
  if (male && female) return { male, female };
  return style === "M/F" ? { male: "M", female: "F" } : { male: "Male", female: "Female" };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Classify what a set of sample values looks like. */
export function detectKind(cells: RawCell[], s: PhoneSettings): import("../types").DetectedKind {
  const vals = cells.filter((c): c is string | NumCell => c !== null && !(typeof c === "string" && c.trim() === ""));
  if (vals.length === 0) return "empty";
  const counts = { date: 0, number: 0, phone: 0, email: 0, gender: 0 };
  for (const c of vals) {
    if (typeof c !== "string") {
      if (c.d) counts.date++;
      else {
        counts.number++;
        const digits = numericCellAsDigits(c);
        if (/^\d+$/.test(digits) && parsePhone(digits, s).ok) counts.phone++;
      }
      continue;
    }
    const v = c.trim();
    if (EMAIL_RE.test(v)) counts.email++;
    if (genderOf(v)) counts.gender++;
    if (/\d/.test(v) && /^[+\d\s\-()]{7,20}$/.test(v) && parsePhone(v, s).ok) counts.phone++;
    if (/[/\-.\s]/.test(v) && /\d/.test(v) && parseDate(v, "DMY").ok) counts.date++;
    if (parseNumber(v, true).ok) counts.number++;
  }
  const n = vals.length;
  const share = (k: number) => k / n;
  if (share(counts.email) >= 0.8) return "email";
  if (share(counts.gender) >= 0.8) return "gender";
  if (share(counts.phone) >= 0.8) return "phone";
  if (share(counts.date) >= 0.8) return "date";
  if (share(counts.number) >= 0.8) return "number";
  if (share(counts.number) + share(counts.date) > 0.3 && share(counts.number) + share(counts.date) < 0.8) return "mixed";
  return "text";
}
