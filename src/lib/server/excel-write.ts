import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import type {
  AppSettings,
  ColumnMapping,
  ImportConfig,
  OutValue,
  SourceColumn,
  TargetColumn,
  UploadedFile,
  VerificationResult,
} from "../types";
import { COLUMN_TYPE_LABELS, MEMBER_STATUS_LABELS, TEMPLATE_CHANGE_LABELS, TRANSFORM_INFO } from "../types";
import type { SheetData } from "../core/analyze";
import type { OutputRow, PipelineResult } from "../core/pipeline";
import { TRANSFORM_TAG_LABELS, displayValue, issueLabel, originalText, sourceColumnsOf } from "../core/pipeline";
import { colLetter, rawToText } from "../core/text";
import { formatDate, fromISO, patternToExcelFormat } from "../core/values";
import { clampValidations, readForVerification, XLSX } from "./excel-read";
import { tk, translate, translateMessage, type Lang, type Vars } from "../i18n";

export interface OutputContext {
  importName: string;
  settings: AppSettings;
  template: UploadedFile;
  source: UploadedFile;
  templateSheet: SheetData;
  templateBuffer: Buffer | null; // only for .xlsx templates
  targets: TargetColumn[];
  sources: SourceColumn[];
  config: ImportConfig;
  result: PipelineResult;
  sourceSheet: SheetData;
  generatedAt: Date;
  /** Language of the reports. The final data file is never translated: it keeps the template's own headers. */
  lang?: Lang;
}

/** Excel's limit: column XFD. */
const EXCEL_MAX_COLUMNS = 16_384;

/** Original columns worth showing: they have a header or at least one value (empty, unnamed columns are skipped). */
export function usedSourceColumns(sources: SourceColumn[]): SourceColumn[] {
  return sources.filter((s) => !(s.blankHeader && s.empty));
}

/** Translation helpers for one report, in the language of `ctx`. */
function i18n(ctx: OutputContext) {
  const lang = ctx.lang ?? "en";
  return {
    tr: (text: string, vars?: Vars) => translate(lang, text, vars),
    msg: (m: string) => translateMessage(lang, m),
  };
}

/** Templates bigger than this many cells are written with the low-memory streaming writer. */
const TEMPLATE_FILL_MAX_CELLS = 400_000;

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const ERROR_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E1" } };

function mappingFor(ctx: OutputContext, t: TargetColumn): ColumnMapping {
  return ctx.config.mappings.find((m) => m.target === t.index)!;
}

function isDateFormat(fmt: string | undefined): boolean {
  return Boolean(fmt && XLSX.SSF.is_date(fmt));
}

function writeValue(cell: ExcelJS.Cell, v: OutValue, m: ColumnMapping, t: TargetColumn) {
  if (v === null || v === "") return;
  if (typeof v === "object") {
    const p = fromISO(v.date);
    cell.value = new Date(Date.UTC(p.y, p.m - 1, p.d));
    cell.numFmt = patternToExcelFormat(m.rule.dateFormat);
    return;
  }
  if (typeof v === "number") {
    cell.value = v;
    if (t.numFmt && !isDateFormat(t.numFmt) && t.numFmt !== "@") cell.numFmt = t.numFmt;
    return;
  }
  cell.value = v; // written as text, never as a formula
  if (m.rule.type === "identifier" || m.rule.type === "phone") cell.numFmt = "@";
}

async function streamWorkbook(build: (wb: ExcelJS.stream.xlsx.WorkbookWriter) => Promise<void>): Promise<Buffer> {
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    pass.on("end", () => resolve());
    pass.on("error", reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: true });
  wb.creator = "SACCO Data Import";
  await build(wb);
  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
}

function readyRows(ctx: OutputContext): OutputRow[] {
  return ctx.result.outputRows;
}

// ------------------------------------------------------------------------------------ final file

export async function writeFinalXlsx(ctx: OutputContext): Promise<{ buffer: Buffer; mode: "template" | "fresh"; notes: string[] }> {
  const rows = readyRows(ctx);
  const notes: string[] = [];
  const cells = rows.length * ctx.targets.length;
  if (ctx.templateBuffer && cells <= TEMPLATE_FILL_MAX_CELLS) {
    try {
      const buffer = await fillTemplate(ctx, rows);
      notes.push("The final file is a copy of your template (styles, dropdown lists and other sheets are kept) with the data filled in.");
      return { buffer, mode: "template", notes };
    } catch (e) {
      console.warn("[excel-write] template fill failed, using a new workbook instead:", e);
      notes.push("The template could not be copied exactly, so a new workbook with the same sheet name, rows above the header and headers was created.");
    }
  } else if (ctx.templateBuffer) {
    notes.push("Large file: written with the low-memory writer. Sheet name, header row and column order follow the template; template styling is not copied.");
  } else {
    notes.push(`The template is a .${ctx.template.ext} file, so a new .xlsx workbook with the same sheet name and headers was created.`);
  }
  const buffer = await freshWorkbook(ctx, rows);
  return { buffer, mode: "fresh", notes };
}

async function fillTemplate(ctx: OutputContext, rows: OutputRow[]): Promise<Buffer> {
  const headerRow = ctx.template.headerRow;
  const prepared = clampValidations(ctx.templateBuffer!, ctx.template.sheet, Math.max(headerRow + rows.length, headerRow + 1));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(prepared as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(ctx.template.sheet);
  if (!ws) throw new Error(`Sheet "${ctx.template.sheet}" not found in template`);
  if (ws.getTables().length > 0) throw new Error("Template uses Excel tables");
  removeRowsBelow(ws, headerRow);
  const maps = ctx.targets.map((t) => mappingFor(ctx, t));
  for (let r = 0; r < rows.length; r++) {
    const row = ws.getRow(headerRow + 1 + r);
    for (let k = 0; k < ctx.targets.length; k++) {
      const t = ctx.targets[k];
      writeValue(row.getCell(t.index + 1), rows[r].values[k], maps[k], t);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Removes every row below the template's header row (example rows, or the member list of a template that lists its members),
 * so the final file holds only the rows written by this import.
 *
 * ExcelJS's spliceRows cannot be used: when the removed rows reach the end of the sheet it only removes a single last row and
 * silently keeps the others (exceljs 4.4.0, worksheet.spliceRows). A row without cells and without a height is not written.
 */
function removeRowsBelow(ws: ExcelJS.Worksheet, headerRow: number) {
  for (let r = ws.rowCount; r > headerRow; r--) {
    const row = ws.findRow(r);
    if (!row) continue;
    row.values = []; // removes all cells of the row
    row.height = undefined as unknown as number;
  }
  // Never hand on a file that still holds template rows: the caller then builds a new workbook instead.
  let left = 0;
  ws.eachRow((row, n) => {
    if (n > headerRow && row.hasValues) left++;
  });
  if (left) throw new Error(`${left} template rows below the header could not be removed`);
}

async function freshWorkbook(ctx: OutputContext, rows: OutputRow[]): Promise<Buffer> {
  const headerRow = ctx.template.headerRow;
  const maps = ctx.targets.map((t) => mappingFor(ctx, t));
  return streamWorkbook(async (wb) => {
    const ws = wb.addWorksheet(ctx.template.sheet.slice(0, 31));
    ws.columns = ctx.targets.map((t) => ({ width: Math.max(12, Math.min(40, t.header.length + 4)) }));
    for (let r = 1; r < headerRow; r++) {
      const src = ctx.templateSheet.rows[r - 1] ?? [];
      const row = ws.getRow(r);
      src.forEach((c, i) => {
        const text = rawToText(c);
        if (text !== "") row.getCell(i + 1).value = text;
      });
      row.commit();
    }
    const hr = ws.getRow(headerRow);
    for (const t of ctx.targets) {
      const cell = hr.getCell(t.index + 1);
      if (t.header !== "") cell.value = t.header;
      cell.font = { bold: true };
    }
    hr.commit();
    for (let r = 0; r < rows.length; r++) {
      const row = ws.getRow(headerRow + 1 + r);
      for (let k = 0; k < ctx.targets.length; k++) {
        const t = ctx.targets[k];
        writeValue(row.getCell(t.index + 1), rows[r].values[k], maps[k], t);
      }
      row.commit();
    }
    ws.commit();
  });
}

function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeFinalCsv(ctx: OutputContext): Buffer {
  const maps = ctx.targets.map((t) => mappingFor(ctx, t));
  const lines: string[] = [ctx.targets.map((t) => csvEscape(t.header)).join(",")];
  for (const row of readyRows(ctx)) {
    lines.push(
      row.values
        .map((v, k) => {
          if (v === null) return "";
          if (typeof v === "number") return String(v);
          if (typeof v === "object") return csvEscape(formatDate(fromISO(v.date), maps[k].rule.dateFormat));
          return csvEscape(v);
        })
        .join(","),
    );
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}

// ------------------------------------------------------------------------------------ invalid records

export async function writeInvalidXlsx(ctx: OutputContext): Promise<{ buffer: Buffer; rows: number }> {
  const bad = ctx.result.rows.filter((r) => r.status === "error" || r.status === "excluded");
  const headerRow = ctx.source.headerRow;
  const targetToSource = new Map(ctx.config.mappings.map((m) => [m.target, m.source]));
  const targetToSources = new Map(ctx.config.mappings.map((m) => [m.target, sourceColumnsOf(m)]));
  const fill = ctx.config.mode === "fill" ? ctx.config.fill : null;
  const firstSourceCol = fill ? 6 : 4;
  // Only original columns with a header or data are copied, and never more than Excel allows. A single stray value far to the
  // right (e.g. in column XFD) makes a sheet 16,384 columns wide, which would not fit next to the columns added here.
  const sourceCols = usedSourceColumns(ctx.sources).slice(0, EXCEL_MAX_COLUMNS - firstSourceCol + 1);
  const { tr, msg } = i18n(ctx);
  const buffer = await streamWorkbook(async (wb) => {
    const ws = wb.addWorksheet(tr("Invalid records"), { views: [{ state: "frozen", ySplit: 1, xSplit: 3 }] });
    ws.columns = [
      { header: tr("Original row"), width: 12 },
      { header: tr("Status"), width: 12 },
      { header: tr("Problems to fix"), width: 60 },
      ...(fill ? [{ header: tr("Member match"), width: 26 }, { header: tr("Suggested / possible members"), width: 50 }] : []),
      ...sourceCols.map((s) => ({ header: s.header.trim() || s.label, width: Math.max(12, Math.min(30, s.label.length + 4)) })),
    ];
    const head = ws.getRow(1);
    head.eachCell((c) => {
      c.fill = HEADER_FILL;
      c.font = HEADER_FONT;
    });
    head.commit();
    for (const row of bad) {
      const src = ctx.sourceSheet.rows[headerRow + row.i] ?? [];
      const problems = row.issues.filter((x) => x.level === "error").map((x) => (x.col >= 0 ? `${ctx.targets[x.col].label}: ${msg(x.message)}` : msg(x.message)));
      if (row.status === "excluded") problems.unshift(tr("Excluded by user"));
      const values: (string | number)[] = [headerRow + 1 + row.i, row.status === "excluded" ? tr("Excluded") : tr("Error"), problems.join("; ")];
      if (fill) {
        const mm = row.member;
        values.push(mm ? tr(MEMBER_STATUS_LABELS[mm.status]) : "");
        const options = mm ? (mm.member ? [mm.member, ...mm.candidates.filter((c) => c.id !== mm.member!.id)] : mm.candidates) : [];
        values.push(options.slice(0, 5).map((c) => `${c.id} ${c.name}`).join("; "));
      }
      for (const s of sourceCols) values.push(rawToText(src[s.index] ?? null));
      const r = ws.addRow(values);
      const badSources = new Set(row.issues.filter((x) => x.level === "error" && x.col >= 0).flatMap((x) => targetToSources.get(x.col) ?? []));
      sourceCols.forEach((s, idx) => {
        const cell = r.getCell(firstSourceCol + idx);
        cell.numFmt = "@";
        if (badSources.has(s.index)) cell.fill = ERROR_FILL;
      });
      r.getCell(3).alignment = { wrapText: true, vertical: "top" };
      r.commit();
    }
    ws.commit();

    const list = wb.addWorksheet(tr("Problem list"), { views: [{ state: "frozen", ySplit: 1 }] });
    list.columns = [
      { header: tr("Original row"), width: 12 },
      { header: tr("Template column"), width: 26 },
      { header: tr("Original column"), width: 26 },
      { header: tr("Value in original file"), width: 26 },
      { header: tr("Severity"), width: 10 },
      { header: tr("Problem"), width: 70 },
    ];
    list.getRow(1).eachCell((c) => {
      c.fill = HEADER_FILL;
      c.font = HEADER_FONT;
    });
    list.getRow(1).commit();
    for (const row of bad) {
      const src = ctx.sourceSheet.rows[headerRow + row.i] ?? [];
      for (const is of row.issues) {
        const t = is.col >= 0 ? ctx.targets[is.col] : null;
        const sIdx = t ? targetToSource.get(t.index) : null;
        const s = sIdx !== null && sIdx !== undefined ? ctx.sources[sIdx] : null;
        list
          .addRow([
            headerRow + 1 + row.i,
            t?.label ?? tr("(whole record)"),
            s ? `${s.letter}: ${s.label}` : "",
            s ? rawToText(src[s.index] ?? null) : "",
            is.level === "error" ? tr("Error") : tr("Warning"),
            msg(is.message),
          ])
          .commit();
      }
    }
    list.commit();
  });
  return { buffer, rows: bad.length };
}

// ------------------------------------------------------------------------------------ validation report

export async function writeReportXlsx(ctx: OutputContext, verification: VerificationResult | null, finalMode: string): Promise<Buffer> {
  const s = ctx.result.summary;
  const headerRow = ctx.source.headerRow;
  const { tr, msg } = i18n(ctx);
  const yes = tr("Yes");
  const no = tr("No");
  const level = (l: "error" | "warning") => (l === "error" ? tr("Error") : tr("Warning"));
  return streamWorkbook(async (wb) => {
    const ws = wb.addWorksheet(tr("Summary"));
    ws.columns = [{ width: 42 }, { width: 70 }, { width: 14 }, { width: 14 }];
    const title = ws.addRow([tr("SACCO Data Import — Validation Report")]);
    title.font = { bold: true, size: 14 };
    title.commit();
    const kv = (k: string, v: string | number) => {
      const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true };
      r.commit();
    };
    const section = (name: string) => {
      ws.addRow([]).commit();
      const r = ws.addRow([name]);
      r.font = { bold: true, size: 12, color: { argb: "FF0F766E" } };
      r.commit();
    };
    if (ctx.settings.organizationName) kv(tr("Organization"), ctx.settings.organizationName);
    kv(tr("Import name"), ctx.importName);
    kv(tr("Generated at"), ctx.generatedAt.toLocaleString("en-GB"));
    section(tr("Files"));
    kv(tr("Sample template"), tr('{file} (sheet "{sheet}", headers on row {row})', { file: ctx.template.originalName, sheet: ctx.template.sheet, row: ctx.template.headerRow }));
    kv(tr("Template SHA-256"), ctx.template.sha256);
    kv(tr("Original data file"), tr('{file} (sheet "{sheet}", headers on row {row})', { file: ctx.source.originalName, sheet: ctx.source.sheet, row: ctx.source.headerRow }));
    kv(tr("Original file SHA-256"), ctx.source.sha256);
    kv(tr("Final file layout"), finalMode === "template" ? tr("Copy of the template with data filled in") : tr("New workbook following the template structure"));
    section(tr("Results"));
    kv(tr("Total original records"), s.totalRows);
    kv(tr("Blank rows ignored"), s.blankRowsSkipped);
    kv(tr("Records included in final file"), s.ready);
    kv(tr("  – of which have warnings"), s.withWarnings);
    kv(tr("Records with errors (not included)"), s.withErrors);
    kv(tr("Excluded by user (not included)"), s.excluded);
    kv(tr("Duplicate records"), s.duplicates);
    kv(tr("Missing mandatory values (cells)"), s.missingMandatory);
    kv(tr("Cells corrected by user"), s.edited);
    if (verification) {
      section(tr("Verification of the generated file"));
      for (const c of verification.checks) kv(c.ok ? tr("✔ Passed") : tr("✘ FAILED"), msg(c.label) + (c.detail ? ` — ${msg(c.detail)}` : ""));
    }
    section(tr("Cleaning options used"));
    for (const [k, info] of Object.entries(TRANSFORM_INFO)) kv(tr(info.label), ctx.config.transforms[k as keyof typeof TRANSFORM_INFO] ? tr("On") : tr("Off"));
    section(tr("Problems found"));
    const ph = ws.addRow([tr("Problem"), tr("Column"), tr("Severity"), tr("Records")]);
    ph.font = { bold: true };
    ph.commit();
    for (const is of s.issues) ws.addRow([msg(is.label), is.col >= 0 ? ctx.targets[is.col].label : tr("(whole record)"), level(is.level), is.count]).commit();
    if (s.issues.length === 0) ws.addRow([tr("No problems found")]).commit();
    section(tr("Changes made by cleaning"));
    const th = ws.addRow([tr("Type of change"), tr("Column"), "", tr("Cells")]);
    th.font = { bold: true };
    th.commit();
    for (const t of s.transforms) for (const c of t.columns) ws.addRow([tr(t.label), ctx.targets[c.target]?.label ?? "", "", c.count]).commit();
    if (s.transforms.length === 0) ws.addRow([tr("No values were changed")]).commit();
    const tc = s.template;
    if (tc && (tc.templateRows > 0 || tc.changes.length > 0)) {
      section(tr("What happens to the rows and values already in the template"));
      kv(tr("Rows below the template's header row"), tc.templateRows);
      if (tc.mode === "fill") {
        kv(tr("Template rows that get data from the original file"), tc.rowsUpdated);
        kv(tr("Template rows copied unchanged (no data in the original file)"), tc.rowsUnchanged);
      }
      kv(tr("Template rows that are not in the final file"), tc.rowsRemoved);
      if (tc.changes.length) {
        const h = ws.addRow([tr("Type of change"), tr("Column"), "", tr("Cells")]);
        h.font = { bold: true };
        h.commit();
        for (const c of tc.changes) for (const col of c.columns) ws.addRow([tr(c.label), ctx.targets[col.target]?.label ?? "", "", col.count]).commit();
      }
    }
    ws.commit();

    const rec = ctx.result.summary.reconciliation;
    if (rec) {
      const rs = wb.addWorksheet(tr("Reconciliation"), { views: [{ state: "frozen", ySplit: 3 }] });
      rs.columns = [{ width: 34 }, { width: 34 }, { width: 18 }, { width: 18 }, { width: 18 }];
      const t = rs.addRow([tr("Reconciliation — totals of the original file compared with the final file")]);
      t.font = { bold: true, size: 13 };
      t.commit();
      rs.addRow([]).commit();
      const h = rs.addRow([tr("Original column"), tr("Template column"), tr("Original total"), tr("In final file"), tr("Amount not imported")]);
      h.font = { bold: true };
      h.commit();
      for (const c of rec.columns) {
        const r = rs.addRow([
          c.label,
          c.target === null ? tr("(not in template — not imported)") : ctx.targets[c.target].label,
          c.sourceTotal,
          c.importedTotal,
          Math.round((c.sourceTotal - c.importedTotal) * 100) / 100,
        ]);
        for (const k of [3, 4, 5]) r.getCell(k).numFmt = "#,##0.00";
        if (Math.abs(c.sourceTotal - c.importedTotal) > 0.005) r.getCell(5).fill = ERROR_FILL;
        r.commit();
      }
      rs.addRow([]).commit();
      const line = (k: string, v: number | null) => {
        const r = rs.addRow([k, "", v]);
        r.getCell(1).font = { bold: true };
        r.getCell(3).numFmt = "#,##0.00";
        r.commit();
      };
      if (rec.totalColumn !== null) line(tr("Collected (column “{col}”)", { col: ctx.sources[rec.totalColumn].label }), rec.collected);
      line(tr("Imported into the final file"), rec.imported);
      line(tr("Not imported — rows not imported (not matched, errors, excluded)"), rec.notImportedByRow);
      line(tr("Not imported — columns the template does not have"), rec.notImportedByColumn);
      if (rec.notImportedByChoice) line(tr("Not imported — cells where you chose the template's value"), rec.notImportedByChoice);
      rs.addRow([]).commit();
      if (rec.sheetTotals.length) {
        const sh = rs.addRow([tr("Total rows in the original sheet"), tr("Row"), tr("Result"), tr("Details")]);
        sh.font = { bold: true };
        sh.commit();
        for (const st of rec.sheetTotals) rs.addRow([st.label, st.excelRow, st.ok ? tr("Adds up") : tr("DOES NOT ADD UP"), st.details.join("; ")]).commit();
      }
      rs.commit();
    }
    if (ctx.config.mode === "fill") {
      const ms = wb.addWorksheet(tr("Member matching"), { views: [{ state: "frozen", ySplit: 1 }] });
      ms.columns = [
        { header: tr("Original row"), width: 12 },
        { header: tr("Name in original file"), width: 30 },
        { header: tr("How it was matched"), width: 26 },
        { header: tr("Member ID"), width: 14 },
        { header: tr("Name in member list"), width: 30 },
        { header: tr("Included in final file"), width: 14 },
        { header: tr("Notes"), width: 70 },
      ];
      ms.getRow(1).font = { bold: true };
      ms.getRow(1).commit();
      for (const row of ctx.result.rows) {
        const mm = row.member;
        if (!mm) continue;
        const r = ms.addRow([
          headerRow + 1 + row.i,
          mm.sourceName,
          tr(MEMBER_STATUS_LABELS[mm.status]),
          mm.member?.id ?? "",
          mm.member?.name ?? "",
          row.status === "ready" || row.status === "warning" ? yes : no,
          msg(mm.reason),
        ]);
        r.getCell(4).numFmt = "@";
        r.commit();
      }
      ms.commit();
    }

    const all = wb.addWorksheet(tr("All problems"), { views: [{ state: "frozen", ySplit: 1 }] });
    all.columns = [
      { header: tr("Original row"), width: 12 },
      { header: tr("Column"), width: 28 },
      { header: tr("Severity"), width: 10 },
      { header: tr("Problem type"), width: 30 },
      { header: tr("Details"), width: 80 },
      { header: tr("Included in final file"), width: 14 },
    ];
    all.getRow(1).font = { bold: true };
    all.getRow(1).commit();
    let n = 0;
    for (const row of ctx.result.rows) {
      for (const is of row.issues) {
        if (n++ > 500_000) break;
        all
          .addRow([
            headerRow + 1 + row.i,
            is.col >= 0 ? ctx.targets[is.col].label : tr("(whole record)"),
            level(is.level),
            tr(issueLabel(is.code)),
            msg(is.message),
            row.status === "ready" || row.status === "warning" ? yes : no,
          ])
          .commit();
      }
    }
    all.commit();

    const log = wb.addWorksheet(tr("Change log"), { views: [{ state: "frozen", ySplit: 1 }] });
    log.columns = [
      { header: tr("Original row"), width: 12 },
      { header: tr("Column"), width: 28 },
      { header: tr("Type of change"), width: 40 },
      { header: tr("Value in original file"), width: 30 },
      { header: tr("Value in template"), width: 30 },
      { header: tr("Value in final file"), width: 30 },
    ];
    log.getRow(1).font = { bold: true };
    log.getRow(1).commit();
    const maps = ctx.targets.map((t) => mappingFor(ctx, t));
    const fill = ctx.config.mode === "fill" ? ctx.config.fill : null;
    let logged = 0;
    for (const row of ctx.result.rows) {
      // Template values only change for rows that are written to the final file; values kept from the template are not changes.
      const inFinal = row.status === "ready" || row.status === "warning";
      const tplChange = inFinal && row.tplChange ? row.tplChange : null;
      if (!row.changed && !tplChange) continue;
      const src = ctx.sourceSheet.rows[headerRow + row.i] ?? [];
      const ks = [...new Set([...Object.keys(row.changed ?? {}), ...Object.keys(tplChange ?? {})].map(Number))].sort((a, b) => a - b);
      for (const k of ks) {
        const tag = row.changed?.[k];
        const tc = tplChange?.[k];
        const tplTag = tc && tc !== "kept" ? tc : null;
        if (!tag && !tplTag) continue;
        if (logged++ > 500_000) break;
        const m = maps[k];
        const t = ctx.targets[k];
        const before =
          fill && t.index === fill.nameTarget
            ? (row.member?.sourceName ?? "")
            : fill && t.index === fill.keyTarget
              ? (row.member?.sourceKey ?? "")
              : originalText(src, m);
        const change = [tag ? tr(TRANSFORM_TAG_LABELS[tag] ?? tag) : "", tplTag ? tr(TEMPLATE_CHANGE_LABELS[tplTag]) : ""].filter(Boolean).join("; ");
        const inTemplate = row.tpl ? displayValue(row.tpl[k], m.rule.dateFormat) : "";
        const r = log.addRow([headerRow + 1 + row.i, t.label, change, before, inTemplate, displayValue(row.values[k], m.rule.dateFormat)]);
        r.getCell(4).numFmt = "@";
        r.getCell(5).numFmt = "@";
        r.getCell(6).numFmt = "@";
        r.commit();
      }
    }
    log.commit();
  });
}

// ------------------------------------------------------------------------------------ mapping report

const STATUS_LABEL: Record<string, string> = {
  exact: tk("Match – same name"),
  learned: tk("Match – confirmed before / saved mapping"),
  synonym: tk("Match – known SACCO name"),
  possible: tk("Possible match"),
  manual: tk("Chosen by user"),
  missing: tk("Not in original file"),
};

export async function writeMappingXlsx(ctx: OutputContext): Promise<Buffer> {
  const { tr, msg } = i18n(ctx);
  const yes = tr("Yes");
  const no = tr("No");
  const fill = ctx.config.mode === "fill" ? ctx.config.fill : null;
  return streamWorkbook(async (wb) => {
    const ws = wb.addWorksheet(tr("Column mapping"), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "#", width: 5 },
      { header: tr("Template column"), width: 8 },
      { header: tr("Template header (exact)"), width: 30 },
      { header: tr("Data type"), width: 22 },
      { header: tr("Mandatory"), width: 11 },
      { header: tr("Unique"), width: 9 },
      { header: tr("Original column"), width: 32 },
      { header: tr("How it was matched"), width: 34 },
      { header: tr("Confirmed"), width: 11 },
      { header: tr("Default value"), width: 18 },
      { header: tr("Format / rules"), width: 40 },
      { header: tr("Notes"), width: 60 },
    ];
    ws.getRow(1).eachCell((c) => {
      c.fill = HEADER_FILL;
      c.font = HEADER_FONT;
    });
    ws.getRow(1).commit();
    ctx.targets.forEach((t, k) => {
      const m = mappingFor(ctx, t);
      const s = m.source !== null ? ctx.sources[m.source] : null;
      const memberCol = fill !== null && (t.index === fill.keyTarget || t.index === fill.nameTarget);
      const rules: string[] = [];
      if (fill && (memberCol || m.useTemplate)) rules.push(tr("Values from the template"));
      if (m.rule.type === "date")
        rules.push(
          m.rule.dateOutput === "date" ? tr("Format {f} (Excel date)", { f: m.rule.dateFormat }) : tr("Format {f} (text)", { f: m.rule.dateFormat }),
          tr("Read source dates as {order}", { order: ctx.result.dateOrders[t.index] ?? m.rule.dateOrder }),
        );
      if (m.rule.type === "phone") rules.push(tr("Phone format: {f}", { f: m.rule.phoneFormat }));
      if (m.rule.allowedValues.length) rules.push(tr("Allowed: {list}", { list: m.rule.allowedValues.join(", ") }));
      const vm = Object.entries(m.rule.valueMap).filter(([, v]) => v);
      if (vm.length) rules.push(tr("Value mapping: {list}", { list: vm.map(([a, b]) => `${a} → ${b}`).join(", ") }));
      if (["amount", "number", "integer"].includes(m.rule.type)) rules.push(m.rule.allowNegative ? tr("Negative allowed") : tr("Negative not allowed"));
      ws.addRow([
        k + 1,
        t.letter,
        t.header,
        tr(COLUMN_TYPE_LABELS[m.rule.type]),
        m.rule.required ? yes : no,
        m.rule.unique ? yes : no,
        m.combine && !m.useTemplate
          ? m.combine.sources.map((i) => `${ctx.sources[i].letter}: ${ctx.sources[i].label}`).join(m.combine.op === "sum" ? " + " : " & ")
          : s && !m.useTemplate
            ? `${s.letter}: ${s.label}`
            : "—",
        memberCol || (fill && m.useTemplate) ? tr("From the template") : tr(STATUS_LABEL[m.status] ?? m.status),
        m.status === "possible" ? (m.confirmed ? yes : no) : "—",
        m.defaultValue ? `${m.defaultValue}${m.source !== null && m.fillBlanks ? ` ${tr("(for blank cells)")}` : ""}` : "",
        rules.join("; "),
        [m.reason, ...m.warnings].filter(Boolean).map(msg).join(" "),
      ]).commit();
    });
    ws.commit();

    const unused = wb.addWorksheet(tr("Unused original columns"));
    unused.columns = [
      { header: tr("Column"), width: 8 },
      { header: tr("Header"), width: 32 },
      { header: tr("Values"), width: 10 },
      { header: tr("Sample values"), width: 70 },
    ];
    unused.getRow(1).font = { bold: true };
    unused.getRow(1).commit();
    const used = new Set(ctx.config.mappings.map((m) => m.source).filter((x) => x !== null));
    for (const s of usedSourceColumns(ctx.sources)) if (!used.has(s.index)) unused.addRow([s.letter, s.label, s.nonEmptyCount, s.samples.join(" | ")]).commit();
    unused.commit();
  });
}

// ------------------------------------------------------------------------------------ verification

export function verifyFinal(buf: Buffer, ctx: OutputContext): VerificationResult {
  const rows = readyRows(ctx);
  const checks: VerificationResult["checks"] = [];
  const headerRow = ctx.template.headerRow;
  const wb = readForVerification(buf);
  const sheetName = ctx.template.sheet.slice(0, 31);
  const ws = wb.Sheets[sheetName];
  checks.push({ label: `Sheet is named "${sheetName}" as in the template`, ok: Boolean(ws) });
  if (!ws) return { ok: false, checkedAt: new Date().toISOString(), sheet: sheetName, headerRow, columns: 0, rows: 0, checks };
  const data = (ws["!data"] ?? []) as (XLSX.CellObject[] | undefined)[];
  const text = (c: XLSX.CellObject | undefined) => (c === undefined || c.v === undefined || c.v === null ? "" : String(c.t === "s" ? c.v : (c.w ?? c.v)));

  // header
  const hdr = data[headerRow - 1] ?? [];
  const badHeaders = ctx.targets.filter((t) => text(hdr[t.index]) !== t.header);
  checks.push({
    label: `Column headers match the template exactly (${ctx.targets.length} columns, same order)`,
    ok: badHeaders.length === 0,
    detail: badHeaders.length ? `Different: ${badHeaders.map((t) => t.letter).join(", ")}` : undefined,
  });
  let extra = 0;
  for (let r = headerRow - 1; r < data.length; r++) {
    const row = data[r] ?? [];
    for (let c = ctx.targets.length; c < row.length; c++) if (text(row[c]) !== "") extra++;
  }
  checks.push({ label: "No extra columns beyond the template", ok: extra === 0, detail: extra ? `${extra} cells outside the template columns` : undefined });

  if (headerRow > 1) {
    let diff = 0;
    for (let r = 0; r < headerRow - 1; r++) {
      const exp = ctx.templateSheet.rows[r] ?? [];
      const got = data[r] ?? [];
      const width = Math.max(exp.length, got.length);
      for (let c = 0; c < width; c++) if (rawToText(exp[c] ?? null) !== text(got[c])) diff++;
    }
    checks.push({ label: `Rows above the header (1–${headerRow - 1}) are the same as in the template`, ok: diff === 0, detail: diff ? `${diff} cells differ` : undefined });
  }

  // data
  let mismatches = 0;
  const examples: string[] = [];
  let textIds = 0;
  let idCells = 0;
  const maps = ctx.targets.map((t) => mappingFor(ctx, t));
  for (let r = 0; r < rows.length; r++) {
    const got = data[headerRow + r] ?? [];
    for (let k = 0; k < ctx.targets.length; k++) {
      const t = ctx.targets[k];
      const exp = rows[r].values[k];
      const cell = got[t.index];
      let ok: boolean;
      if (exp === null || exp === "") ok = text(cell) === "";
      else if (typeof exp === "number") ok = cell?.t === "n" && cell.v === exp;
      else if (typeof exp === "object") {
        if (cell?.t === "n" && typeof cell.v === "number") {
          const p = XLSX.SSF.parse_date_code(cell.v);
          ok = `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` === exp.date && isDateFormat(cell.z as string);
        } else ok = false;
      } else {
        ok = cell?.t === "s" && cell.v === exp;
        if (maps[k].rule.type === "identifier" || maps[k].rule.type === "phone") {
          idCells++;
          if (cell?.t === "s") textIds++;
        }
      }
      if (!ok) {
        mismatches++;
        if (examples.length < 5) examples.push(`${t.letter}${headerRow + 1 + r}: expected "${displayValue(exp, maps[k].rule.dateFormat)}", found "${text(cell)}"`);
      }
    }
  }
  let trailing = 0;
  for (let r = headerRow + rows.length; r < data.length; r++) if ((data[r] ?? []).some((c) => text(c) !== "")) trailing++;
  checks.push({
    label:
      ctx.config.mode === "fill"
        ? `${rows.length.toLocaleString("en-US")} member rows written (${ctx.result.summary.ready.toLocaleString("en-US")} with data from the original file)`
        : `${rows.length.toLocaleString("en-US")} records written — every record ready for import`,
    ok: trailing === 0,
    detail: trailing ? `${trailing} unexpected extra rows` : undefined,
  });
  checks.push({
    label: `All ${(rows.length * ctx.targets.length).toLocaleString("en-US")} cells contain exactly the validated values`,
    ok: mismatches === 0,
    detail: mismatches ? `${mismatches} differences, e.g. ${examples.join("; ")}` : undefined,
  });
  if (idCells > 0)
    checks.push({
      label: "IDs and phone numbers are stored as text (leading zeros preserved)",
      ok: textIds === idCells,
      detail: textIds !== idCells ? `${idCells - textIds} cells are not text` : undefined,
    });
  return {
    ok: checks.every((c) => c.ok),
    checkedAt: new Date().toISOString(),
    sheet: sheetName,
    headerRow,
    columns: ctx.targets.length,
    rows: rows.length,
    checks,
  };
}

export { colLetter };
