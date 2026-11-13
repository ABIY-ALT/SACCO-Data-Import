// Ethiopian (Amete Mihret) calendar dates → Gregorian dates.
//
// The Ethiopian year has 12 months of 30 days and a 13th month (ጳጉሜ) of 5 days, 6 in a leap year (years where year % 4 === 3).
// Conversion goes through the Julian Day Number. Example: 1 መስከረም 2016 ዓ.ም = 12 September 2023.

import type { RawCell } from "../types";
import { ecMonthNumber, hasEthiopic } from "./ethiopic";
import { type DateParse, type ParsedDate, fromISO } from "./values";

const AMETE_MIHRET_EPOCH = 1723856;

export function isValidEthiopian(y: number, m: number, d: number): boolean {
  if (![y, m, d].every(Number.isInteger)) return false;
  if (y < 1800 || y > 2300 || m < 1 || m > 13 || d < 1 || d > 30) return false;
  return m < 13 || d <= (y % 4 === 3 ? 6 : 5);
}

function ethiopianToJdn(y: number, m: number, d: number): number {
  return AMETE_MIHRET_EPOCH + 365 + 365 * (y - 1) + Math.floor(y / 4) + 30 * m + d - 31;
}

function jdnToGregorian(jdn: number): ParsedDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return { y: 100 * b + d - 4800 + Math.floor(m / 10), m: m + 3 - 12 * Math.floor(m / 10), d: e - Math.floor((153 * m + 2) / 5) + 1 };
}

function gregorianToJdn(p: ParsedDate): number {
  const a = Math.floor((14 - p.m) / 12);
  const y = p.y + 4800 - a;
  const m = p.m + 12 * a - 3;
  return p.d + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

export function ethiopianToGregorian(y: number, m: number, d: number): ParsedDate {
  return jdnToGregorian(ethiopianToJdn(y, m, d));
}

export function gregorianToEthiopian(p: ParsedDate): ParsedDate {
  const days = gregorianToJdn(p) - AMETE_MIHRET_EPOCH;
  const r = days % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    y: 4 * Math.floor(days / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    m: Math.floor(n / 30) + 1,
    d: (n % 30) + 1,
  };
}

/** Marks that say a date is Ethiopian: "ዓ.ም", "ዓ/ም", "E.C.". */
const ERA_RE = /\s*(ዓ\s*\.?\s*ም\.?|ዓ\s*\/\s*ም|E\.?\s?C\.?)\s*$/i;

/** True when a text is clearly an Ethiopian date: it says ዓ.ም / E.C. or names an Ethiopian month. */
export function looksEthiopian(text: string): boolean {
  const t = text.trim();
  if (ERA_RE.test(t)) return true;
  return hasEthiopic(t) && t.split(/[\s,/\-.]+/).some((w) => ecMonthNumber(w) !== null);
}

/** The Ethiopian year today (for 2-digit years). */
export function currentEthiopianYear(today = new Date()): number {
  return gregorianToEthiopian({ y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() }).y;
}

/**
 * Read an Ethiopian date and return the same day in the Gregorian calendar.
 * Accepts 12/10/2016, 2016-10-12, "12/10/2016 ዓ.ም", "ሰኔ 12 2016", "12 ሰኔ 2016 ዓ.ም", and Excel cells that hold the date as a date
 * (Excel stored the Ethiopian day/month/year as if they were Gregorian; they are read back as Ethiopian).
 */
export function parseEthiopianDate(cell: RawCell, order: "DMY" | "MDY" | "YMD", currentEcYear: number): DateParse {
  if (cell === null) return { ok: false, reason: "empty" };
  if (typeof cell !== "string") {
    if (cell.d) {
      const p = fromISO(cell.d);
      return fromEthiopian(p.y, p.m, p.d, cell.w);
    }
    return { ok: false, reason: `"${cell.w}" is a number, not a date` };
  }
  const v = cell.trim().replace(/\s+/g, " ");
  if (!v) return { ok: false, reason: "empty" };
  const s = v.replace(ERA_RE, "").replace(/^ቀን\s*/, "").trim();
  const year = (t: string) => (t.length === 2 ? expandEcYear(Number(t), currentEcYear) : Number(t));

  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) return fromEthiopian(Number(m[1]), Number(m[2]), Number(m[3]), v);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return order === "MDY" ? fromEthiopian(year(m[3]), a, b, v) : fromEthiopian(year(m[3]), b, a, v);
  }
  // With a month name: "ሰኔ 12 2016", "12 ሰኔ 2016", "ሰኔ 12, 2016", "12-ሰኔ-2016"
  const words = s.split(/[\s,/\-.]+/).filter(Boolean);
  const monthIdx = words.findIndex((w) => ecMonthNumber(w) !== null);
  const numbers = words.filter((w) => /^\d+$/.test(w));
  if (monthIdx >= 0 && numbers.length === 2 && words.length === 3) {
    const yearWord = numbers.find((n) => n.length === 4) ?? numbers[1];
    const dayWord = numbers.find((n) => n !== yearWord) ?? numbers[0];
    return fromEthiopian(year(yearWord), ecMonthNumber(words[monthIdx])!, Number(dayWord), v);
  }
  return { ok: false, reason: `"${v}" is not a recognisable date` };
}

function fromEthiopian(y: number, m: number, d: number, original: string): DateParse {
  if (!isValidEthiopian(y, m, d)) return { ok: false, reason: `"${original}" is not a real Ethiopian calendar date` };
  return { ok: true, date: ethiopianToGregorian(y, m, d), note: "Ethiopian calendar" };
}

function expandEcYear(yy: number, currentEcYear: number): number {
  const century = Math.floor(currentEcYear / 100) * 100;
  const y = century + yy;
  return y > currentEcYear + 10 ? y - 100 : y;
}
