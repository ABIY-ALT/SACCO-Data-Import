import type {
  AppSettings,
  ColumnMapping,
  ColumnRule,
  ColumnType,
  RawCell,
  SavedMappingEntry,
  SourceColumn,
  TargetColumn,
  TransformOptions,
} from "../types";
import {
  aliasStrength,
  conceptById,
  conceptForHeader,
  financialConflict,
  typeFromHeaderWords,
} from "./dictionary";
import { cleanHeader, colLetter, headerKey, headerKeys, headerSimilarity, headerTokens, isBlank, parseHeaderHints, rawToText } from "./text";
import {
  detectDateOrder,
  detectKind,
  excelFormatToPattern,
  genderOf,
  parseDate,
  parseNumber,
  parsePhone,
  patternFromExample,
  phoneFormatFromExample,
  EMAIL_RE,
  identifierText,
} from "./values";

export interface SheetData {
  name: string;
  rows: RawCell[][];
  /** Cells merged across columns near the top of the sheet (0-based rows r..r2, columns c1..c2), e.g. a title over sub-titles. */
  merges?: { r: number; r2: number; c1: number; c2: number }[];
}

/**
 * Column headers on two rows, e.g. "Regular loan" merged over "Principal" | "Interest": the header row becomes
 * "Regular loan Principal" | "Regular loan Interest". Only the header row changes; the data rows stay as they are.
 * Without merge information, a blank cell of the upper row takes the title on its left while the row below has a sub-title.
 */
export function mergeHeaderRows(sheet: SheetData, headerRow: number): SheetData {
  if (headerRow < 2) return sheet;
  const upperIdx = headerRow - 2;
  const upper = sheet.rows[upperIdx] ?? [];
  const lower = sheet.rows[headerRow - 1] ?? [];
  const text = (c: RawCell | undefined) => rawToText(c ?? null).trim();
  const width = Math.max(upper.length, lower.length);
  const top: string[] = [];
  if (sheet.merges) {
    for (let c = 0; c < width; c++) top[c] = text(upper[c]);
    for (const m of sheet.merges)
      if (m.r <= upperIdx && m.r2 >= upperIdx) for (let c = m.c1; c <= m.c2 && c < width; c++) top[c] = text(sheet.rows[m.r]?.[m.c1]);
  } else {
    let carry = "";
    for (let c = 0; c < width; c++) {
      const up = text(upper[c]);
      const low = text(lower[c]);
      if (up) carry = up;
      else if (!low) carry = "";
      top[c] = up || (low ? carry : "");
    }
  }
  const merged: RawCell[] = [];
  for (let c = 0; c < width; c++) {
    const low = text(lower[c]);
    const label = top[c] && low && top[c] !== low ? `${top[c]} ${low}` : top[c] || low;
    merged.push(label === "" ? null : label);
  }
  const rows = sheet.rows.slice();
  rows[headerRow - 1] = merged;
  return { ...sheet, rows };
}

export interface TemplateMeta {
  /** Allowed values from Excel data-validation dropdowns, per column index. */
  lists: Record<number, string[]>;
  /** Number formats of the first data row / column style, per column index. */
  numFmts: Record<number, string>;
}

export const DEFAULT_TRANSFORMS: TransformOptions = {
  trim: true,
  dates: true,
  numbers: true,
  phones: true,
  codes: true,
  nameCase: false,
  emailCase: true,
};

/** Header row detection: the earliest of the first 20 rows with the most non-empty text cells. */
export function detectHeaderRow(rows: RawCell[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    let score = 0;
    for (const c of row) if (typeof c === "string" && c.trim() !== "" && !/^\d+([.,]\d+)?$/.test(c.trim())) score++;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best + 1;
}

/** Width of the header row (trailing blank header cells are ignored). */
function headerWidth(rows: RawCell[][], headerRow: number): number {
  const h = rows[headerRow - 1] ?? [];
  let w = h.length;
  while (w > 0 && isBlank(h[w - 1])) w--;
  return w;
}

export function dataWidth(rows: RawCell[][], headerRow: number): number {
  let w = headerWidth(rows, headerRow);
  for (let r = headerRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    let rw = row.length;
    while (rw > w && isBlank(row[rw - 1])) rw--;
    if (rw > w) w = rw;
  }
  return w;
}

export function isBlankRow(row: RawCell[] | undefined): boolean {
  if (!row) return true;
  for (const c of row) if (!isBlank(c)) return false;
  return true;
}

export function countDataRows(rows: RawCell[][], headerRow: number): number {
  let n = 0;
  for (let r = headerRow; r < rows.length; r++) if (!isBlankRow(rows[r])) n++;
  return n;
}

// ------------------------------------------------------------------ targets (template)

export function buildTargets(sheet: SheetData, headerRow: number, meta: TemplateMeta, settings: AppSettings): {
  targets: TargetColumn[];
  issues: string[];
} {
  const issues: string[] = [];
  const headerCells = sheet.rows[headerRow - 1] ?? [];
  const width = headerWidth(sheet.rows, headerRow);
  const exampleRow = sheet.rows[headerRow] ?? [];
  const targets: TargetColumn[] = [];
  const seen = new Map<string, number>();
  for (let c = 0; c < width; c++) {
    const headerRaw = rawToText(headerCells[c]);
    const blankHeader = headerRaw.trim() === "";
    const label = blankHeader ? `(Column ${colLetter(c)})` : cleanHeader(headerRaw);
    if (blankHeader) issues.push(`Template column ${colLetter(c)} has no header. It will be kept empty in the final file.`);
    const k = headerKey(label);
    if (!blankHeader && seen.has(k))
      issues.push(`Template header "${label}" appears twice (columns ${colLetter(seen.get(k)!)} and ${colLetter(c)}).`);
    seen.set(k, c);

    const hints = parseHeaderHints(headerRaw);
    const found = blankHeader ? undefined : conceptForHeader(label);
    const concept = found?.concept;
    const exCell = exampleRow[c] ?? null;
    const example = isBlank(exCell) ? undefined : rawToText(exCell).trim();
    const numFmt = meta.numFmts[c];
    let dateFormatHint = hints.dateFormat;
    if (!dateFormatHint && exCell && typeof exCell !== "string" && exCell.d) dateFormatHint = excelFormatToPattern(numFmt);
    if (!dateFormatHint && example && typeof exCell === "string") dateFormatHint = patternFromExample(example);
    if (!dateFormatHint) dateFormatHint = excelFormatToPattern(numFmt);
    const allowedValues = meta.lists[c] ?? hints.allowedValues;

    let type: ColumnType = concept?.type ?? typeFromHeaderWords(headerTokens(label)) ?? "text";
    if (allowedValues && allowedValues.length > 0) {
      const genders = allowedValues.filter((v) => genderOf(v)).length;
      type = type === "gender" || genders >= 2 ? "gender" : "enum";
    }
    if (type === "text" && exCell && typeof exCell !== "string" && exCell.d) type = "date";
    if (type === "text" && hints.dateFormat) type = "date";

    targets.push({
      index: c,
      letter: colLetter(c),
      header: headerRaw,
      label,
      concept: concept?.id,
      conceptWeak: found?.weak || undefined,
      inferredType: type,
      requiredHint: hints.required,
      dateFormatHint: type === "date" ? (dateFormatHint ?? settings.dateFormat) : dateFormatHint,
      allowedValues,
      example,
      exampleIsText: typeof exCell === "string",
      numFmt,
      blankHeader,
    });
  }
  if (targets.length === 0) issues.push("No column headers were found in the template.");
  return { targets, issues };
}

// ------------------------------------------------------------------ sources (original file)

export function buildSources(sheet: SheetData, headerRow: number, settings: AppSettings): {
  sources: SourceColumn[];
  issues: string[];
} {
  const issues: string[] = [];
  const headerCells = sheet.rows[headerRow - 1] ?? [];
  const width = dataWidth(sheet.rows, headerRow);
  const phoneSettings = { countryCode: settings.countryCode, nationalLength: settings.nationalNumberLength };
  const counts = new Map<string, number>();
  for (let c = 0; c < width; c++) {
    const h = rawToText(headerCells[c]).trim();
    if (h) counts.set(headerKey(h), (counts.get(headerKey(h)) ?? 0) + 1);
  }
  const occurrence = new Map<string, number>();
  const sources: SourceColumn[] = [];
  for (let c = 0; c < width; c++) {
    const header = rawToText(headerCells[c]);
    const h = header.trim();
    const blankHeader = h === "";
    const key = headerKey(h);
    const duplicateHeader = !blankHeader && (counts.get(key) ?? 0) > 1;
    let label = blankHeader ? `(Column ${colLetter(c)})` : h.replace(/\s+/g, " ");
    if (duplicateHeader) {
      const nth = (occurrence.get(key) ?? 0) + 1;
      occurrence.set(key, nth);
      label = `${label} (${nth})`;
    }
    const sampleCells: RawCell[] = [];
    const samples: string[] = [];
    let nonEmpty = 0;
    for (let r = headerRow; r < sheet.rows.length; r++) {
      const cell = sheet.rows[r]?.[c] ?? null;
      if (isBlank(cell)) continue;
      nonEmpty++;
      if (sampleCells.length < 300) sampleCells.push(cell);
      if (samples.length < 5) samples.push(rawToText(cell).trim());
    }
    const empty = nonEmpty === 0;
    if (blankHeader && !empty) issues.push(`Column ${colLetter(c)} in the original file has data but no header.`);
    if (empty && !blankHeader) issues.push(`Column "${label}" (${colLetter(c)}) in the original file is empty.`);
    sources.push({
      index: c,
      letter: colLetter(c),
      header,
      label,
      blankHeader,
      duplicateHeader,
      empty,
      nonEmptyCount: nonEmpty,
      samples,
      detected: detectKind(sampleCells, phoneSettings),
    });
  }
  const dupHeaders = [...counts.entries()].filter(([, n]) => n > 1);
  for (const [k] of dupHeaders) {
    const cols = sources.filter((s) => headerKey(s.header) === k);
    issues.push(
      `Header "${cols[0].header.trim()}" appears ${cols.length} times (columns ${cols.map((s) => s.letter).join(", ")}). They are shown as ${cols.map((s) => `"${s.label}"`).join(", ")}.`,
    );
  }
  if (sources.length === 0) issues.push("No columns were found in the original file.");
  else if (sources.every((s) => s.blankHeader))
    issues.unshift(`Row ${headerRow} of the original file has no column names. If the names are on another row, go back and choose the correct header row.`);
  return { sources, issues };
}

// ------------------------------------------------------------------ rules

export function defaultRule(t: TargetColumn, settings: AppSettings): ColumnRule {
  const concept = conceptById(t.concept);
  const type = t.inferredType;
  const phoneSettings = { countryCode: settings.countryCode, nationalLength: settings.nationalNumberLength };
  let phoneFormat: ColumnRule["phoneFormat"] = settings.phoneFormat;
  if (type === "phone" && t.example) phoneFormat = phoneFormatFromExample(t.example, phoneSettings) ?? phoneFormat;
  let allowedValues = t.allowedValues ?? [];
  if (type === "gender" && allowedValues.length === 0)
    allowedValues = settings.genderStyle === "M/F" ? ["M", "F"] : ["Male", "Female"];
  return {
    type,
    // defaults from a concept only apply when the header is a well-known name for it
    required: t.requiredHint || (!t.conceptWeak && Boolean(concept?.required)),
    unique: (!t.conceptWeak && Boolean(concept?.unique)) || (type === "phone" && concept?.id === "phone" && !t.conceptWeak && settings.phoneUnique),
    allowNegative: false,
    dateFormat: t.dateFormatHint ?? settings.dateFormat,
    dateOutput: t.exampleIsText && t.example ? "text" : "date",
    dateOrder: "auto",
    phoneFormat,
    allowedValues,
    valueMap: {},
  };
}

// ------------------------------------------------------------------ matching

export interface LearnedAlias {
  targetKey: string;
  sourceKey: string;
}

interface Candidate {
  target: number;
  source: number;
  score: number;
  status: "exact" | "learned" | "synonym" | "possible";
  reason: string;
}

function valueFit(type: ColumnType, cells: RawCell[], settings: AppSettings): number | null {
  const vals = cells.filter((c) => !isBlank(c));
  if (vals.length === 0) return null;
  const ps = { countryCode: settings.countryCode, nationalLength: settings.nationalNumberLength };
  let ok = 0;
  for (const c of vals) {
    switch (type) {
      case "date":
        if (parseDate(c, settings.dateOrder).ok) ok++;
        break;
      case "amount":
      case "number":
      case "integer":
        if (parseNumber(c, true).ok) ok++;
        break;
      case "phone":
        if (parsePhone(identifierText(c), ps).ok) ok++;
        break;
      case "gender":
        if (genderOf(rawToText(c))) ok++;
        break;
      case "email":
        if (EMAIL_RE.test(rawToText(c).trim())) ok++;
        break;
      default:
        ok++;
    }
  }
  return ok / vals.length;
}

const TYPE_WORD: Partial<Record<ColumnType, string>> = {
  date: "dates",
  amount: "numbers",
  number: "numbers",
  integer: "numbers",
  phone: "phone numbers",
  gender: "gender values",
  email: "email addresses",
};

/**
 * Suggest a source column for each template column.
 * Exact names, previously confirmed names and strong SACCO synonyms are matched automatically;
 * everything else is only offered as a "possible" match that the user must confirm.
 */
export function suggestMappings(
  targets: TargetColumn[],
  sources: SourceColumn[],
  sourceSheet: SheetData,
  sourceHeaderRow: number,
  settings: AppSettings,
  learned: LearnedAlias[],
): ColumnMapping[] {
  const learnedSet = new Set(learned.map((l) => `${l.targetKey}|${l.sourceKey}`));
  const candidates: Candidate[] = [];
  for (const t of targets) {
    if (t.blankHeader) continue;
    const tKey = headerKey(t.label);
    const tAlt = headerKeys(t.header).slice(1); // e.g. the Amharic name in "Registration fee(መመዝገቢያ)"
    const tTokens = headerTokens(t.label);
    for (const s of sources) {
      if (s.blankHeader) continue;
      const sKey = headerKey(s.header);
      if (!sKey) continue;
      if (tKey === sKey) {
        candidates.push({ target: t.index, source: s.index, score: 100, status: "exact", reason: "Same column name" });
        continue;
      }
      if (tAlt.includes(sKey)) {
        candidates.push({ target: t.index, source: s.index, score: 92, status: "synonym", reason: "Same as the name in brackets in the template header" });
        continue;
      }
      if (learnedSet.has(`${tKey}|${sKey}`)) {
        candidates.push({ target: t.index, source: s.index, score: 95, status: "learned", reason: "You confirmed this match in a previous import" });
        continue;
      }
      if (t.concept) {
        const strength = aliasStrength(t.concept, s.header);
        if (strength === "strong" && !t.conceptWeak) {
          candidates.push({ target: t.index, source: s.index, score: 90, status: "synonym", reason: "Known SACCO name for the same field" });
          continue;
        }
        if (strength === "weak" || (strength === "strong" && t.conceptWeak)) {
          candidates.push({ target: t.index, source: s.index, score: 62, status: "possible", reason: "Related name — please confirm it means the same thing" });
          continue;
        }
      }
      const sim = headerSimilarity(t.label, s.header);
      if (sim >= 0.5) {
        const conflict = financialConflict(tTokens, headerTokens(s.header));
        if (conflict) {
          candidates.push({
            target: t.index, source: s.index, score: 30 + sim * 10, status: "possible",
            reason: `Similar name but different financial meaning (${conflict}) — check carefully`,
          });
        } else {
          candidates.push({
            target: t.index, source: s.index, score: 40 + sim * 20, status: "possible",
            reason: `Similar name (${Math.round(sim * 100)}% alike) — please confirm`,
          });
        }
      }
    }
  }

  // Greedy assignment, best score first, each column used once.
  candidates.sort((a, b) => b.score - a.score);
  const byTarget = new Map<number, Candidate>();
  const usedSources = new Set<number>();
  for (const c of candidates) {
    if (c.score < 35) continue;
    if (byTarget.has(c.target) || usedSources.has(c.source)) continue;
    byTarget.set(c.target, c);
    usedSources.add(c.source);
  }
  // One original column that fits two template columns equally well is never decided automatically.
  for (const c of byTarget.values()) {
    if (c.status === "possible") continue;
    const rival = candidates.find((o) => o.source === c.source && o.target !== c.target && o.score >= c.score);
    if (rival) {
      const other = targets.find((t) => t.index === rival.target);
      c.status = "possible";
      c.reason = `Fits both this column and “${other?.label ?? "another column"}” — please confirm which one it belongs to`;
    }
  }

  return targets.map((t) => {
    const rule = defaultRule(t, settings);
    const c = byTarget.get(t.index);
    const m: ColumnMapping = {
      target: t.index,
      source: null,
      status: "missing",
      confirmed: true,
      reason: t.blankHeader ? "Template column has no header" : "No matching column found in the original file",
      warnings: [],
      defaultValue: "",
      fillBlanks: false,
      defaultApproved: false,
      rule,
    };
    if (!c) return m;
    m.source = c.source;
    m.status = c.status;
    m.reason = c.reason;
    m.confirmed = c.status !== "possible";
    // Check that the values actually look like the expected type.
    const cells: RawCell[] = [];
    for (let r = sourceHeaderRow; r < sourceSheet.rows.length && cells.length < 500; r++) {
      const cell = sourceSheet.rows[r]?.[c.source] ?? null;
      if (!isBlank(cell)) cells.push(cell);
    }
    const fit = valueFit(rule.type, cells, settings);
    if (fit !== null && fit < 0.8 && TYPE_WORD[rule.type]) {
      const msg = `Only ${Math.round(fit * 100)}% of the values in "${sources[c.source].label}" look like ${TYPE_WORD[rule.type]}.`;
      m.warnings.push(msg);
      if (m.status === "synonym" || m.status === "learned") {
        m.status = "possible";
        m.confirmed = false;
        m.reason = `${m.reason}, but the values don't fit — please confirm`;
      }
    }
    return m;
  });
}

/** Apply a saved mapping template on top of fresh suggestions (matched by original column names). */
export function applySavedMapping(
  base: ColumnMapping[],
  targets: TargetColumn[],
  sources: SourceColumn[],
  entries: SavedMappingEntry[],
): { mappings: ColumnMapping[]; notFound: string[] } {
  const notFound: string[] = [];
  const entryByKey = new Map(entries.map((e) => [headerKey(cleanHeader(e.targetHeader)), e]));
  const sourceByKey = new Map<string, SourceColumn>();
  for (const s of sources) if (!s.blankHeader && !sourceByKey.has(headerKey(s.header))) sourceByKey.set(headerKey(s.header), s);
  const fromSaved = new Set<number>();
  const mappings = base.map((m) => {
    const t = targets[m.target];
    const e = entryByKey.get(headerKey(t.label));
    if (!e) return m;
    const next: ColumnMapping = {
      ...m,
      rule: { ...m.rule, ...e.rule },
      defaultValue: e.defaultValue,
      fillBlanks: e.fillBlanks,
      defaultApproved: false,
      ...(e.useTemplate ? { useTemplate: true } : {}),
    };
    delete next.combine;
    if (e.combine && e.combine.sourceHeaders.length >= 2) {
      // Combined columns: every one of them must be in this file.
      const cols = e.combine.sourceHeaders.map((h) => sourceByKey.get(h));
      if (!cols.every(Boolean)) {
        notFound.push(...e.combine.sourceLabels.filter((_, i) => !cols[i]));
        return next;
      }
      const idx = cols.map((c) => c!.index);
      Object.assign(next, {
        source: idx[0],
        combine: { op: e.combine.op, separator: e.combine.separator, sources: idx },
        status: "learned",
        confirmed: true,
        reason: "From your saved mapping",
        warnings: [],
      });
      fromSaved.add(m.target);
      return next;
    }
    if (e.sourceHeader === null) {
      next.source = null;
      next.status = "missing";
      next.confirmed = true;
      next.reason = "Saved mapping: no column from the original file";
      next.warnings = [];
      return next;
    }
    const s = sourceByKey.get(e.sourceHeader);
    if (!s) {
      notFound.push(e.sourceLabel ?? e.sourceHeader);
      return next;
    }
    next.source = s.index;
    next.status = "learned";
    next.confirmed = true;
    next.reason = "From your saved mapping";
    next.warnings = [];
    fromSaved.add(m.target);
    return next;
  });
  // A source column may now be used twice (saved mapping + suggestion); drop the automatic suggestion.
  const savedSources = new Set(mappings.filter((m) => fromSaved.has(m.target)).flatMap((m) => (m.combine ? m.combine.sources : [m.source])));
  for (const m of mappings) {
    if (!fromSaved.has(m.target) && m.source !== null && savedSources.has(m.source) && m.status !== "exact") {
      m.source = null;
      m.status = "missing";
      m.confirmed = true;
      m.reason = "No matching column found in the original file";
      m.warnings = [];
    }
  }
  return { mappings, notFound };
}

export function dateOrderEvidence(sheet: SheetData, headerRow: number, sourceIndex: number) {
  const values: string[] = [];
  for (let r = headerRow; r < sheet.rows.length && values.length < 5000; r++) {
    const cell = sheet.rows[r]?.[sourceIndex] ?? null;
    if (typeof cell === "string" && cell.trim()) values.push(cell);
  }
  return detectDateOrder(values);
}

/** Signature of a template's structure, used to recognise the same template in future imports. */
export function templateSignature(targets: TargetColumn[]): string {
  return targets.map((t) => headerKey(t.label) || "_").join("|");
}
