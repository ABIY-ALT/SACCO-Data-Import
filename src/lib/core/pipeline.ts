import type {
  AppSettings,
  ColumnMapping,
  FillSettings,
  ImportConfig,
  Issue,
  IssueStat,
  MemberMatchInfo,
  MemberMatchStatus,
  MonthRef,
  OutValue,
  Reconciliation,
  ReconciliationColumn,
  SheetTotalCheck,
  ProcessSummary,
  ProcessedRow,
  RawCell,
  RowStatus,
  SourceColumn,
  TargetColumn,
  TemplateChange,
  TemplateChangeStat,
  TemplateChangeSummary,
  TransformStat,
  ValueFrom,
} from "../types";
import { APPROVAL_BLOCK, COLUMN_TYPE_LABELS, TEMPLATE_CHANGE_LABELS } from "../types";
import type { SheetData } from "./analyze";
import { dateOrderEvidence, isBlankRow } from "./analyze";
import { conceptById } from "./dictionary";
import { classifyRow, isGrandTotalText, matchMembers, type LearnedMember, type MemberIndex } from "./members";
import { moneyColumns, numberOf, sameMonth, totalComponents } from "./structure";
import { headerTokens, isBlank, rawToText, titleCase } from "./text";
import {
  EMAIL_RE,
  decimalPlaces,
  formatDate,
  formatPhone,
  fromISO,
  genderOf,
  genderOutputValues,
  identifierText,
  parseDate,
  parseNumber,
  parsePhone,
  phoneInFormat,
  toISO,
} from "./values";

export const TRANSFORM_TAG_LABELS: Record<string, string> = {
  trim: "Removed extra spaces",
  date: "Converted date format",
  number: "Converted text to number",
  phone: "Standardized phone number",
  code: "Standardized gender / list value",
  case: "Changed capitalization",
  default: "Filled with default value",
  edit: "Corrected by user",
};

/** Internal processed row (compact). */
export interface PRow {
  i: number; // data row index (0 = first row under the header)
  values: OutValue[];
  changed: Record<number, string> | null;
  edited: Record<number, true> | null;
  issues: Issue[];
  status: RowStatus;
  duplicate: boolean;
  member?: MemberMatchInfo | null; // fill mode
  /** Fill mode: the matched member's own values in the template (null when no member is matched). */
  tpl?: OutValue[] | null;
  /** Fill mode: row number of the matched member in the template file. */
  tplExcelRow?: number | null;
  /** Fill mode: what happens to the template's value, per output position k. */
  tplChange?: Record<number, TemplateChange> | null;
}

/** A row of the final file. `i` = original row (null for template members without data), `tplRow` = template member row. */
export interface OutputRow {
  values: OutValue[];
  i: number | null;
  tplRow: number | null;
}

export interface PipelineResult {
  rows: PRow[];
  outputRows: OutputRow[];
  summary: ProcessSummary;
  dateOrders: Record<number, "DMY" | "MDY" | "YMD">;
}

interface ColCtx {
  t: TargetColumn;
  m: ColumnMapping;
  dateOrder: "DMY" | "MDY" | "YMD";
  gender: { male: string; female: string };
  allowedLower: Map<string, string>;
  valueMap: Map<string, string>;
  isBirthDate: boolean;
  isMoneyOrId: boolean;
}

interface CellResult {
  value: OutValue;
  tag: string | null;
  issues: { level: "error" | "warning"; code: string; message: string }[];
}

export function displayValue(v: OutValue, dateFormat: string): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return formatNumber(v);
  return formatDate(fromISO(v.date), dateFormat);
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 10 });

export function formatNumber(n: number): string {
  return NUMBER_FORMAT.format(n);
}

function buildCtx(t: TargetColumn, m: ColumnMapping, sheet: SheetData, headerRow: number, settings: AppSettings): ColCtx {
  let dateOrder: "DMY" | "MDY" | "YMD" = settings.dateOrder;
  if (m.rule.dateOrder !== "auto") dateOrder = m.rule.dateOrder;
  else if (m.source !== null && m.rule.type === "date") {
    const ev = dateOrderEvidence(sheet, headerRow, m.source);
    if (ev.order) dateOrder = ev.order;
  }
  const allowedLower = new Map<string, string>();
  for (const a of m.rule.allowedValues) allowedLower.set(a.trim().toLowerCase(), a);
  const valueMap = new Map<string, string>();
  for (const [k, v] of Object.entries(m.rule.valueMap)) if (v !== "") valueMap.set(k.trim().toLowerCase(), v);
  const concept = conceptById(t.concept);
  const tokens = headerTokens(t.label);
  return {
    t,
    m,
    dateOrder,
    gender: genderOutputValues(m.rule.allowedValues, settings.genderStyle),
    allowedLower,
    valueMap,
    isBirthDate: t.concept === "date_of_birth" || tokens.includes("birth"),
    isMoneyOrId: Boolean(concept?.money) || m.rule.type === "amount" || m.rule.type === "identifier",
  };
}

function processCell(
  input: RawCell,
  fromEdit: boolean,
  fromDefault: boolean,
  c: ColCtx,
  cfg: ImportConfig,
  settings: AppSettings,
  today: { y: number; iso: string },
): CellResult {
  const tr = cfg.transforms;
  const rule = c.m.rule;
  const issues: CellResult["issues"] = [];
  let tag: string | null = fromEdit ? "edit" : fromDefault ? "default" : null;
  const setTag = (t: string) => {
    if (!tag) tag = t;
  };
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });
  const phoneSettings = { countryCode: settings.countryCode, nationalLength: settings.nationalNumberLength };

  switch (rule.type) {
    case "identifier": {
      const s = identifierText(input);
      let v = s;
      if (s !== s.trim()) {
        if (tr.trim) {
          v = s.trim();
          setTag("trim");
        } else warn("spaces", "Has spaces at the start or end");
      }
      if (v === "") return blankResult(c, issues);
      return { value: v, tag, issues };
    }
    case "text":
    case "name": {
      const s = rawToText(input);
      let v = s;
      if (tr.trim) {
        const t = s.trim().replace(/\s+/g, " ");
        if (t !== s) {
          v = t;
          setTag("trim");
        }
      }
      if (rule.type === "name" && tr.nameCase && v) {
        const t = titleCase(v);
        if (t !== v) {
          v = t;
          setTag("case");
        }
      }
      if (v.trim() === "") return blankResult(c, issues);
      return { value: v, tag, issues };
    }
    case "email": {
      const s = rawToText(input);
      let v = s;
      if (tr.trim && v !== v.trim()) {
        v = v.trim();
        setTag("trim");
      }
      if (tr.emailCase && v !== v.toLowerCase()) {
        v = v.toLowerCase();
        setTag("case");
      }
      if (!EMAIL_RE.test(v)) err("email", `"${s}" is not a valid email address`);
      return { value: v, tag, issues };
    }
    case "phone": {
      const s = identifierText(input);
      const p = parsePhone(s, phoneSettings);
      if (!p.ok) {
        err("phone", p.reason);
        return { value: s, tag, issues };
      }
      if (tr.phones) {
        const v = formatPhone(p, rule.phoneFormat, phoneSettings);
        if (v !== s) setTag("phone");
        return { value: v, tag, issues };
      }
      const v = tr.trim ? s.trim() : s;
      if (v !== s) setTag("trim");
      if (p.lostZero) err("phone_zero", `"${s}" is missing its leading 0 (turn on "Standardize phone numbers" to fix)`);
      else if (!phoneInFormat(v, rule.phoneFormat, phoneSettings))
        err("phone_format", `"${s}" is not in the required phone format (turn on "Standardize phone numbers" to fix)`);
      return { value: v, tag, issues };
    }
    case "date": {
      const isRealDate = input !== null && typeof input !== "string" && Boolean(input.d);
      let iso: string | null = null;
      if (isRealDate) {
        iso = (input as { d: string }).d;
      } else if (tr.dates || fromEdit || fromDefault) {
        // Values typed by the user (corrections, defaults) are read in the template's own format.
        const order = fromEdit || fromDefault ? orderOfPattern(rule.dateFormat) : c.dateOrder;
        const p = parseDate(input, order, today.y);
        if (!p.ok) {
          err("date", p.reason);
          return { value: rawToText(input), tag, issues };
        }
        iso = toISO(p.date);
        if (!fromEdit && !fromDefault) {
          const after = formatDate(p.date, rule.dateFormat);
          if (rule.dateOutput === "date" || after !== rawToText(input).trim()) setTag("date");
        }
      } else {
        // Conversion is switched off: the text must already be in the template format.
        const s = rawToText(input).trim();
        const p = parseDate(s, orderOfPattern(rule.dateFormat), today.y);
        if (!p.ok || formatDate(p.date, rule.dateFormat) !== s) {
          err("date_format", `"${rawToText(input)}" is not in the template date format ${rule.dateFormat} (turn on "Convert dates" to fix)`);
          return { value: rawToText(input), tag, issues };
        }
        iso = toISO(p.date);
      }
      if (isRealDate && rule.dateOutput === "text" && !fromEdit) {
        const txt = formatDate(fromISO(iso), rule.dateFormat);
        if (txt !== rawToText(input).trim()) {
          if (tr.dates) setTag("date");
          else {
            err("date_format", `"${rawToText(input)}" is not in the template date format ${rule.dateFormat} (turn on "Convert dates" to fix)`);
            return { value: rawToText(input), tag, issues };
          }
        }
      }
      const { y } = fromISO(iso);
      if (c.isBirthDate && iso > today.iso) err("dob_future", "Date of birth is in the future");
      else if (y < 1900) err("date_range", `Year ${y} is before 1900`);
      else if (y > today.y + 50) warn("date_range", `Year ${y} is far in the future`);
      const value: OutValue = rule.dateOutput === "text" ? formatDate(fromISO(iso), rule.dateFormat) : { date: iso };
      return { value, tag, issues };
    }
    case "gender":
    case "enum": {
      const s = rawToText(input);
      let v = tr.trim || fromEdit ? s.trim() : s;
      if (v !== s) setTag("trim");
      if (rule.type === "enum" && rule.allowedValues.length === 0) return { value: v, tag, issues };
      if (tr.codes || fromEdit || fromDefault) {
        const mapped = c.valueMap.get(v.toLowerCase());
        if (mapped !== undefined) {
          if (mapped !== v) setTag("code");
          v = mapped;
        } else if (!rule.allowedValues.includes(v)) {
          const canonical = c.allowedLower.get(v.toLowerCase());
          if (canonical !== undefined) {
            v = canonical;
            setTag("code");
          } else if (rule.type === "gender") {
            const g = genderOf(v);
            if (g) {
              v = g === "male" ? c.gender.male : c.gender.female;
              setTag("code");
            }
          }
        }
      }
      if (rule.allowedValues.length > 0 && !rule.allowedValues.includes(v)) {
        err(
          rule.type === "gender" ? "gender" : "enum",
          `"${s}" is not an allowed ${rule.type === "gender" ? "gender " : ""}value. Allowed: ${rule.allowedValues.join(", ")}`,
        );
      }
      return { value: v, tag, issues };
    }
    case "amount":
    case "number":
    case "integer": {
      const p = parseNumber(input, tr.numbers || fromEdit || fromDefault);
      if (!p.ok) {
        err(p.reason.includes("stored as text") ? "number_text" : "number", p.reason + (p.reason.includes("stored as text") ? ' (turn on "Convert numbers stored as text" to fix)' : ""));
        return { value: rawToText(input), tag, issues };
      }
      if (p.converted && typeof input === "string") setTag("number");
      if (p.value < 0 && !rule.allowNegative) err("negative", `Negative value ${formatNumber(p.value)} is not allowed in this column`);
      if (rule.type === "integer" && !Number.isInteger(p.value)) err("integer", `${formatNumber(p.value)} must be a whole number`);
      if (rule.type === "amount" && decimalPlaces(p.value) > 2)
        warn("decimals", `${p.value} has more than 2 decimal places (kept exactly as is)`);
      return { value: p.value, tag, issues };
    }
  }
}

function blankResult(c: ColCtx, issues: CellResult["issues"]): CellResult {
  if (c.m.rule.required) issues.push({ level: "error", code: "required", message: "Mandatory value is missing" });
  return { value: null, tag: null, issues };
}

function orderOfPattern(pattern: string): "DMY" | "MDY" | "YMD" {
  const p = pattern.toUpperCase();
  const iy = p.indexOf("Y");
  const im = p.indexOf("M");
  const id = p.indexOf("D");
  if (iy < im && iy < id) return "YMD";
  return im < id ? "MDY" : "DMY";
}

export interface PipelineInput {
  targets: TargetColumn[];
  sources: SourceColumn[];
  sheet: SheetData;
  headerRow: number;
  config: ImportConfig;
  settings: AppSettings;
  today?: Date;
  /** Fill mode: the template sheet with its member list. */
  template?: { sheet: SheetData; headerRow: number };
  memberIndex?: MemberIndex;
  learnedMembers?: LearnedMember[];
  /** Original column holding each row's total (e.g. በእጅ ያለ), if detected. */
  totalCol?: number | null;
  months?: { template: MonthRef | null; source: MonthRef | null };
}

const ACCEPTED: ReadonlySet<MemberMatchStatus> = new Set(["id", "exact", "remembered", "confirmed", "manual"]);

/** Template cell → output value, unchanged. */
export function rawToOut(cell: RawCell): OutValue {
  if (cell === null) return null;
  if (typeof cell === "string") return cell;
  return cell.d ? { date: cell.d } : cell.n;
}

const money = (n: number) => formatNumber(Math.round(n * 100) / 100);

export function runPipeline(input: PipelineInput): PipelineResult {
  const { targets, sources, sheet, headerRow, config, settings } = input;
  const now = input.today ?? new Date();
  const today = {
    y: now.getFullYear(),
    iso: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
  };
  const mappingByTarget = new Map(config.mappings.map((m) => [m.target, m]));
  const ctxs: ColCtx[] = targets.map((t) => buildCtx(t, mappingByTarget.get(t.index)!, sheet, headerRow, settings));
  const excluded = new Set(config.excluded);
  const cellSources = config.cellSources ?? {};
  const fill = config.mode === "fill" && config.fill && input.template && input.memberIndex ? config.fill : null;
  const tplRows = input.template ? input.template.sheet.rows.slice(input.template.headerRow) : [];
  const keyK = fill ? targets.findIndex((t) => t.index === fill.keyTarget) : -1;
  const nameK = fill && fill.nameTarget !== null ? targets.findIndex((t) => t.index === fill.nameTarget) : -1;
  const headerCells = sheet.rows[headerRow - 1] ?? [];
  const rows: PRow[] = [];
  const skipped: Reconciliation["skippedRows"] = [];
  let blank = 0;
  let editedCells = 0;

  const transformAgg = new Map<string, { cells: number; cols: Map<number, number>; samples: TransformStat["samples"] }>();
  const phoneSettings = { countryCode: settings.countryCode, nationalLength: settings.nationalNumberLength };

  // ---- which rows are real data (blank rows, repeated headers/titles, ድምር/total rows and empty rows are skipped)
  const titleRows = sheet.rows.slice(0, headerRow - 1);
  const usedCols = new Set<number>();
  for (const m of config.mappings) if (m.source !== null) usedCols.add(m.source);
  if (fill?.sourceNameCol != null) usedCols.add(fill.sourceNameCol);
  if (fill?.sourceKeyCol != null) usedCols.add(fill.sourceKeyCol);
  const dataRowsIdx: number[] = [];
  for (let r = headerRow; r < sheet.rows.length; r++) {
    const src = sheet.rows[r];
    const edits = config.edits[String(r - headerRow)];
    if (isBlankRow(src) && !edits) {
      blank++;
      continue;
    }
    const cls = edits ? { kind: "data" as const, text: "" } : classifyRow(src, headerCells, titleRows);
    if (cls.kind !== "data") {
      skipped.push({ excelRow: r + 1, kind: cls.kind, text: cls.text });
      continue;
    }
    if (!edits && usedCols.size > 0 && [...usedCols].every((c) => isBlank(src?.[c] ?? null))) {
      skipped.push({ excelRow: r + 1, kind: "empty", text: "Nothing in the columns that are used" });
      continue;
    }
    dataRowsIdx.push(r);
  }

  // ---- fill mode: match each row to a member of the template's list
  let matches: Map<number, MemberMatchInfo> | null = null;
  if (fill) {
    const list = dataRowsIdx.map((r) => {
      const src = sheet.rows[r];
      return {
        i: r - headerRow,
        name: fill.sourceNameCol === null ? "" : rawToText(src?.[fill.sourceNameCol] ?? null).trim(),
        key: fill.sourceKeyCol === null ? "" : identifierText(src?.[fill.sourceKeyCol] ?? null).trim(),
      };
    });
    matches = matchMembers(input.memberIndex!, list, input.learnedMembers ?? [], config.memberOverrides ?? {});
  }

  // ---- row totals (reconciliation inside each row)
  const moneyCols = moneyColumns(sheet, headerRow, sources, [fill?.sourceNameCol ?? null, fill?.sourceKeyCol ?? null]);
  const totalCol = input.totalCol ?? null;
  const components = totalCol !== null ? totalComponents(sources, totalCol, moneyCols) : [];
  const mappedSources = new Map<number, number>(); // source column -> output position k
  ctxs.forEach((c, k) => {
    if (c.m.source !== null && k !== keyK && k !== nameK) mappedSources.set(c.m.source, k);
  });

  for (const r of dataRowsIdx) {
    const src = sheet.rows[r];
    const i = r - headerRow;
    const edits = config.edits[String(i)];
    const match = matches?.get(i) ?? null;
    const memberRow = match?.member && ACCEPTED.has(match.status) ? match.member.row : null;
    // The template's own values for this member — what the final file would contain without the original file.
    const tpl: OutValue[] | null = memberRow !== null ? targets.map((t) => rawToOut(tplRows[memberRow]?.[t.index] ?? null)) : null;
    let tplChange: Record<number, TemplateChange> | null = null;
    const values: OutValue[] = new Array(ctxs.length);
    let changed: Record<number, string> | null = null;
    let edited: Record<number, true> | null = null;
    const issues: Issue[] = [];
    for (let k = 0; k < ctxs.length; k++) {
      const c = ctxs[k];
      const m = c.m;
      if (fill && (k === keyK || k === nameK)) {
        // Member ID and name always come from the system's own member list.
        values[k] = tpl !== null ? tpl[k] : k === nameK ? (match?.sourceName ?? "") : match?.sourceKey || null;
        if (tpl !== null) {
          // The original file spells the member differently: the template's spelling replaces it.
          const own = k === nameK ? (match?.sourceName ?? "") : (match?.sourceKey ?? "");
          if (own.trim() !== "" && squash(own) !== squash(displayValue(values[k], m.rule.dateFormat))) (tplChange ??= {})[k] = "member";
        }
        continue;
      }
      const edit = edits?.[String(c.t.index)];
      if (tpl !== null && edit === undefined) {
        const choice = cellSources[String(i)]?.[String(c.t.index)];
        if (choice === "template" || (choice !== "original" && m.useTemplate)) {
          // You chose the template's value (for this cell or the whole column): the original file's value is not used.
          values[k] = tpl[k];
          if (m.source !== null && !isBlank(src?.[m.source] ?? null)) (tplChange ??= {})[k] = "chosen";
          else if (!outBlank(tpl[k])) (tplChange ??= {})[k] = "kept";
          continue;
        }
      }
      let cell: RawCell = m.source === null ? null : (src?.[m.source] ?? null);
      let fromEdit = false;
      let fromDefault = false;
      if (edit !== undefined) {
        cell = edit === "" ? null : edit;
        fromEdit = true;
        editedCells++;
        (edited ??= {})[k] = true;
      } else if (isBlank(cell) && m.defaultValue !== "" && (m.source === null || m.fillBlanks)) {
        cell = m.defaultValue;
        fromDefault = true;
      }
      if (fill && isBlank(cell) && !fromEdit) {
        // Nothing in the original file for this column: keep the template's own value (e.g. 0, repayment period).
        values[k] = tpl !== null ? tpl[k] : null;
        if (tpl !== null && !outBlank(tpl[k])) (tplChange ??= {})[k] = "kept";
        continue;
      }
      let res: CellResult;
      if (isBlank(cell)) {
        res = blankResult(c, []);
        if (fromEdit) res.tag = "edit";
      } else {
        res = processCell(cell, fromEdit, fromDefault, c, config, settings, today);
      }
      values[k] = res.value;
      if (tpl !== null && displayValue(res.value, m.rule.dateFormat) !== displayValue(tpl[k], m.rule.dateFormat)) (tplChange ??= {})[k] = "replaced";
      for (const is of res.issues) issues.push({ col: c.t.index, ...is });
      if (res.tag) {
        (changed ??= {})[k] = res.tag;
        let agg = transformAgg.get(res.tag);
        if (!agg) transformAgg.set(res.tag, (agg = { cells: 0, cols: new Map(), samples: [] }));
        agg.cells++;
        agg.cols.set(c.t.index, (agg.cols.get(c.t.index) ?? 0) + 1);
        if (agg.samples.length < 40) {
          const before = m.source === null ? "" : rawToText(src?.[m.source] ?? null);
          agg.samples.push({ row: headerRow + 1 + i, target: c.t.index, before, after: displayValue(res.value, m.rule.dateFormat) });
        }
      }
    }

    if (fill && match) {
      const col = fill.keyTarget;
      if (match.status === "suggested")
        issues.push({ col, level: "error", code: "member_unconfirmed", message: `Confirm the member ${match.member!.id} “${match.member!.name}”. ${match.reason}` });
      else if (match.status === "ambiguous") issues.push({ col, level: "error", code: "member_ambiguous", message: `“${match.sourceName}”: ${match.reason}` });
      else if (match.status === "not_found")
        issues.push({ col, level: "error", code: "member_not_found", message: `“${match.sourceName || match.sourceKey}”: ${match.reason}` });
    }

    if (totalCol !== null && components.length) {
      const total = numberOf(src?.[totalCol] ?? null);
      if (total !== null) {
        const sum = components.reduce((a, cc) => a + (numberOf(src?.[cc] ?? null) ?? 0), 0);
        if (Math.abs(sum - total) > 0.005)
          issues.push({
            col: -1,
            level: "warning",
            code: "row_total_mismatch",
            message: `The row total ${money(total)} (${sources[totalCol].label}) is not the sum of its amounts (${money(sum)}).`,
          });
        const lost = components.filter((cc) => !mappedSources.has(cc) && (numberOf(src?.[cc] ?? null) ?? 0) !== 0);
        if (lost.length) {
          const amount = lost.reduce((a, cc) => a + (numberOf(src?.[cc] ?? null) ?? 0), 0);
          issues.push({
            col: -1,
            level: "warning",
            code: "money_not_imported",
            message: `${money(amount)} of this row is in columns the template does not have: ${lost
              .map((cc) => `${sources[cc].label} ${money(numberOf(src?.[cc] ?? null) ?? 0)}`)
              .join(", ")}.`,
          });
        }
      }
    }
    rows.push({
      i,
      values,
      changed,
      edited,
      issues,
      status: "ready",
      duplicate: false,
      member: match,
      tpl,
      tplExcelRow: memberRow !== null && input.template ? input.template.headerRow + 1 + memberRow : null,
      tplChange,
    });
  }

  // ---- duplicates
  if (fill) {
    const byMember = new Map<number, number[]>();
    rows.forEach((row, idx) => {
      const mm = row.member;
      if (mm?.member && ACCEPTED.has(mm.status)) byMember.set(mm.member.row, [...(byMember.get(mm.member.row) ?? []), idx]);
    });
    for (const [, list] of byMember) {
      if (list.length < 2) continue;
      for (const idx of list) {
        const others = list.filter((o) => o !== idx).map((o) => headerRow + 1 + rows[o].i);
        const mm = rows[idx].member!.member!;
        rows[idx].duplicate = true;
        rows[idx].issues.push({
          col: fill.keyTarget,
          level: "error",
          code: "member_duplicate",
          message: `The same member (${mm.id} “${mm.name}”) is also matched in row ${others.join(", ")}.`,
        });
      }
    }
  }
  for (let k = 0; k < ctxs.length; k++) {
    const c = ctxs[k];
    if (!c.m.rule.unique) continue;
    if (fill && (k === keyK || k === nameK || c.m.source === null)) continue;
    const seen = new Map<string, number[]>();
    for (let idx = 0; idx < rows.length; idx++) {
      const v = rows[idx].values[k];
      if (v === null || v === "") continue;
      let key: string;
      if (c.m.rule.type === "phone" && typeof v === "string") {
        const p = parsePhone(v, phoneSettings);
        key = p.ok ? (p.national ?? p.international ?? v) : v;
      } else key = typeof v === "object" ? v.date : String(v).trim().toLowerCase();
      const list = seen.get(key);
      if (list) list.push(idx);
      else seen.set(key, [idx]);
    }
    for (const [, list] of seen) {
      if (list.length < 2) continue;
      for (const idx of list) {
        const others = list.filter((o) => o !== idx).map((o) => headerRow + 1 + rows[o].i);
        const shown = others.slice(0, 5).join(", ") + (others.length > 5 ? ` and ${others.length - 5} more` : "");
        rows[idx].duplicate = true;
        rows[idx].issues.push({
          col: c.t.index,
          level: "error",
          code: "duplicate",
          message: `${c.t.label} "${displayValue(rows[idx].values[k], c.m.rule.dateFormat)}" also appears in row ${shown}`,
        });
      }
    }
  }
  if (!fill) {
    const rowKeys = new Map<string, number[]>();
    for (let idx = 0; idx < rows.length; idx++) {
      const key = JSON.stringify(rows[idx].values);
      const list = rowKeys.get(key);
      if (list) list.push(idx);
      else rowKeys.set(key, [idx]);
    }
    for (const [, list] of rowKeys) {
      if (list.length < 2) continue;
      for (const idx of list) {
        const others = list.filter((o) => o !== idx).map((o) => headerRow + 1 + rows[o].i);
        rows[idx].duplicate = true;
        rows[idx].issues.push({
          col: -1,
          level: "warning",
          code: "duplicate_row",
          message: `This record is identical to row ${others.slice(0, 5).join(", ")}${others.length > 5 ? " and others" : ""}`,
        });
      }
    }
  }

  // ---- statuses and summary
  let ready = 0, clean = 0, withWarnings = 0, withErrors = 0, duplicates = 0, missingMandatory = 0, excl = 0;
  const issueAgg = new Map<string, IssueStat>();
  const memberCounts: Partial<Record<MemberMatchStatus, number>> = {};
  for (const row of rows) {
    const hasError = row.issues.some((x) => x.level === "error");
    const hasWarning = row.issues.some((x) => x.level === "warning");
    if (row.duplicate) duplicates++;
    if (row.member) memberCounts[row.member.status] = (memberCounts[row.member.status] ?? 0) + 1;
    for (const is of row.issues) {
      if (is.code === "required") missingMandatory++;
      const key = `${is.code}|${is.col}`;
      const agg = issueAgg.get(key);
      if (agg) agg.count++;
      else issueAgg.set(key, { code: is.code, level: is.level, col: is.col, label: issueLabel(is.code), count: 1 });
    }
    if (hasError) withErrors++;
    else if (hasWarning) withWarnings++;
    if (excluded.has(row.i) || row.member?.status === "skipped") {
      row.status = "excluded";
      excl++;
    } else if (hasError) row.status = "error";
    else if (hasWarning) {
      row.status = "warning";
      ready++;
    } else {
      row.status = "ready";
      ready++;
      clean++;
    }
  }

  // ---- rows of the final file
  const readyRows = rows.filter((r) => r.status === "ready" || r.status === "warning");
  let outputRows: OutputRow[];
  if (!fill) outputRows = readyRows.map((r) => ({ values: r.values, i: r.i, tplRow: null }));
  else {
    const byTpl = new Map(readyRows.map((r) => [r.member!.member!.row, r]));
    if (fill.includeAll) {
      const all: OutputRow[] = [];
      tplRows.forEach((tr, t) => {
        const r = byTpl.get(t);
        if (r) all.push({ values: r.values, i: r.i, tplRow: t });
        else if (!isBlankRow(tr)) all.push({ values: targets.map((tt) => rawToOut(tr?.[tt.index] ?? null)), i: null, tplRow: t });
      });
      outputRows = all;
    } else outputRows = [...byTpl.entries()].sort((a, b) => a[0] - b[0]).map(([t, r]) => ({ values: r.values, i: r.i, tplRow: t }));
  }

  const reconciliation = reconcile(input, rows, dataRowsIdx, moneyCols, totalCol, mappedSources, skipped);
  const templateChanges = summarizeTemplate(input, rows, outputRows, fill, ctxs);

  const blocking: string[] = [];
  const approvalsNeeded: string[] = [];
  // A column that takes its values from the template does not use its original column, so its match needs no confirmation.
  const pending = config.mappings.filter((m) => m.status === "possible" && !m.confirmed && m.source !== null && !(fill && m.useTemplate));
  if (pending.length)
    blocking.push(`${pending.length} possible column match${pending.length > 1 ? "es need" : " needs"} your confirmation on the Column Mapping step.`);
  for (const c of ctxs) {
    const m = c.m;
    if (!fill && m.rule.required && m.source === null && m.defaultValue === "")
      blocking.push(`Mandatory column "${c.t.label}" has no data. Choose a column from the original file or set a default value.`);
    if (m.defaultValue !== "" && (m.source === null || m.fillBlanks) && c.isMoneyOrId && !m.defaultApproved && !(fill && m.useTemplate))
      approvalsNeeded.push(
        `Default value "${m.defaultValue}" for ${COLUMN_TYPE_LABELS[m.rule.type].toLowerCase()} column "${c.t.label}" creates data that is not in the original file.`,
      );
  }
  if (fill && fill.sourceNameCol === null && fill.sourceKeyCol === null)
    blocking.push("Choose the column of the original file that has the member names (or member IDs) on the Column Mapping step.");
  if (fill && mappedSources.size === 0) blocking.push("No amount columns are mapped. Map at least one column of the original file on the Column Mapping step.");
  const mt = input.months?.template ?? null;
  const ms = input.months?.source ?? null;
  if (mt && ms && !sameMonth(mt, ms) && !config.approvals?.month)
    approvalsNeeded.push(`The template is for ${mt.label}, but the selected sheet of the original file is for ${ms.label}.`);
  if (approvalsNeeded.length) blocking.push(APPROVAL_BLOCK);
  if (rows.length === 0) blocking.push("The original file has no data rows.");
  else if (ready === 0) blocking.push("No records are ready for import. Fix the errors first.");

  const transforms: TransformStat[] = [...transformAgg.entries()].map(([key, a]) => ({
    key,
    label: TRANSFORM_TAG_LABELS[key] ?? key,
    cells: a.cells,
    columns: [...a.cols.entries()].map(([target, count]) => ({ target, count })),
    samples: a.samples,
  }));

  const issues = [...issueAgg.values()].sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === "error" ? -1 : 1));
  const dateOrders: Record<number, "DMY" | "MDY" | "YMD"> = {};
  for (const c of ctxs) if (c.m.rule.type === "date") dateOrders[c.t.index] = c.dateOrder;

  return {
    rows,
    outputRows,
    dateOrders,
    summary: {
      totalRows: rows.length,
      blankRowsSkipped: blank,
      ready,
      clean,
      withWarnings,
      withErrors,
      duplicates,
      missingMandatory,
      excluded: excl,
      edited: editedCells,
      issues,
      transforms,
      blocking,
      approvalsNeeded,
      outputRows: outputRows.length,
      members: fill ? memberCounts : null,
      reconciliation,
      template: templateChanges,
    },
  };
}

export { APPROVAL_BLOCK } from "../types";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const squash = (s: string) => s.trim().replace(/\s+/g, " ");
const outBlank = (v: OutValue) => v === null || (typeof v === "string" && v.trim() === "");

/** Short text of a template row, e.g. "000001 · Example Member · M". */
function rowText(row: RawCell[] | undefined): string {
  const text = (row ?? []).map((c) => rawToText(c).trim()).filter(Boolean).slice(0, 6).join(" · ");
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

const TEMPLATE_SAMPLES = 40;

/**
 * What the final file does with the rows and values the template already has.
 * Only rows that are written to the final file count as changes; rows with errors leave the template as it is.
 */
function summarizeTemplate(
  input: PipelineInput,
  rows: PRow[],
  outputRows: OutputRow[],
  fill: FillSettings | null,
  ctxs: ColCtx[],
): TemplateChangeSummary | null {
  if (!input.template) return null;
  const { sheet: tSheet, headerRow: tHeader } = input.template;
  const templateRowIdx: number[] = [];
  for (let r = tHeader; r < tSheet.rows.length; r++) if (!isBlankRow(tSheet.rows[r])) templateRowIdx.push(r - tHeader);

  let rowsUpdated = 0;
  let rowsUnchanged = 0;
  const removed: number[] = [];
  if (fill) {
    const updated = new Set<number>();
    const inFinal = new Set<number>();
    for (const o of outputRows) {
      if (o.tplRow === null) continue;
      inFinal.add(o.tplRow);
      if (o.i !== null) updated.add(o.tplRow);
    }
    for (const t of templateRowIdx) {
      if (updated.has(t)) rowsUpdated++;
      else if (inFinal.has(t)) rowsUnchanged++;
      else removed.push(t);
    }
  } else removed.push(...templateRowIdx); // the final file only has the original file's records

  const keyK = fill ? ctxs.findIndex((c) => c.t.index === fill.keyTarget) : -1;
  const nameK = fill && fill.nameTarget !== null ? ctxs.findIndex((c) => c.t.index === fill.nameTarget) : -1;
  const agg = new Map<TemplateChange, { cells: number; cols: Map<number, number>; samples: Map<number, TemplateChangeStat["samples"]> }>();
  for (const row of rows) {
    if (!row.tplChange || !row.tpl || (row.status !== "ready" && row.status !== "warning")) continue;
    const src = input.sheet.rows[input.headerRow + row.i];
    for (const [kStr, key] of Object.entries(row.tplChange)) {
      const k = Number(kStr);
      const c = ctxs[k];
      let a = agg.get(key);
      if (!a) agg.set(key, (a = { cells: 0, cols: new Map(), samples: new Map() }));
      a.cells++;
      a.cols.set(c.t.index, (a.cols.get(c.t.index) ?? 0) + 1);
      const list = a.samples.get(c.t.index) ?? [];
      if (list.length < TEMPLATE_SAMPLES) {
        const original =
          k === nameK ? (row.member?.sourceName ?? "") : k === keyK ? (row.member?.sourceKey ?? "") : c.m.source === null ? "" : rawToText(src?.[c.m.source] ?? null);
        list.push({
          row: input.headerRow + 1 + row.i,
          target: c.t.index,
          template: displayValue(row.tpl[k], c.m.rule.dateFormat),
          original,
          after: displayValue(row.values[k], c.m.rule.dateFormat),
        });
        a.samples.set(c.t.index, list);
      }
    }
  }
  const order: TemplateChange[] = ["replaced", "chosen", "member", "kept"];
  const changes: TemplateChangeStat[] = order
    .filter((key) => agg.has(key))
    .map((key) => {
      const a = agg.get(key)!;
      // Examples from every column, taken in turn, so one busy column does not hide the others.
      const lists = [...a.samples.values()];
      const samples: TemplateChangeStat["samples"] = [];
      for (let n = 0; samples.length < TEMPLATE_SAMPLES && lists.some((l) => l.length > n); n++)
        for (const l of lists) if (l[n] && samples.length < TEMPLATE_SAMPLES) samples.push(l[n]);
      return {
        key,
        label: TEMPLATE_CHANGE_LABELS[key],
        cells: a.cells,
        columns: [...a.cols.entries()].map(([target, count]) => ({ target, count })),
        samples,
      };
    });

  return {
    mode: fill ? "fill" : "rows",
    templateRows: templateRowIdx.length,
    rowsUpdated,
    rowsUnchanged,
    rowsRemoved: removed.length,
    removedSamples: removed.slice(0, 5).map((t) => ({ excelRow: tHeader + 1 + t, text: rowText(tSheet.rows[tHeader + t]) })),
    changes,
  };
}

function reconcile(
  input: PipelineInput,
  rows: PRow[],
  dataRowsIdx: number[],
  moneyCols: number[],
  totalCol: number | null,
  mappedSources: Map<number, number>,
  skipped: Reconciliation["skippedRows"],
): Reconciliation | null {
  const { sheet, headerRow, sources, targets } = input;
  const cols = moneyCols.filter((c) => c !== totalCol);
  if (cols.length === 0 && totalCol === null) return null;
  const num = (r: number, c: number) => numberOf(sheet.rows[r]?.[c] ?? null) ?? 0;
  const rowByI = new Map(rows.map((r) => [r.i, r]));
  const imported = (r: number) => {
    const row = rowByI.get(r - headerRow);
    return row !== undefined && (row.status === "ready" || row.status === "warning");
  };
  const columns: ReconciliationColumn[] = cols.map((c) => {
    const k = mappedSources.get(c);
    let sourceTotal = 0;
    let importedTotal = 0;
    for (const r of dataRowsIdx) {
      sourceTotal += num(r, c);
      if (k !== undefined && imported(r)) {
        const row = rowByI.get(r - headerRow)!;
        if (row.tplChange?.[k] === "chosen") continue; // the template's value was used instead — not money from the original file
        const v = row.values[k];
        if (typeof v === "number") importedTotal += v;
      }
    }
    return {
      source: c,
      label: sources[c].label,
      target: k === undefined ? null : targets[k].index,
      sourceTotal: round2(sourceTotal),
      importedTotal: round2(importedTotal),
    };
  });
  let notImportedByColumn = 0;
  let notImportedByRow = 0;
  let notImportedByChoice = 0;
  for (const r of dataRowsIdx) {
    if (imported(r)) {
      const row = rowByI.get(r - headerRow)!;
      for (const c of cols) {
        const k = mappedSources.get(c);
        if (k === undefined) notImportedByColumn += num(r, c);
        else if (row.tplChange?.[k] === "chosen") notImportedByChoice += num(r, c);
      }
    } else for (const c of cols) notImportedByRow += num(r, c);
  }
  const collected = totalCol === null ? null : round2(dataRowsIdx.reduce((a, r) => a + num(r, totalCol), 0));

  // Check the sheet's own ድምር / total rows against the rows above them.
  const checkCols = totalCol !== null ? [totalCol, ...cols] : cols;
  const sheetTotals: SheetTotalCheck[] = [];
  const pageSum = new Map<number, number>();
  const grandSum = new Map<number, number>();
  const dataSet = new Set(dataRowsIdx);
  const skippedAt = new Map(skipped.map((s) => [s.excelRow - 1, s]));
  for (let r = headerRow; r < sheet.rows.length; r++) {
    if (dataSet.has(r)) {
      for (const c of checkCols) {
        pageSum.set(c, (pageSum.get(c) ?? 0) + num(r, c));
        grandSum.set(c, (grandSum.get(c) ?? 0) + num(r, c));
      }
      continue;
    }
    const s = skippedAt.get(r);
    if (!s || s.kind !== "total") continue;
    const grand = isGrandTotalText(s.text);
    const against = grand ? grandSum : pageSum;
    const details: string[] = [];
    for (const c of checkCols) {
      const v = numberOf(sheet.rows[r]?.[c] ?? null);
      if (v === null) continue;
      const expected = against.get(c) ?? 0;
      if (Math.abs(v - expected) > 0.01) details.push(`${sources[c].label}: the sheet says ${money(v)}, the rows add up to ${money(expected)}`);
    }
    sheetTotals.push({ excelRow: r + 1, label: s.text, ok: details.length === 0, details });
    if (!grand) pageSum.clear();
  }
  return {
    totalColumn: totalCol,
    collected,
    imported: round2(columns.reduce((a, c) => a + c.importedTotal, 0)),
    notImportedByColumn: round2(notImportedByColumn),
    notImportedByRow: round2(notImportedByRow),
    notImportedByChoice: round2(notImportedByChoice),
    columns,
    sheetTotals,
    skippedRows: skipped,
  };
}

export function issueLabel(code: string): string {
  const labels: Record<string, string> = {
    required: "Missing mandatory value",
    duplicate: "Duplicate value in a unique column",
    duplicate_row: "Identical duplicate record",
    date: "Invalid date",
    date_format: "Date not in template format",
    date_range: "Date out of range",
    dob_future: "Date of birth in the future",
    phone: "Invalid phone number",
    phone_zero: "Phone missing leading zero",
    phone_format: "Phone not in required format",
    number: "Invalid number",
    number_text: "Number stored as text",
    negative: "Negative value not allowed",
    integer: "Not a whole number",
    decimals: "More than 2 decimal places",
    gender: "Invalid gender value",
    enum: "Value not in allowed list",
    email: "Invalid email address",
    spaces: "Spaces around ID",
    member_unconfirmed: "Member match needs your confirmation",
    member_ambiguous: "Several possible members",
    member_not_found: "Not found in the member list",
    member_duplicate: "Same member matched twice",
    row_total_mismatch: "Row total does not add up",
    money_not_imported: "Money in columns the template does not have",
  };
  return labels[code] ?? code;
}

/** Turn an internal row into the API shape for the preview table. */
export function toApiRow(row: PRow, targets: TargetColumn[], config: ImportConfig, sheet: SheetData, headerRow: number): ProcessedRow {
  const mappingByTarget = new Map(config.mappings.map((m) => [m.target, m]));
  const src = sheet.rows[headerRow + row.i];
  return {
    i: row.i,
    excelRow: headerRow + 1 + row.i,
    values: row.values,
    display: targets.map((t, k) => displayValue(row.values[k], mappingByTarget.get(t.index)!.rule.dateFormat)),
    original: targets.map((t) => {
      const fill = config.mode === "fill" ? config.fill : null;
      if (fill && t.index === fill.keyTarget) return row.member?.sourceKey ?? "";
      if (fill && t.index === fill.nameTarget) return row.member?.sourceName ?? "";
      const m = mappingByTarget.get(t.index)!;
      return m.source === null ? "" : rawToText(src?.[m.source] ?? null);
    }),
    template: row.tpl ? targets.map((t, k) => displayValue(row.tpl![k], mappingByTarget.get(t.index)!.rule.dateFormat)) : null,
    templateRow: row.tplExcelRow ?? null,
    fromTemplate: targets.map((_, k) => row.tplChange?.[k] ?? null),
    valueFrom: targets.map((t, k): ValueFrom | null => {
      const v = row.values[k];
      if (v === null || v === "") return null;
      if (row.edited?.[k]) return "edit";
      const fill = config.mode === "fill" ? config.fill : null;
      if (row.tpl && (row.tplChange?.[k] || t.index === fill?.keyTarget || t.index === fill?.nameTarget)) {
        if (row.tplChange?.[k] !== "replaced") return "template";
      }
      return row.changed?.[k] === "default" ? "default" : "original";
    }),
    sourceChoice: targets.map((t) => config.cellSources?.[String(row.i)]?.[String(t.index)] ?? null),
    changed: targets.map((_, k) => row.changed?.[k] ?? null),
    edited: targets.map((_, k) => Boolean(row.edited?.[k])),
    issues: row.issues,
    status: row.status,
    duplicate: row.duplicate,
    member: row.member ?? null,
  };
}
