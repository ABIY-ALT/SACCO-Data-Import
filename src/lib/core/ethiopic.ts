import type { MonthRef } from "../types";

// Ethiopic (Amharic) text helpers: spelling-variant folding, person-name keys and Ethiopian-calendar months.

/**
 * Fold Amharic letters that sound the same and are spelled interchangeably:
 * ሐ/ኀ → ሀ, ሠ → ሰ, ዐ → አ, ፀ → ጸ (all vowel orders), and ሃ/ኣ (4th order) → ሀ/አ.
 * Non-Ethiopic characters are returned unchanged.
 */
export function foldEthiopic(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c < 0x1200 || c > 0x137f) {
      out += ch;
      continue;
    }
    let base = c & ~7;
    let order = c & 7;
    if (base === 0x1210 || base === 0x1280) base = 0x1200; // ሐ ኀ → ሀ
    else if (base === 0x1220) base = 0x1230; // ሠ → ሰ
    else if (base === 0x12d0) base = 0x12a0; // ዐ → አ
    else if (base === 0x1340) base = 0x1338; // ፀ → ጸ
    if ((base === 0x1200 || base === 0x12a0) && order === 3) order = 0; // ሃ → ሀ, ኣ → አ
    out += String.fromCodePoint(base + order);
  }
  return out;
}

export function hasEthiopic(s: string): boolean {
  return /[ሀ-፿]/.test(s);
}

const TITLES = /(^|\s)(አቶ|ወ\/ሮ|ወ\/ሪት|ወ\/ት|ወይዘሮ|ወይዘሪት|ዶ\/ር|ዶክተር|ኢ\/ር|ፕ\/ር|mr|mrs|ms|miss|dr|ato|w\/ro)\.?(?=\s|$)/gi;
const COMPOUND_PREFIXES = ["ወልደ", "ገብረ", "ሀይለ", "ተክለ", "ኪዳነ", "ወለተ", "ሀብተ", "ዘወልደ", "ገብረ"];

/**
 * Comparable key for a person's name: remarks in brackets and titles removed, Amharic spelling variants folded,
 * common abbreviations expanded (ወ/ → ወልደ, ገ/ → ገብረ, ኃ/ → ኃይለ, ተ/ → ተክለ, ኪ/ → ኪዳነ) and compound names joined.
 */
export function personNameKey(name: string): string {
  let t = name.normalize("NFC").replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  t = foldEthiopic(t).toLowerCase();
  t = t.replace(TITLES, " ");
  t = t
    .replace(/(^|[\s.])ወ\s*\/\s*/g, "$1ወልደ")
    .replace(/(^|[\s.])ገ\s*\/\s*/g, "$1ገብረ")
    .replace(/(^|[\s.])ሀ\s*\/\s*/g, "$1ሀይለ")
    .replace(/(^|[\s.])ተ\s*\/\s*/g, "$1ተክለ")
    .replace(/(^|[\s.])ኪ\s*\/\s*/g, "$1ኪዳነ");
  t = t.replace(/[.,;:'"`’_\-–]+/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  for (const p of COMPOUND_PREFIXES) t = t.replace(new RegExp(`(^|\\s)${p}\\s+`, "g"), `$1${p}`);
  return t;
}

// ------------------------------------------------------------------ Ethiopian calendar months

const EC_MONTHS: { m: number; names: string[] }[] = [
  { m: 1, names: ["መስከረም", "meskerem", "mesekerem", "mesekem", "meskeram"] },
  { m: 2, names: ["ጥቅምት", "tikimt", "tikemt", "teqemt", "teqemet", "tikmit", "tekemt"] },
  { m: 3, names: ["ህዳር", "hidar", "hedar", "hdar"] },
  { m: 4, names: ["ታህሳስ", "tahsas", "tahisas", "tahesas", "tahsass"] },
  { m: 5, names: ["ጥር", "tir", "tire", "ter"] },
  { m: 6, names: ["የካቲት", "yekatit", "yekatite", "yekatitt"] },
  { m: 7, names: ["መጋቢት", "megabit", "megabite", "magabit"] },
  { m: 8, names: ["ሚያዝያ", "ሚያዚያ", "miazia", "miyazia", "miyazya", "meyazya"] },
  { m: 9, names: ["ግንቦት", "ginbot", "genbot"] },
  { m: 10, names: ["ሰኔ", "sene", "senie"] },
  { m: 11, names: ["ሀምሌ", "hamle", "hamele", "hamlie"] },
  { m: 12, names: ["ነሀሴ", "nehase", "nehasie", "nhase", "nehasse"] },
  { m: 13, names: ["ጳጉሜ", "ጳጉሜን", "pagume", "pagumen"] },
];
export const EC_MONTH_NAMES = ["", "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት", "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ"];

const EC_MONTH_BY_NAME = new Map<string, number>();
for (const { m, names } of EC_MONTHS) for (const n of names) EC_MONTH_BY_NAME.set(foldEthiopic(n).toLowerCase(), m);

/** Ethiopian month number (1–13) of a single word such as "መስከረም", "የመስከረም" or "Meskerem"; null when it is not a month name. */
export function ecMonthNumber(word: string): number | null {
  const w = foldEthiopic(word.trim()).toLowerCase().replace(/[.,:;]+$/, "");
  return EC_MONTH_BY_NAME.get(w) ?? (w.startsWith(foldEthiopic("የ")) ? (EC_MONTH_BY_NAME.get(w.slice(1)) ?? null) : null);
}
export const GC_MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];


/** Ethiopian month/year → the Gregorian month it mostly overlaps (Sene 2017 → June 2025). */
export function ecToGregorian(ecMonth: number, ecYear: number): { gcMonth: number; gcYear: number } {
  const gcMonth = ((ecMonth + 7) % 12) + 1;
  const gcYear = ecMonth <= 4 ? ecYear + 7 : ecYear + 8;
  return { gcMonth, gcYear };
}

/** Find an Ethiopian month + year in a title text, e.g. "የሰኔ 2017 ዓ.ም" or "Sene 2017 E.C.". */
export function findEcMonth(text: string): MonthRef | null {
  const folded = foldEthiopic(text).toLowerCase();
  const yearMatch = folded.match(/(19[5-9]\d|20[0-4]\d)/);
  for (const { m, names } of [...EC_MONTHS].sort((a, b) => Math.max(...b.names.map((n) => n.length)) - Math.max(...a.names.map((n) => n.length)))) {
    for (const n of names) {
      const fn = foldEthiopic(n);
      const latin = /^[a-z]+$/.test(fn);
      const re = latin ? new RegExp(`(^|[^a-z])${fn}([^a-z]|$)`) : new RegExp(`(^|[\\sየ])${fn}([\\s.,]|$)`);
      if (!re.test(folded)) continue;
      if (!yearMatch) return null;
      const ecYear = Number(yearMatch[1]);
      const { gcMonth, gcYear } = ecToGregorian(m, ecYear);
      return { ecMonth: m, ecYear, gcMonth, gcYear, label: `${EC_MONTH_NAMES[m]} ${ecYear} ዓ.ም ≈ ${GC_MONTH_NAMES[gcMonth]} ${gcYear}` };
    }
  }
  return null;
}

/** Find a Gregorian month in a template title, e.g. "Month: June 2025" or "Month: 2025-06". */
export function findGregorianMonth(text: string): MonthRef | null {
  const t = text.trim();
  let m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)[\s,\-/]+(\d{4})/i);
  if (m) {
    const gcMonth = GC_MONTH_NAMES.findIndex((n) => n.toLowerCase() === m![1].toLowerCase());
    return { gcMonth, gcYear: Number(m[2]), label: `${GC_MONTH_NAMES[gcMonth]} ${m[2]}` };
  }
  m = t.match(/month\s*[:\-]?\s*(\d{4})[-/](\d{1,2})\b/i);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12)
    return { gcMonth: Number(m[2]), gcYear: Number(m[1]), label: `${GC_MONTH_NAMES[Number(m[2])]} ${m[1]}` };
  return null;
}
