// Structure detection: member-list templates, month titles, money columns and row-total columns.
import type { AnalysisResult, MonthRef, RawCell, SourceColumn, TargetColumn } from "../types";
import type { SheetData } from "./analyze";
import { isBlankRow } from "./analyze";
import { lookupConcepts } from "./dictionary";
import { findEcMonth, findGregorianMonth } from "./ethiopic";
import { classifyRow } from "./members";
import { isBlank } from "./text";
import { identifierText, parseNumber } from "./values";

/** Numeric value of a cell, or null. Accounting "-" cells are numbers (0) and count as such. */
export function numberOf(cell: RawCell): number | null {
  if (cell === null) return null;
  if (typeof cell !== "string") return cell.d ? null : cell.n;
  const p = parseNumber(cell, true);
  return p.ok ? p.value : null;
}

/**
 * Does the template already list the members (e.g. a monthly transaction sheet exported by the SACCO system)?
 * True when a member-ID column is filled in for many rows with unique values.
 */
export function detectFill(targets: TargetColumn[], sheet: SheetData, headerRow: number): AnalysisResult["fill"] {
  const none = { available: false, keyTarget: null, nameTarget: null, members: 0, duplicateIds: 0 };
  const dataRows = sheet.rows.slice(headerRow).filter((r) => !isBlankRow(r));
  if (dataRows.length < 5) return none;
  const isId = (t: TargetColumn) => t.concept === "member_id" || t.concept === "account_number" || t.inferredType === "identifier";
  for (const t of targets.filter(isId)) {
    const values = dataRows.map((r) => identifierText(r[t.index] ?? null).trim()).filter(Boolean);
    if (values.length < dataRows.length * 0.9) continue;
    const unique = new Set(values.map((v) => v.toUpperCase()));
    if (unique.size < values.length * 0.95) continue;
    const name = targets.find((x) => x.concept === "full_name") ?? targets.find((x) => x.inferredType === "name") ?? null;
    return { available: true, keyTarget: t.index, nameTarget: name?.index ?? null, members: values.length, duplicateIds: values.length - unique.size };
  }
  return none;
}

/** Gregorian month named in the template's title rows ("Month: June 2025"). */
export function templateMonth(sheet: SheetData, headerRow: number): MonthRef | null {
  for (let r = 0; r < Math.min(headerRow - 1, 15); r++)
    for (const c of sheet.rows[r] ?? []) {
      const m = typeof c === "string" ? findGregorianMonth(c) ?? findEcMonth(c) : null;
      if (m) return m;
    }
  return null;
}

/** Ethiopian (or Gregorian) month named in a sheet's title rows, e.g. "የሰኔ 2017 ዓ.ም". */
export function sheetMonth(sheet: SheetData): MonthRef | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 8); r++)
    for (const c of sheet.rows[r] ?? []) {
      if (typeof c !== "string" || !c.trim()) continue;
      const m = findEcMonth(c) ?? findGregorianMonth(c);
      if (m) return m;
    }
  return null;
}

export function sameMonth(a: MonthRef | null, b: MonthRef | null): boolean {
  return Boolean(a && b && a.gcMonth === b.gcMonth && a.gcYear === b.gcYear);
}

function isSerialColumn(s: SourceColumn, values: (number | null)[]): boolean {
  if (lookupConcepts(s.header).some((e) => e.concept.id === "serial_number")) return true;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 3) return false;
  let seq = 0;
  for (let k = 1; k < nums.length; k++) if (nums[k] === nums[k - 1] + 1) seq++;
  return seq / (nums.length - 1) > 0.8 && nums.every((n) => Number.isInteger(n));
}

/** Original columns holding money: named, mostly numbers, not a serial number or ID. */
export function moneyColumns(sheet: SheetData, headerRow: number, sources: SourceColumn[], exclude: (number | null)[] = []): number[] {
  const headerCells = sheet.rows[headerRow - 1] ?? [];
  const dataRows = sheet.rows.slice(headerRow).filter((r) => !isBlankRow(r) && classifyRow(r, headerCells).kind === "data");
  const out: number[] = [];
  for (const s of sources) {
    if (s.blankHeader || exclude.includes(s.index)) continue;
    const concept = lookupConcepts(s.header)[0]?.concept;
    if (concept && (concept.type === "identifier" || concept.type === "name" || concept.type === "date" || concept.type === "phone")) continue;
    const cells = dataRows.map((r) => r[s.index] ?? null);
    const nonBlank = cells.filter((c) => !isBlank(c));
    if (nonBlank.length === 0) continue;
    const values = cells.map(numberOf);
    const numeric = nonBlank.filter((c) => numberOf(c) !== null).length;
    if (numeric / nonBlank.length < 0.8) continue;
    if (isSerialColumn(s, values)) continue;
    out.push(s.index);
  }
  return out;
}

/** The named columns that make up a row total: named columns after the total column, up to the first unnamed column. */
export function totalComponents(sources: SourceColumn[], totalCol: number, money: number[]): number[] {
  const comps: number[] = [];
  for (const s of sources) {
    if (s.index <= totalCol) continue;
    if (s.blankHeader) break;
    if (money.includes(s.index)) comps.push(s.index);
  }
  return comps;
}

/**
 * Find the column that holds each row's total (e.g. "በእጅ ያለ"): its value equals the sum of the named amount columns
 * next to it in at least 80% of rows.
 */
export function detectTotalColumn(sheet: SheetData, headerRow: number, sources: SourceColumn[], money: number[]): number | null {
  const headerCells = sheet.rows[headerRow - 1] ?? [];
  const dataRows = sheet.rows.slice(headerRow).filter((r) => !isBlankRow(r) && classifyRow(r, headerCells).kind === "data");
  const byKeyword = money.filter((c) => lookupConcepts(sources[c].header).some((e) => e.concept.id === "row_total"));
  const order = [...byKeyword, ...money.filter((c) => !byKeyword.includes(c))];
  for (const c of order) {
    const comps = totalComponents(sources, c, money);
    if (comps.length < 2) continue;
    let checked = 0;
    let ok = 0;
    for (const r of dataRows) {
      const total = numberOf(r[c] ?? null);
      if (!total) continue;
      checked++;
      const sum = comps.reduce((a, k) => a + (numberOf(r[k] ?? null) ?? 0), 0);
      if (Math.abs(sum - total) < 0.01) ok++;
    }
    if (checked >= 3 && ok / checked >= 0.8) return c;
  }
  return null;
}

