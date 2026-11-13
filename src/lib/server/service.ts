import { createHash } from "node:crypto";
import type { Lang } from "../i18n";
import type {
  AnalysisResult,
  AppSettings,
  ColumnMapping,
  ColumnRule,
  FileRole,
  FillSettings,
  ImportConfig,
  ImportStats,
  MappingTemplate,
  OutputFileInfo,
  OutputKind,
  ProcessSummary,
  ProcessedRow,
  SavedMappingEntry,
  SourceColumn,
  TargetColumn,
  TransformOptions,
  UploadedFile,
} from "../types";
import { COLUMN_TYPE_LABELS } from "../types";
import {
  DEFAULT_TRANSFORMS,
  applySavedMapping,
  buildSources,
  buildTargets,
  countDataRows,
  dataWidth,
  dateOrderEvidence,
  detectHeaderRow,
  suggestMappings,
  templateSignature,
  type SheetData,
} from "../core/analyze";
import { runPipeline, toApiRow, displayValue, type PipelineResult } from "../core/pipeline";
import { buildMemberIndex, idKey, type LearnedMember, type MemberIndex } from "../core/members";
import { personNameKey } from "../core/ethiopic";
import { detectFill, detectTotalColumn, moneyColumns, numberOf, sameMonth, sheetMonth, templateMonth } from "../core/structure";
import { lookupConcepts } from "../core/dictionary";
import { headerKey } from "../core/text";
import { parseWorkbook, templateMeta, type ParsedWorkbook } from "./excel-read";
import { verifyFinal, writeFinalCsv, writeFinalXlsx, writeInvalidXlsx, writeMappingXlsx, writeReportXlsx, type OutputContext } from "./excel-write";
import * as repo from "./repo";
import type { FullImport, StoredAnalysis } from "./repo";
import {
  HttpError,
  clearCache,
  copyUpload,
  detectFileType,
  readCache,
  openOutput,
  readUpload,
  removeImportFiles,
  removeUpload,
  safeDownloadName,
  saveUpload,
  sha256,
  writeCache,
  writeOutput,
} from "./storage";

// ------------------------------------------------------------------ in-memory caches (per server process)

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  deletePrefix(prefix: string) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
}

const g = globalThis as unknown as {
  __saccoCache?: {
    sheets: Lru<SheetData>;
    templates: Lru<ParsedWorkbook>;
    results: Lru<{ key: string; result: PipelineResult }>;
    members?: Lru<MemberIndex>;
    locks: Set<string>;
  };
};
const cache = (g.__saccoCache ??= { sheets: new Lru(6), templates: new Lru(6), results: new Lru(4), locks: new Set() });

function invalidate(id: string) {
  cache.sheets.deletePrefix(id);
  cache.members?.deletePrefix(id);
  cache.templates.deletePrefix(id);
  cache.results.deletePrefix(id);
}

// ------------------------------------------------------------------ files

function assertEditable(imp: FullImport) {
  if (imp.status === "completed") throw new HttpError(409, "This import is already completed. Use \"Repeat import\" to make changes.");
  if (imp.status === "cancelled") throw new HttpError(409, "This import was cancelled.");
  if (imp.filesPurgedAt) throw new HttpError(410, "The files of this import were deleted by the retention policy.");
}

/** A file sent by the browser: through this server, or uploaded straight to Vercel Blob first. */
export interface IncomingFile {
  name: string;
  data: Buffer;
}

export async function uploadFile(id: string, role: FileRole, file: IncomingFile) {
  const imp = await repo.getImport(id);
  assertEditable(imp);
  const settings = await repo.getSettings();
  const data = file.data;
  if (data.length > settings.maxUploadMb * 1024 * 1024)
    throw new HttpError(413, `"${file.name}" is ${(data.length / 1024 / 1024).toFixed(1)} MB. The maximum upload size is ${settings.maxUploadMb} MB (change it in Settings).`);
  const ext = detectFileType(file.name, data);
  const parsed = parseWorkbook(data, ext, { template: role === "template" });
  const sheetIdx = Math.max(0, parsed.sheets.findIndex((s) => s.rows.length > 0));
  const sheet = parsed.sheets[sheetIdx];
  if (!sheet || sheet.rows.length === 0) throw new HttpError(400, `"${file.name}" does not contain any data.`);
  const headerRow = detectHeaderRow(sheet.rows);

  const { storedName, sha256: hash } = await saveUpload(id, role, ext, data);
  const previous = role === "template" ? imp.template : imp.source;
  if (previous && previous.storedName !== storedName) await removeUpload(id, previous.storedName).catch(() => {});
  await clearCache(id, role);
  invalidate(id);
  if (role === "template") await writeCache(id, "template.json", parsed);
  else {
    await Promise.all(parsed.sheets.map((s, i) => writeCache(id, `source-${i}.json`, s)));
  }

  const info: UploadedFile = {
    role,
    originalName: file.name.slice(0, 255),
    storedName,
    size: data.length,
    sha256: hash,
    ext,
    uploadedAt: new Date().toISOString(),
    sheets: parsed.sheets.map((s) => ({ name: s.name, rowCount: s.rows.length, colCount: dataWidth(s.rows, 1), month: sheetMonth(s)?.label })),
    sheet: sheet.name,
    headerRow,
    headerRowDetected: headerRow,
    columnCount: dataWidth(sheet.rows, headerRow),
    dataRowCount: countDataRows(sheet.rows, headerRow),
  };
  await repo.updateImport(id, {
    [role]: info,
    ...(role === "source" ? { source_sha256: hash } : {}),
    ...(imp.name === "" || imp.name.startsWith("Import ") ? { name: role === "source" ? defaultName(file.name) : imp.name } : {}),
    analysis: null,
    config: null,
    summary: null,
    stats: null,
    status: "draft",
  });
  await repo.logEvent(id, "file_uploaded", { role, name: info.originalName, size: info.size, sha256: hash, replaced: previous?.originalName ?? null });
  return { file: info, duplicateOf: role === "source" ? await duplicatesOf(id, hash) : [] };
}

function defaultName(fileName: string) {
  return fileName.replace(/\.(xlsx|xls|csv)$/i, "").slice(0, 120);
}

async function duplicatesOf(id: string, hash: string | null | undefined) {
  if (!hash) return [];
  const rows = await repo.findCompletedBySourceHash(hash, id);
  return rows.map((r) => ({ id: r.id, name: r.name, completedAt: r.completed_at?.toISOString() ?? null, status: r.status }));
}

export async function selectSheet(id: string, role: FileRole, body: { sheet?: string; headerRow?: number }) {
  const imp = await repo.getImport(id);
  assertEditable(imp);
  const file = role === "template" ? imp.template : imp.source;
  if (!file) throw new HttpError(400, "Upload the file first.");
  const next: UploadedFile = { ...file };
  if (body.sheet !== undefined) {
    if (!file.sheets.some((s) => s.name === body.sheet)) throw new HttpError(400, "Unknown sheet.");
    next.sheet = body.sheet;
    next.sheetChosen = true;
  }
  const sheet = await loadSheet(id, next);
  if (body.sheet !== undefined && body.headerRow === undefined) {
    next.headerRow = detectHeaderRow(sheet.rows);
    next.headerRowDetected = next.headerRow;
  }
  if (body.headerRow !== undefined) {
    const hr = Math.floor(Number(body.headerRow));
    if (!Number.isFinite(hr) || hr < 1 || hr > Math.max(1, sheet.rows.length)) throw new HttpError(400, `Header row must be between 1 and ${sheet.rows.length}.`);
    next.headerRow = hr;
  }
  next.columnCount = dataWidth(sheet.rows, next.headerRow);
  next.dataRowCount = countDataRows(sheet.rows, next.headerRow);
  await repo.updateImport(id, { [role]: next, analysis: null, config: null, summary: null, stats: null, status: "draft" });
  invalidate(id);
  await repo.logEvent(id, "file_settings_changed", { role, sheet: next.sheet, headerRow: next.headerRow });
  return { file: next, headers: headerPreview(sheet, next.headerRow) };
}

function headerPreview(sheet: SheetData, headerRow: number): string[] {
  return (sheet.rows[headerRow - 1] ?? []).map((c) => (c === null ? "" : typeof c === "string" ? c : c.w));
}

async function loadTemplateParsed(id: string, file: UploadedFile): Promise<ParsedWorkbook> {
  const key = `${id}:template:${file.storedName}`;
  const hit = cache.templates.get(key);
  if (hit) return hit;
  let parsed = await readCache<ParsedWorkbook>(id, "template.json");
  if (!parsed) {
    parsed = parseWorkbook(await readUpload(id, file.storedName), file.ext, { template: true });
    await writeCache(id, "template.json", parsed);
  }
  cache.templates.set(key, parsed);
  return parsed;
}

async function loadSheet(id: string, file: UploadedFile): Promise<SheetData> {
  if (file.role === "template") {
    const parsed = await loadTemplateParsed(id, file);
    const s = parsed.sheets.find((x) => x.name === file.sheet);
    if (!s) throw new HttpError(400, `Sheet "${file.sheet}" not found.`);
    return s;
  }
  const idx = file.sheets.findIndex((s) => s.name === file.sheet);
  const key = `${id}:source:${file.storedName}:${idx}`;
  const hit = cache.sheets.get(key);
  if (hit) return hit;
  let sheet = await readCache<SheetData>(id, `source-${idx}.json`);
  if (!sheet) {
    const parsed = parseWorkbook(await readUpload(id, file.storedName), file.ext, { template: false });
    await Promise.all(parsed.sheets.map((s, i) => writeCache(id, `source-${i}.json`, s)));
    sheet = parsed.sheets[idx];
  }
  if (!sheet) throw new HttpError(400, `Sheet "${file.sheet}" not found.`);
  cache.sheets.set(key, sheet);
  return sheet;
}

export async function filePreview(id: string, role: FileRole) {
  const imp = await repo.getImport(id);
  const file = role === "template" ? imp.template : imp.source;
  if (!file) throw new HttpError(404, "File not uploaded.");
  const sheet = await loadSheet(id, file);
  const rows = sheet.rows.slice(0, 12).map((r) => r.map((c) => (c === null ? "" : typeof c === "string" ? c : c.w)));
  return { rows, headerRow: file.headerRow, headers: headerPreview(sheet, file.headerRow) };
}

// ------------------------------------------------------------------ analysis

function mappingEntriesFromConfig(targets: TargetColumn[], sources: SourceColumn[], config: ImportConfig): SavedMappingEntry[] {
  return config.mappings.map((m) => {
    const t = targets[m.target];
    const s = m.source !== null ? sources[m.source] : null;
    return {
      targetHeader: t.header,
      sourceHeader: s ? headerKey(s.header) : null,
      sourceLabel: s ? s.label : null,
      defaultValue: m.defaultValue,
      fillBlanks: m.fillBlanks,
      ...(m.useTemplate ? { useTemplate: true } : {}),
      ...(m.combine
        ? {
            combine: {
              op: m.combine.op,
              separator: m.combine.separator,
              sourceHeaders: m.combine.sources.map((i) => headerKey(sources[i].header)),
              sourceLabels: m.combine.sources.map((i) => sources[i].label),
            },
          }
        : {}),
      rule: m.rule,
    };
  });
}

export async function analyze(id: string, opts: { mappingTemplateId?: string | null }) {
  const imp = await repo.getImport(id);
  assertEditable(imp);
  if (!imp.template || !imp.source) throw new HttpError(400, "Upload both the sample template and the original data file first.");
  const settings = await repo.getSettings();
  const tplParsed = await loadTemplateParsed(id, imp.template);
  const tplSheet = await loadSheet(id, imp.template);

  // Month check: use the sheet of the original file that is for the template's month (unless the user chose a sheet).
  const tplMonth = templateMonth(tplSheet, imp.template.headerRow);
  let sheetNote: string | null = null;
  if (tplMonth && !imp.source.sheetChosen && imp.source.sheets.length > 1) {
    const matching: { name: string; label: string }[] = [];
    for (const s of imp.source.sheets) {
      const sh = await loadSheet(id, { ...imp.source, sheet: s.name });
      const m = sheetMonth(sh);
      if (m && sameMonth(m, tplMonth)) matching.push({ name: s.name, label: m.label });
    }
    if (matching.length === 1 && matching[0].name !== imp.source.sheet) {
      const sh = await loadSheet(id, { ...imp.source, sheet: matching[0].name });
      const hr = detectHeaderRow(sh.rows);
      imp.source = { ...imp.source, sheet: matching[0].name, headerRow: hr, headerRowDetected: hr, columnCount: dataWidth(sh.rows, hr), dataRowCount: countDataRows(sh.rows, hr) };
      await repo.updateImport(id, { source: imp.source });
      sheetNote = `Sheet “${matching[0].name}” (${matching[0].label}) was selected because the template is for ${tplMonth.label}.`;
    } else if (matching.length === 1) sheetNote = `Sheet “${matching[0].name}” is for ${matching[0].label}, the same month as the template.`;
    else if (matching.length === 0) sheetNote = `No sheet of the original file is for ${tplMonth.label}. Check the file, or choose the sheet yourself on the upload step.`;
    else sheetNote = `Several sheets are for ${tplMonth.label} (${matching.map((m) => m.name).join(", ")}). Choose the right one on the upload step.`;
  }
  const srcSheet = await loadSheet(id, imp.source);
  const srcMonth = sheetMonth(srcSheet);

  const meta = templateMeta(tplParsed, imp.template.sheet, imp.template.headerRow);
  const { targets, issues: templateIssues } = buildTargets(tplSheet, imp.template.headerRow, meta, settings);
  if (targets.length === 0) throw new HttpError(400, `No column headers were found on row ${imp.template.headerRow} of the template. Choose the correct header row.`);
  const { sources, issues: sourceIssues } = buildSources(srcSheet, imp.source.headerRow, settings);
  if (sources.length === 0) throw new HttpError(400, `No columns were found on row ${imp.source.headerRow} of the original file. Choose the correct header row.`);
  const learned = (await repo.listAliases()).map((a) => ({ targetKey: a.targetKey, sourceKey: a.sourceKey }));
  let mappings = suggestMappings(targets, sources, srcSheet, imp.source.headerRow, settings, learned);
  const fillInfo = detectFill(targets, tplSheet, imp.template.headerRow);
  const signature = templateSignature(targets);

  // Saved mapping: explicit choice, the previous import (for repeats) or the best saved mapping for this template.
  let saved: { id: string; name: string; entries: SavedMappingEntry[]; transforms: TransformOptions } | null = null;
  if (opts.mappingTemplateId) {
    if (opts.mappingTemplateId.startsWith("import:")) {
      saved = await previousImportMapping(opts.mappingTemplateId.slice(7));
    } else {
      const m = await repo.getMapping(opts.mappingTemplateId);
      if (m) saved = { id: m.id, name: m.name, entries: m.entries, transforms: m.transforms };
    }
  } else if (opts.mappingTemplateId === undefined) {
    if (imp.repeatOf) saved = await previousImportMapping(imp.repeatOf);
    if (!saved) {
      const candidates = await repo.listMappings(signature);
      const keys = new Set(sources.map((s) => headerKey(s.header)));
      let best: MappingTemplate | null = null;
      let bestScore = -1;
      for (const c of candidates) {
        const score = c.entries.filter((e) => e.sourceHeader && keys.has(e.sourceHeader)).length;
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }
      if (best && bestScore > 0) saved = { id: best.id, name: best.name, entries: best.entries, transforms: best.transforms };
    }
  }
  let notFound: string[] = [];
  let transforms: TransformOptions = { ...DEFAULT_TRANSFORMS };
  if (saved) {
    const applied = applySavedMapping(mappings, targets, sources, saved.entries);
    mappings = applied.mappings;
    notFound = applied.notFound;
    transforms = { ...DEFAULT_TRANSFORMS, ...saved.transforms };
  }

  // Fill mode: the template already lists the members; ID and name come from that list, rows are matched by name / ID.
  let fill: FillSettings | null = null;
  if (fillInfo.available && fillInfo.keyTarget !== null) {
    const confident = (m: ColumnMapping | undefined) => (m && m.source !== null && m.status !== "possible" ? m.source : null);
    const keyM = mappings.find((m) => m.target === fillInfo.keyTarget);
    const nameM = fillInfo.nameTarget !== null ? mappings.find((m) => m.target === fillInfo.nameTarget) : undefined;
    const sourceNameCol =
      nameM?.source ?? sources.find((s) => lookupConcepts(s.header).some((e) => e.concept.id === "full_name"))?.index ?? null;
    fill = { keyTarget: fillInfo.keyTarget, nameTarget: fillInfo.nameTarget, sourceNameCol, sourceKeyCol: confident(keyM), includeAll: false };
    mappings = mappings.map((m) =>
      m.target === fill!.keyTarget || m.target === fill!.nameTarget
        ? { ...m, source: null, status: "missing", confirmed: true, reason: "Taken from the template's member list", warnings: [] }
        : m,
    );
  }
  const money = moneyColumns(srcSheet, imp.source.headerRow, sources, [fill?.sourceNameCol ?? null, fill?.sourceKeyCol ?? null]);
  const totalCol = detectTotalColumn(srcSheet, imp.source.headerRow, sources, money);

  const dateOrderDetected: AnalysisResult["dateOrderDetected"] = {};
  for (const m of mappings) {
    if (m.rule.type === "date" && m.source !== null) dateOrderDetected[m.target] = dateOrderEvidence(srcSheet, imp.source.headerRow, m.source);
  }
  const config: ImportConfig = {
    mappings,
    transforms,
    edits: {},
    excluded: [],
    appliedMappingTemplateId: saved?.id ?? null,
    mode: fill ? "fill" : "rows",
    fill,
    memberOverrides: {},
    approvals: { month: false },
  };
  const analysis: StoredAnalysis = {
    targets,
    sources,
    templateIssues,
    sourceIssues,
    orderDiffers: mappings.some((m) => m.source !== null && m.source !== m.target),
    extraSources: sources.filter((s) => !mappings.some((m) => m.source === s.index)).map((s) => s.index),
    savedMapping: saved ? { id: saved.id, name: saved.name } : null,
    savedMappingNotFound: notFound,
    dateOrderDetected,
    fill: fillInfo,
    months: { template: tplMonth, source: srcMonth },
    sheetNote,
    sourceTotalCol: totalCol,
  };
  invalidate(id);
  const result = await runCached(id, { ...imp, analysis, config }, config, settings);
  await repo.updateImport(id, {
    analysis,
    config,
    template_signature: signature,
    status: "mapping",
    summary: result.summary,
    stats: statsOf(result.summary),
  });
  await repo.logEvent(id, "analyzed", {
    templateColumns: targets.length,
    sourceColumns: sources.length,
    matched: mappings.filter((m) => m.source !== null && m.confirmed).length,
    possible: mappings.filter((m) => m.status === "possible" && !m.confirmed).length,
    savedMapping: saved?.name ?? null,
  });
  return getDetail(id);
}

async function previousImportMapping(prevId: string) {
  const prev = await repo.getImport(prevId).catch(() => null);
  if (!prev?.analysis || !prev.config) return null;
  return {
    id: `import:${prev.id}`,
    name: `Previous import "${prev.name}"`,
    entries: mappingEntriesFromConfig(prev.analysis.targets, prev.analysis.sources, prev.config),
    transforms: prev.config.transforms,
  };
}

function statsOf(s: ProcessSummary): ImportStats {
  return {
    totalRows: s.totalRows,
    ready: s.ready,
    withErrors: s.withErrors,
    withWarnings: s.withWarnings,
    duplicates: s.duplicates,
    missingMandatory: s.missingMandatory,
    excluded: s.excluded,
  };
}

export async function getDetail(id: string) {
  const imp = await repo.getImport(id);
  const duplicateOf = imp.status === "completed" ? [] : await duplicatesOf(id, imp.source?.sha256);
  const mappingOptions = imp.templateSignature
    ? (await repo.listMappings(imp.templateSignature)).map((m) => ({ id: m.id, name: m.name, timesUsed: m.timesUsed, lastUsedAt: m.lastUsedAt }))
    : [];
  // Summaries saved by older versions do not show what happens to the template's own values yet: check again (read-only).
  if (imp.summary && imp.summary.template === undefined && imp.config && imp.analysis && !imp.filesPurgedAt && (imp.status === "draft" || imp.status === "mapping")) {
    try {
      const result = await runCached(id, imp, imp.config, await repo.getSettings());
      return { import: { ...imp, summary: result.summary }, duplicateOf, mappingOptions };
    } catch (e) {
      console.warn("[service] could not refresh the saved summary:", e);
    }
  }
  return { import: imp, duplicateOf, mappingOptions };
}

// ------------------------------------------------------------------ processing

/** JSON with object keys sorted, so equal configs give equal cache keys (PostgreSQL JSONB reorders keys). */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

async function runCached(id: string, imp: FullImport, config: ImportConfig, settings: AppSettings): Promise<PipelineResult> {
  if (!imp.analysis || !imp.template || !imp.source) throw new HttpError(400, "Analyze the files first.");
  const key = createHash("sha1")
    .update(stableStringify([config, imp.source.storedName, imp.source.sheet, imp.source.headerRow, imp.template.storedName, imp.template.headerRow, settings]))
    .digest("hex");
  const hit = cache.results.get(id);
  if (hit && hit.key === key) return hit.result;
  const sheet = await loadSheet(id, imp.source);
  const fill = config.mode === "fill" ? config.fill : null;
  // The template is always passed in, so the summary can show what happens to the rows and values it already has.
  const template: { sheet: SheetData; headerRow: number } = { sheet: await loadSheet(id, imp.template), headerRow: imp.template.headerRow };
  let memberIndex: MemberIndex | undefined;
  let learnedMembers: LearnedMember[] = [];
  if (fill) {
    memberIndex = await getMemberIndex(id, imp, fill);
    learnedMembers = (await repo.listLearnedMembers()).map((l) => ({ nameKey: l.nameKey, memberId: l.memberId }));
  }
  const result = runPipeline({
    targets: imp.analysis.targets,
    sources: imp.analysis.sources,
    sheet,
    headerRow: imp.source.headerRow,
    config,
    settings,
    template,
    memberIndex,
    learnedMembers,
    totalCol: imp.analysis.sourceTotalCol ?? null,
    months: imp.analysis.months,
  });
  cache.results.set(id, { key, result });
  return result;
}

async function getMemberIndex(id: string, imp: FullImport, fill: FillSettings): Promise<MemberIndex> {
  const key = `${id}:${imp.template!.storedName}:${imp.template!.headerRow}:${fill.keyTarget}:${fill.nameTarget}`;
  const members = (cache.members ??= new Lru(4));
  const hit = members.get(key);
  if (hit) return hit;
  const idx = buildMemberIndex(await loadSheet(id, imp.template!), imp.template!.headerRow, fill.keyTarget, fill.nameTarget);
  members.set(key, idx);
  return idx;
}

const COLUMN_TYPES = Object.keys(COLUMN_TYPE_LABELS);

/** Validate and normalise a configuration sent by the browser. Edits and exclusions stay server-side. */
function sanitizeConfig(input: unknown, imp: FullImport): ImportConfig {
  const a = imp.analysis!;
  const prev = imp.config!;
  const raw = (input ?? {}) as Partial<ImportConfig>;
  if (!Array.isArray(raw.mappings) || raw.mappings.length !== a.targets.length) throw new HttpError(400, "Invalid mapping configuration.");
  const mappings: ColumnMapping[] = a.targets.map((t, k) => {
    const m = (raw.mappings as ColumnMapping[]).find((x) => x && x.target === t.index) ?? prev.mappings[k];
    // Combined columns: 2–10 existing original columns; the first one is the mapping's source.
    const cb = m.combine;
    const combineSources =
      cb && Array.isArray(cb.sources) ? [...new Set(cb.sources.map(Number))].filter((x) => Number.isInteger(x) && a.sources[x]).slice(0, 10) : [];
    const combine =
      combineSources.length >= 2
        ? { op: cb!.op === "sum" ? ("sum" as const) : ("join" as const), sources: combineSources, separator: String(cb!.separator ?? " ").slice(0, 5) }
        : undefined;
    const source = combine ? combine.sources[0] : m.source === null || m.source === undefined ? null : Number(m.source);
    if (source !== null && (!Number.isInteger(source) || !a.sources[source])) throw new HttpError(400, `Invalid source column for "${t.label}".`);
    const r = (m.rule ?? prev.mappings[k].rule) as ColumnRule;
    const rule: ColumnRule = {
      type: COLUMN_TYPES.includes(r.type) ? r.type : "text",
      required: Boolean(r.required),
      unique: Boolean(r.unique),
      allowNegative: Boolean(r.allowNegative),
      dateFormat: String(r.dateFormat || "DD/MM/YYYY").toUpperCase().slice(0, 20),
      dateOutput: r.dateOutput === "text" ? "text" : "date",
      dateOrder: ["auto", "DMY", "MDY", "YMD"].includes(r.dateOrder) ? r.dateOrder : "auto",
      calendar: r.calendar === "ethiopian" || r.calendar === "gregorian" ? r.calendar : "auto",
      phoneFormat: ["local", "international", "international_no_plus", "keep"].includes(r.phoneFormat) ? r.phoneFormat : "local",
      allowedValues: Array.isArray(r.allowedValues) ? r.allowedValues.map(String).filter((x) => x.trim() !== "").slice(0, 200) : [],
      valueMap: Object.fromEntries(Object.entries(r.valueMap ?? {}).slice(0, 500).map(([kk, v]) => [String(kk).toLowerCase(), String(v)])),
    };
    const status = ["exact", "learned", "synonym", "possible", "manual", "missing"].includes(m.status) ? m.status : "manual";
    return {
      target: t.index,
      source,
      status: source === null && status !== "missing" ? "missing" : status,
      confirmed: status === "possible" ? Boolean(m.confirmed) : true,
      reason: String(m.reason ?? "").slice(0, 300),
      warnings: Array.isArray(m.warnings) ? m.warnings.map(String).slice(0, 5) : [],
      defaultValue: String(m.defaultValue ?? "").slice(0, 500),
      fillBlanks: Boolean(m.fillBlanks),
      defaultApproved: Boolean(m.defaultApproved),
      ...(m.useTemplate ? { useTemplate: true } : {}),
      ...(combine ? { combine } : {}),
      rule,
    };
  });
  const t = (raw.transforms ?? prev.transforms) as TransformOptions;
  const transforms: TransformOptions = {
    trim: Boolean(t.trim),
    dates: Boolean(t.dates),
    numbers: Boolean(t.numbers),
    phones: Boolean(t.phones),
    codes: Boolean(t.codes),
    nameCase: Boolean(t.nameCase),
    emailCase: Boolean(t.emailCase),
  };
  // Fill settings: the user may change the name/ID column and whether all template members are included.
  let fill: FillSettings | null = prev.fill ?? null;
  if (!fill) for (const m of mappings) delete m.useTemplate; // only a template that lists the members has values to take
  if (fill && raw.fill) {
    const col = (v: unknown, fallback: number | null) =>
      v === undefined ? fallback : v === null ? null : Number.isInteger(Number(v)) && a.sources[Number(v)] ? Number(v) : fallback;
    fill = {
      ...fill,
      sourceNameCol: col(raw.fill.sourceNameCol, fill.sourceNameCol),
      sourceKeyCol: col(raw.fill.sourceKeyCol, fill.sourceKeyCol),
      includeAll: raw.fill.includeAll === undefined ? fill.includeAll : Boolean(raw.fill.includeAll),
    };
  }
  if (fill) {
    // ID and name always come from the member list, never from an original column.
    for (const m of mappings)
      if (m.target === fill.keyTarget || m.target === fill.nameTarget) {
        Object.assign(m, { source: null, status: "missing", confirmed: true, reason: "Taken from the template's member list", warnings: [] });
        delete m.combine;
      }
  }
  return {
    mappings,
    transforms,
    edits: prev.edits,
    cellSources: prev.cellSources ?? {},
    excluded: prev.excluded,
    appliedMappingTemplateId: raw.appliedMappingTemplateId === undefined ? prev.appliedMappingTemplateId : (raw.appliedMappingTemplateId ?? null),
    mode: prev.mode ?? "rows",
    fill,
    memberOverrides: prev.memberOverrides ?? {},
    approvals: prev.approvals ?? { month: false },
  };
}

export async function processConfig(id: string, input: unknown) {
  const imp = await repo.getImport(id);
  assertEditable(imp);
  if (!imp.analysis || !imp.config) throw new HttpError(400, "Analyze the files first.");
  const config = sanitizeConfig(input, imp);
  const settings = await repo.getSettings();
  const result = await runCached(id, imp, config, settings);
  await repo.updateImport(id, { config, summary: result.summary, stats: statsOf(result.summary) });
  return { summary: result.summary, dateOrders: result.dateOrders, config };
}

export type RowFilter = "all" | "ready" | "errors" | "warnings" | "duplicates" | "excluded" | "changed" | "template";

export async function getRows(id: string, opts: { filter: RowFilter; page: number; size: number; q?: string; code?: string; col?: number }) {
  const imp = await repo.getImport(id);
  if (!imp.analysis || !imp.config || !imp.source) throw new HttpError(400, "Analyze the files first.");
  if (imp.filesPurgedAt) throw new HttpError(410, "The files of this import were deleted by the retention policy.");
  const settings = await repo.getSettings();
  const result = await runCached(id, imp, imp.config, settings);
  const maps = imp.config.mappings;
  const q = opts.q?.trim().toLowerCase();
  const rows = result.rows.filter((r) => {
    switch (opts.filter) {
      case "ready": if (r.status !== "ready" && r.status !== "warning") return false; break;
      case "errors": if (r.status !== "error") return false; break;
      case "warnings": if (r.status !== "warning") return false; break;
      case "duplicates": if (!r.duplicate) return false; break;
      case "excluded": if (r.status !== "excluded") return false; break;
      case "changed": if (!r.changed) return false; break;
      case "template": if (!r.tplChange || !Object.values(r.tplChange).some((c) => c !== "kept")) return false; break;
    }
    if (opts.code && !r.issues.some((x) => x.code === opts.code && (opts.col === undefined || x.col === opts.col))) return false;
    if (q) {
      const excelRow = String(imp.source!.headerRow + 1 + r.i);
      if (excelRow !== q && !r.values.some((v, k) => displayValue(v, maps[k].rule.dateFormat).toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const size = Math.min(Math.max(opts.size, 10), 200);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(1, opts.page), pages);
  const sheet = await loadSheet(id, imp.source);
  const slice = rows.slice((page - 1) * size, page * size).map((r) => toApiRow(r, imp.analysis!.targets, imp.config!, sheet, imp.source!.headerRow));
  return { rows: slice, total: rows.length, page, pages, size };
}

export async function getRow(id: string, i: number): Promise<ProcessedRow | null> {
  const imp = await repo.getImport(id);
  if (!imp.analysis || !imp.config || !imp.source) return null;
  const settings = await repo.getSettings();
  const result = await runCached(id, imp, imp.config, settings);
  const r = result.rows.find((x) => x.i === i);
  if (!r) return null;
  const sheet = await loadSheet(id, imp.source);
  return toApiRow(r, imp.analysis.targets, imp.config, sheet, imp.source.headerRow);
}

export async function editRow(
  id: string,
  body: { action: "edit" | "revert" | "exclude" | "include" | "source"; row: number; target?: number; value?: string },
) {
  const imp = await repo.getImport(id);
  assertEditable(imp);
  if (!imp.analysis || !imp.config || !imp.source) throw new HttpError(400, "Analyze the files first.");
  const sheet = await loadSheet(id, imp.source);
  const i = Math.floor(Number(body.row));
  if (!Number.isInteger(i) || i < 0 || imp.source.headerRow + i >= Math.max(sheet.rows.length, imp.source.headerRow + 1))
    throw new HttpError(400, "Invalid row.");
  const config: ImportConfig = structuredClone(imp.config);
  const excelRow = imp.source.headerRow + 1 + i;
  const key = String(i);
  if (body.action === "edit" || body.action === "revert") {
    const target = body.target === undefined ? undefined : Math.floor(Number(body.target));
    if (target !== undefined && !imp.analysis.targets[target]) throw new HttpError(400, "Invalid column.");
    if (body.action === "edit" && imp.config.mode === "fill" && (target === imp.config.fill?.keyTarget || target === imp.config.fill?.nameTarget))
      throw new HttpError(400, "Member ID and name come from the member list. Choose a different member on the Members step instead.");
    const before = await getRow(id, i);
    if (body.action === "edit") {
      if (target === undefined) throw new HttpError(400, "Column is required.");
      const value = String(body.value ?? "").slice(0, 2000);
      (config.edits[key] ??= {})[String(target)] = value;
      await repo.logEvent(id, "cell_edited", {
        row: excelRow,
        column: imp.analysis.targets[target].label,
        from: before?.display[target] ?? "",
        original: before?.original[target] ?? "",
        to: value,
      });
    } else {
      if (target === undefined) delete config.edits[key];
      else if (config.edits[key]) {
        delete config.edits[key][String(target)];
        if (Object.keys(config.edits[key]).length === 0) delete config.edits[key];
      }
      await repo.logEvent(id, "cell_reverted", { row: excelRow, column: target === undefined ? "(all)" : imp.analysis.targets[target].label });
    }
  } else if (body.action === "source") {
    // Fill mode: take this cell (or every cell of the row) from the template or from the original file.
    const fill = imp.config.mode === "fill" ? imp.config.fill : null;
    if (!fill) throw new HttpError(400, "Values can only be taken from the template when the template lists the members.");
    const choice = body.value;
    if (choice !== "template" && choice !== "original" && choice !== "auto") throw new HttpError(400, "Choose “template” or “original”.");
    const target = body.target === undefined ? undefined : Math.floor(Number(body.target));
    if (target !== undefined && !imp.analysis.targets[target]) throw new HttpError(400, "Invalid column.");
    if (target === fill.keyTarget || target === fill.nameTarget)
      throw new HttpError(400, "Member ID and name always come from the template's member list. Choose a different member on the Members step instead.");
    const cols = target !== undefined ? [target] : imp.analysis.targets.map((t) => t.index).filter((x) => x !== fill.keyTarget && x !== fill.nameTarget);
    const sources = (config.cellSources ??= {});
    const rowChoices = { ...(sources[key] ?? {}) };
    for (const col of cols) {
      if (choice === "auto") delete rowChoices[String(col)];
      else {
        rowChoices[String(col)] = choice;
        // Choosing a source replaces a value you typed for this cell.
        if (config.edits[key]) delete config.edits[key][String(col)];
      }
    }
    if (config.edits[key] && Object.keys(config.edits[key]).length === 0) delete config.edits[key];
    if (Object.keys(rowChoices).length) sources[key] = rowChoices;
    else delete sources[key];
    await repo.logEvent(id, "cell_source_changed", {
      row: excelRow,
      column: target === undefined ? "(whole row)" : imp.analysis.targets[target].label,
      to: choice === "auto" ? "column setting" : choice,
    });
  } else if (body.action === "exclude") {
    if (!config.excluded.includes(i)) config.excluded.push(i);
    await repo.logEvent(id, "row_excluded", { row: excelRow });
  } else if (body.action === "include") {
    config.excluded = config.excluded.filter((x) => x !== i);
    await repo.logEvent(id, "row_included", { row: excelRow });
  } else throw new HttpError(400, "Unknown action.");
  const settings = await repo.getSettings();
  const result = await runCached(id, imp, config, settings);
  await repo.updateImport(id, { config, summary: result.summary, stats: statsOf(result.summary) });
  const r = result.rows.find((x) => x.i === i);
  return {
    summary: result.summary,
    row: r ? toApiRow(r, imp.analysis.targets, config, sheet, imp.source.headerRow) : null,
  };
}

/** Distinct values of an original column (for value mapping of gender / list columns). */
export async function distinctValues(id: string, source: number) {
  const imp = await repo.getImport(id);
  if (!imp.source || !imp.analysis) throw new HttpError(400, "Analyze the files first.");
  const sheet = await loadSheet(id, imp.source);
  const counts = new Map<string, number>();
  for (let r = imp.source.headerRow; r < sheet.rows.length; r++) {
    const c = sheet.rows[r]?.[source] ?? null;
    const v = (c === null ? "" : typeof c === "string" ? c : c.w).trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (counts.size > 500) break;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([value, count]) => ({ value, count }));
}

// ------------------------------------------------------------------ generation

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function generate(
  id: string,
  body: { confirmDuplicate?: boolean; approveDefaults?: boolean; saveMapping?: { save: boolean; name: string; updateExisting?: boolean }; lang?: string },
) {
  if (cache.locks.has(id)) throw new HttpError(409, "This import is already being generated. Please wait.");
  // Reports are written in the user's language; without one (e.g. API scripts) they stay English.
  const lang: Lang = body.lang === "am" ? "am" : "en";
  cache.locks.add(id);
  try {
    const imp = await repo.getImport(id);
    assertEditable(imp);
    if (!imp.analysis || !imp.config || !imp.template || !imp.source) throw new HttpError(400, "Analyze the files first.");
    const settings = await repo.getSettings();
    const config: ImportConfig = structuredClone(imp.config);
    if (body.approveDefaults) {
      for (const m of config.mappings) if (m.defaultValue !== "") m.defaultApproved = true;
      config.approvals = { ...(config.approvals ?? { month: false }), month: true };
    }
    const result = await runCached(id, imp, config, settings);
    if (result.summary.blocking.length)
      throw new HttpError(409, "The final file cannot be generated yet.", { code: "blocked", blocking: result.summary.blocking });
    const dups = await duplicatesOf(id, imp.source.sha256);
    if (dups.length && !body.confirmDuplicate)
      throw new HttpError(409, "This original file was already processed before.", { code: "duplicate", duplicateOf: dups });

    const generatedAt = new Date();
    const ctx: OutputContext = {
      importName: imp.name,
      settings,
      template: imp.template,
      source: imp.source,
      templateSheet: await loadSheet(id, imp.template),
      templateBuffer: imp.template.ext === "xlsx" ? await readUpload(id, imp.template.storedName) : null,
      targets: imp.analysis.targets,
      sources: imp.analysis.sources,
      config,
      result,
      sourceSheet: await loadSheet(id, imp.source),
      generatedAt,
      lang,
    };
    const final = await writeFinalXlsx(ctx);
    const verification = verifyFinal(final.buffer, ctx);
    const csv = writeFinalCsv(ctx);
    const invalid = await writeInvalidXlsx(ctx);
    const report = await writeReportXlsx(ctx, verification, final.mode);
    const mappingReport = await writeMappingXlsx(ctx);

    const base = safeDownloadName(imp.template.originalName.replace(/\.(xlsx|xls|csv)$/i, ""));
    const ts = stamp(generatedAt);
    const files: { kind: OutputKind; stored: string; name: string; data: Buffer; rows: number }[] = [
      { kind: "final", stored: "final.xlsx", name: `${base} - READY FOR IMPORT ${ts}.xlsx`, data: final.buffer, rows: result.summary.ready },
      { kind: "final_csv", stored: "final.csv", name: `${base} - READY FOR IMPORT ${ts}.csv`, data: csv, rows: result.summary.ready },
      { kind: "invalid", stored: "invalid.xlsx", name: `${base} - invalid records ${ts}.xlsx`, data: invalid.buffer, rows: invalid.rows },
      { kind: "report", stored: "report.xlsx", name: `${base} - validation report ${ts}.xlsx`, data: report, rows: result.summary.totalRows },
      { kind: "mapping", stored: "mapping.xlsx", name: `${base} - column mapping ${ts}.xlsx`, data: mappingReport, rows: imp.analysis.targets.length },
    ];
    const outputs: OutputFileInfo[] = [];
    for (const f of files) {
      await writeOutput(id, f.stored, f.data);
      outputs.push({ kind: f.kind, fileName: f.name, storedName: f.stored, size: f.data.length, sha256: sha256(f.data), rows: f.rows });
    }

    // Remember confirmed mappings for future imports.
    let savedMapping: MappingTemplate | null = null;
    if (body.saveMapping?.save) {
      const existing = config.appliedMappingTemplateId && !config.appliedMappingTemplateId.startsWith("import:") && body.saveMapping.updateExisting !== false
        ? config.appliedMappingTemplateId
        : null;
      savedMapping = await repo.saveMapping({
        id: existing,
        name: (body.saveMapping.name || `${imp.template.originalName} mapping`).slice(0, 120),
        signature: imp.templateSignature ?? templateSignature(imp.analysis.targets),
        headers: imp.analysis.targets.map((t) => t.header),
        entries: mappingEntriesFromConfig(imp.analysis.targets, imp.analysis.sources, config),
        transforms: config.transforms,
      });
      config.appliedMappingTemplateId = savedMapping.id;
    }
    const aliases = config.mappings
      .filter((m) => m.source !== null && (m.status === "manual" || (m.status === "possible" && m.confirmed)))
      .map((m) => {
        const t = imp.analysis!.targets[m.target];
        const s = imp.analysis!.sources[m.source!];
        return { targetKey: headerKey(t.label), sourceKey: headerKey(s.header), targetLabel: t.label, sourceLabel: s.label };
      })
      .filter((a) => a.targetKey && a.sourceKey && a.targetKey !== a.sourceKey);
    await repo.addAliases(aliases);
    if (config.mode === "fill")
      await repo.addLearnedMembers(
        result.rows
          .filter((r) => r.member?.member && (r.member.status === "confirmed" || r.member.status === "manual"))
          .map((r) => ({
            nameKey: personNameKey(r.member!.sourceName),
            memberId: r.member!.member!.id,
            memberName: r.member!.member!.name,
            sourceName: r.member!.sourceName,
          }))
          .filter((x) => x.nameKey),
      );

    await repo.updateImport(id, {
      status: verification.ok ? "completed" : "failed",
      config,
      summary: result.summary,
      stats: statsOf(result.summary),
      outputs,
      verification,
      completed_at: generatedAt,
    });
    await repo.logEvent(id, verification.ok ? "generated" : "failed", {
      ready: result.summary.ready,
      errors: result.summary.withErrors,
      excluded: result.summary.excluded,
      mode: final.mode,
      notes: final.notes,
      verified: verification.ok,
      finalSha256: outputs[0].sha256,
      duplicateConfirmed: dups.length > 0,
      savedMapping: savedMapping?.name ?? null,
    });
    return { ...(await getDetail(id)), notes: final.notes };
  } finally {
    cache.locks.delete(id);
  }
}

export async function downloadOutput(id: string, kind: OutputKind) {
  const imp = await repo.getImport(id);
  const out = imp.outputs.find((o) => o.kind === kind);
  if (!out) throw new HttpError(404, "This file has not been generated.");
  if (imp.filesPurgedAt) throw new HttpError(410, "This file was deleted by the retention policy.");
  if ((kind === "final" || kind === "final_csv") && imp.verification && !imp.verification.ok)
    throw new HttpError(409, "The final file failed verification and cannot be downloaded. Download the validation report for details.");
  const file = await openOutput(id, out.storedName);
  if (!file) throw new HttpError(410, "This file is no longer available.");
  await repo.logEvent(id, "downloaded", { kind, fileName: out.fileName });
  const contentType = kind === "final_csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return { body: file.body, size: file.size, fileName: out.fileName, contentType };
}

// ------------------------------------------------------------------ lifecycle

export async function cancelImport(id: string) {
  const imp = await repo.getImport(id);
  if (imp.status === "completed") throw new HttpError(409, "A completed import cannot be cancelled.");
  await repo.updateImport(id, { status: "cancelled" });
  await repo.logEvent(id, "cancelled");
}

export async function purgeImportFiles(id: string, reason: "user" | "retention") {
  await repo.getImport(id);
  await removeImportFiles(id);
  invalidate(id);
  await repo.updateImport(id, { files_purged_at: new Date() });
  await repo.logEvent(id, "files_purged", { reason });
}

/** Delete files older than the retention period. Runs at most once an hour unless forced. */
export async function runRetention(force = false): Promise<{ purged: number; ran: boolean }> {
  const last = await repo.getMeta<{ at: string }>("retention_last_run");
  if (!force && last && Date.now() - new Date(last.at).getTime() < 3600_000) return { purged: 0, ran: false };
  await repo.setMeta("retention_last_run", { at: new Date().toISOString() });
  const settings = await repo.getSettings();
  const expired = await repo.expiredImports(settings.retentionDays);
  for (const e of expired) {
    try {
      await purgeImportFiles(e.id, "retention");
    } catch (err) {
      console.error("[retention] failed to purge", e.id, err);
    }
  }
  return { purged: expired.length, ran: true };
}

export async function repeatImport(id: string, withSource: boolean) {
  const prev = await repo.getImport(id);
  if (!prev.template) throw new HttpError(400, "The previous import has no template.");
  if (prev.filesPurgedAt) throw new HttpError(410, "The files of the previous import were deleted. Start a new import instead.");
  const next = await repo.createImport(`${prev.name} (repeat)`, prev.id);
  const tpl = await copyUpload(prev.id, prev.template.storedName, next.id, "template", prev.template.ext);
  await writeCache(next.id, "template.json", await loadTemplateParsed(prev.id, prev.template));
  const patch: Parameters<typeof repo.updateImport>[1] = { template: { ...prev.template, storedName: tpl.storedName } };
  if (withSource && prev.source) {
    const src = await copyUpload(prev.id, prev.source.storedName, next.id, "source", prev.source.ext);
    const parsed = parseWorkbook(src.data, prev.source.ext, { template: false });
    await Promise.all(parsed.sheets.map((s, i) => writeCache(next.id, `source-${i}.json`, s)));
    patch.source = { ...prev.source, storedName: src.storedName };
    patch.source_sha256 = prev.source.sha256;
  }
  await repo.updateImport(next.id, patch);
  await repo.logEvent(next.id, "repeat_of", { importId: prev.id, name: prev.name, withSource });
  if (withSource && prev.source && prev.config && prev.analysis) {
    // Same files: carry the whole configuration (mapping, cleaning, corrections) over.
    await analyze(next.id, { mappingTemplateId: `import:${prev.id}` });
    const fresh = await repo.getImport(next.id);
    const config: ImportConfig = { ...prev.config, edits: prev.config.edits, excluded: prev.config.excluded };
    const settings = await repo.getSettings();
    invalidate(next.id);
    const result = await runCached(next.id, fresh, config, settings);
    await repo.updateImport(next.id, { config, summary: result.summary, stats: statsOf(result.summary) });
  }
  return { id: next.id };
}

// ------------------------------------------------------------------ members (fill mode)

export type MemberFilter = "all" | "attention" | "matched" | "not_found" | "skipped";
const MATCHED = new Set(["id", "exact", "remembered", "confirmed", "manual"]);
const ATTENTION = new Set(["suggested", "ambiguous", "not_found"]);

export async function listMembers(id: string, opts: { filter: MemberFilter; q?: string; page: number; size: number }) {
  const imp = await repo.getImport(id);
  if (!imp.analysis || !imp.config || !imp.source) throw new HttpError(400, "Analyze the files first.");
  if (imp.config.mode !== "fill") throw new HttpError(400, "This import does not match rows to a member list.");
  const settings = await repo.getSettings();
  const result = await runCached(id, imp, imp.config, settings);
  const sheet = await loadSheet(id, imp.source);
  const totalCol = imp.analysis.sourceTotalCol;
  const q = opts.q?.trim() ? personNameKey(opts.q) : "";
  const qId = opts.q?.trim() ? idKey(opts.q) : "";
  const list = result.rows.filter((r) => {
    const st = r.member?.status;
    if (!st) return false;
    if (opts.filter === "attention" && !ATTENTION.has(st)) return false;
    if (opts.filter === "matched" && !MATCHED.has(st)) return false;
    if (opts.filter === "not_found" && st !== "not_found") return false;
    if (opts.filter === "skipped" && st !== "skipped") return false;
    if (q || qId) {
      const m = r.member!;
      const hay = [personNameKey(m.sourceName), m.member ? personNameKey(m.member.name) : ""];
      const ids = [m.member?.id ?? "", m.sourceKey].map(idKey);
      if (!hay.some((h) => q && h.includes(q)) && !ids.some((x) => qId && x.startsWith(qId))) return false;
    }
    return true;
  });
  const size = Math.min(Math.max(opts.size, 10), 200);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const page = Math.min(Math.max(1, opts.page), pages);
  const keyK = imp.analysis.targets.findIndex((t) => t.index === imp.config!.fill!.keyTarget);
  const rows = list.slice((page - 1) * size, page * size).map((r) => {
    const src = sheet.rows[imp.source!.headerRow + r.i] ?? [];
    let amount: number | null = totalCol !== null ? numberOf(src[totalCol] ?? null) : null;
    if (amount === null) amount = r.values.reduce<number>((a, v, k) => a + (k !== keyK && typeof v === "number" ? v : 0), 0);
    return { i: r.i, excelRow: imp.source!.headerRow + 1 + r.i, ...r.member!, rowStatus: r.status, amount, issues: r.issues };
  });
  return { rows, total: list.length, page, pages, size, counts: result.summary.members ?? {} };
}

export async function updateMemberMatch(
  id: string,
  body: { action: "set" | "skip" | "reset" | "confirm_suggested"; row?: number; memberId?: string },
) {
  const imp = await repo.getImport(id);
  assertEditable(imp);
  if (!imp.analysis || !imp.config || !imp.source || imp.config.mode !== "fill" || !imp.config.fill)
    throw new HttpError(400, "This import does not match rows to a member list.");
  const settings = await repo.getSettings();
  const before = await runCached(id, imp, imp.config, settings);
  const config: ImportConfig = structuredClone(imp.config);
  const overrides = { ...(config.memberOverrides ?? {}) };
  const rowInfo = (i: number) => {
    const r = before.rows.find((x) => x.i === i);
    if (!r?.member) throw new HttpError(400, "Invalid row.");
    return r;
  };
  if (body.action === "confirm_suggested") {
    let n = 0;
    for (const r of before.rows)
      if (r.member?.status === "suggested" && r.member.member) {
        overrides[String(r.i)] = r.member.member.id;
        n++;
      }
    await repo.logEvent(id, "members_confirmed", { count: n });
  } else {
    const i = Math.floor(Number(body.row));
    const r = rowInfo(i);
    const excelRow = imp.source.headerRow + 1 + i;
    if (body.action === "set") {
      const index = await getMemberIndex(id, imp, imp.config.fill);
      const m = index.byId.get(idKey(String(body.memberId ?? "")))?.[0];
      if (!m) throw new HttpError(400, `Member ID "${body.memberId}" is not in the template's member list.`);
      overrides[String(i)] = m.id;
      await repo.logEvent(id, "member_matched", { row: excelRow, sourceName: r.member!.sourceName, memberId: m.id, memberName: m.name });
    } else if (body.action === "skip") {
      overrides[String(i)] = null;
      await repo.logEvent(id, "member_skipped", { row: excelRow, sourceName: r.member!.sourceName });
    } else if (body.action === "reset") {
      delete overrides[String(i)];
      await repo.logEvent(id, "member_reset", { row: excelRow, sourceName: r.member!.sourceName });
    } else throw new HttpError(400, "Unknown action.");
  }
  config.memberOverrides = overrides;
  const result = await runCached(id, imp, config, settings);
  await repo.updateImport(id, { config, summary: result.summary, stats: statsOf(result.summary) });
  return { summary: result.summary };
}

export async function searchMembers(id: string, q: string) {
  const imp = await repo.getImport(id);
  if (!imp.config?.fill || !imp.template) throw new HttpError(400, "This import does not use a member list.");
  const index = await getMemberIndex(id, imp, imp.config.fill);
  const key = personNameKey(q);
  const qId = idKey(q);
  if (!key && !qId) return { members: [] };
  const out = index.members
    .filter((m) => (qId && m.idKey.startsWith(qId)) || (key && m.key.includes(key)))
    .slice(0, 25)
    .map((m) => ({ id: m.id, name: m.name }));
  return { members: out };
}
