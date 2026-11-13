import * as XLSX from "xlsx";
import type { RawCell } from "../types";
import type { SheetData, TemplateMeta } from "../core/analyze";
import { HttpError } from "./storage";

export interface ParsedWorkbook {
  sheets: SheetData[];
  /** Number formats of the first rows (template only), per sheet. */
  formats: Record<string, (string | null)[][]>;
  /** Dropdown lists found in the workbook (xlsx templates only), per sheet. */
  lists: Record<string, ListValidation[]>;
}

export interface ListValidation {
  ranges: { c1: number; r1: number; c2: number; r2: number }[]; // 0-based columns, 1-based rows
  values: string[];
}

const FORMAT_ROWS = 40;

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

function isoFromParts(y: number, m: number, d: number) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function convertCell(c: XLSX.CellObject | undefined, date1904: boolean): RawCell {
  if (!c) return null;
  switch (c.t) {
    case "s":
      return c.v === undefined || c.v === null ? null : String(c.v);
    case "n": {
      if (typeof c.v !== "number") return null;
      const w = c.w ?? String(c.v);
      if (c.z && XLSX.SSF.is_date(c.z as string)) {
        const p = XLSX.SSF.parse_date_code(c.v, { date1904 });
        if (p && p.y >= 1800) return { n: c.v, w, d: isoFromParts(p.y, p.m, p.d) };
      }
      return { n: c.v, w };
    }
    case "b":
      return c.v ? "TRUE" : "FALSE";
    case "e":
      return c.w ?? "#ERROR!";
    case "d": {
      const dt = c.v instanceof Date ? c.v : new Date(String(c.v));
      if (Number.isNaN(dt.getTime())) return c.w ?? null;
      return { n: 0, w: c.w ?? dt.toISOString().slice(0, 10), d: isoFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()) };
    }
    default:
      return null;
  }
}

export function parseWorkbook(buf: Buffer, ext: "xlsx" | "xls" | "csv", opts: { template: boolean }): ParsedWorkbook {
  let wb: XLSX.WorkBook;
  try {
    if (ext === "csv") {
      wb = XLSX.read(decodeText(buf), { type: "string", raw: true, dense: true });
    } else {
      wb = XLSX.read(buf, {
        type: "buffer",
        dense: true,
        cellDates: false,
        cellNF: true,
        cellText: true,
        cellFormula: false,
        cellHTML: false,
        sheetStubs: opts.template,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|encrypt/i.test(msg)) throw new HttpError(400, "This file is password-protected. Remove the password in Excel and upload it again.");
    throw new HttpError(400, `The file could not be read as a spreadsheet (${msg}).`);
  }
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const sheets: SheetData[] = [];
  const formats: ParsedWorkbook["formats"] = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const data = (ws?.["!data"] ?? []) as (XLSX.CellObject[] | undefined)[];
    const rows: RawCell[][] = new Array(data.length);
    const fmts: (string | null)[][] = [];
    for (let r = 0; r < data.length; r++) {
      const src = data[r];
      if (!src) {
        rows[r] = [];
        continue;
      }
      const row: RawCell[] = new Array(src.length);
      let last = -1;
      for (let c = 0; c < src.length; c++) {
        const v = convertCell(src[c], date1904);
        row[c] = v;
        if (v !== null) last = c;
      }
      row.length = last + 1;
      rows[r] = row;
      if (opts.template && r < FORMAT_ROWS) fmts[r] = src.map((cell) => (cell?.z && cell.z !== "General" ? String(cell.z) : null));
    }
    // fill sparse holes with null
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] ?? (rows[r] = []);
      for (let c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = null;
    }
    let end = rows.length;
    while (end > 0 && rows[end - 1].length === 0) end--;
    rows.length = end;
    // Cells merged across columns near the top (titles over sub-titles), for headers on two rows.
    const merges = ((ws?.["!merges"] ?? []) as XLSX.Range[])
      .filter((m) => m.s.r < 50 && m.e.c > m.s.c)
      .map((m) => ({ r: m.s.r, r2: m.e.r, c1: m.s.c, c2: m.e.c }));
    sheets.push(merges.length ? { name, rows, merges } : { name, rows });
    if (opts.template) formats[name] = fmts;
  }
  const lists = opts.template && ext === "xlsx" ? safeExtractLists(buf, wb, sheets) : {};
  return { sheets, formats, lists };
}

// ----------------------------------------------------------------------------- xlsx XML helpers

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2]);
  return out;
}

type Zip = ReturnType<typeof XLSX.CFB.read>;

function zipText(zip: Zip, p: string): string | null {
  const e = XLSX.CFB.find(zip, "/" + p.replace(/^\//, ""));
  if (!e || !e.content) return null;
  return Buffer.from(e.content as Uint8Array).toString("utf8");
}

/** Map sheet name → path of its XML part inside the xlsx zip. */
function sheetPaths(zip: Zip): Map<string, string> {
  const out = new Map<string, string>();
  const wbXml = zipText(zip, "xl/workbook.xml");
  const rels = zipText(zip, "xl/_rels/workbook.xml.rels");
  if (!wbXml || !rels) return out;
  const relTargets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) relTargets.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : "xl/" + a.Target.replace(/^\.\//, ""));
  }
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a["r:id"] ?? Object.entries(a).find(([k]) => k.endsWith(":id"))?.[1];
    const target = rid ? relTargets.get(rid) : undefined;
    if (a.name && target) out.set(a.name, target);
  }
  return out;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSqref(sqref: string): ListValidation["ranges"] {
  const out: ListValidation["ranges"] = [];
  for (const part of sqref.trim().split(/\s+/)) {
    const m = part.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
    if (!m) continue;
    const c1 = colIndex(m[1]);
    const r1 = Number(m[2]);
    const c2 = m[3] ? colIndex(m[3]) : c1;
    const r2 = m[4] ? Number(m[4]) : r1;
    out.push({ c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2) });
  }
  return out;
}

function resolveListFormula(formula: string, currentSheet: string, wb: XLSX.WorkBook, sheets: SheetData[], depth = 0): string[] {
  const f = unescapeXml(formula).trim().replace(/^=/, "");
  if (f.startsWith('"') && f.endsWith('"')) {
    return f.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
  }
  const ref = f.match(/^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
  if (ref) {
    const sheet = sheets.find((s) => s.name === (ref[1] ?? currentSheet));
    if (!sheet) return [];
    const c1 = colIndex(ref[2]);
    const r1 = Number(ref[3]);
    const c2 = ref[4] ? colIndex(ref[4]) : c1;
    const r2 = ref[5] ? Number(ref[5]) : r1;
    const values: string[] = [];
    for (let r = r1; r <= Math.min(r2, r1 + 500); r++) {
      for (let c = c1; c <= c2; c++) {
        const cell = sheet.rows[r - 1]?.[c] ?? null;
        const t = cell === null ? "" : typeof cell === "string" ? cell.trim() : cell.w;
        if (t) values.push(t);
      }
    }
    return values;
  }
  if (depth < 2 && /^[A-Za-z_][\w.]*$/.test(f)) {
    const name = wb.Workbook?.Names?.find((n) => n.Name === f);
    if (name?.Ref) return resolveListFormula(name.Ref, currentSheet, wb, sheets, depth + 1);
  }
  return [];
}

function safeExtractLists(buf: Buffer, wb: XLSX.WorkBook, sheets: SheetData[]): ParsedWorkbook["lists"] {
  try {
    const zip = XLSX.CFB.read(buf, { type: "buffer" });
    const out: ParsedWorkbook["lists"] = {};
    for (const [sheetName, p] of sheetPaths(zip)) {
      const xml = zipText(zip, p);
      if (!xml) continue;
      const found: ListValidation[] = [];
      for (const m of xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
        const a = attrs(m[1]);
        if (a.type !== "list" || !a.sqref) continue;
        const f = m[2].match(/<formula1>([\s\S]*?)<\/formula1>/)?.[1];
        if (!f) continue;
        const values = resolveListFormula(f, sheetName, wb, sheets);
        if (values.length) found.push({ ranges: parseSqref(a.sqref), values: [...new Set(values)].slice(0, 200) });
      }
      // Excel 2010+ extension lists (used when the list lives on another sheet)
      for (const m of xml.matchAll(/<x14:dataValidation\b([^>]*)>([\s\S]*?)<\/x14:dataValidation>/g)) {
        const a = attrs(m[1]);
        if (a.type !== "list") continue;
        const f = m[2].match(/<x14:formula1>\s*<xm:f>([\s\S]*?)<\/xm:f>/)?.[1];
        const sq = m[2].match(/<xm:sqref>([\s\S]*?)<\/xm:sqref>/)?.[1];
        if (!f || !sq) continue;
        const values = resolveListFormula(f, sheetName, wb, sheets);
        if (values.length) found.push({ ranges: parseSqref(sq), values: [...new Set(values)].slice(0, 200) });
      }
      if (found.length) out[sheetName] = found;
    }
    return out;
  } catch (e) {
    console.warn("[excel-read] could not read dropdown lists:", e);
    return {};
  }
}

/** Template metadata (dropdown lists, cell formats) for a chosen sheet + header row. */
export function templateMeta(parsed: Pick<ParsedWorkbook, "formats" | "lists">, sheetName: string, headerRow: number): TemplateMeta {
  const lists: TemplateMeta["lists"] = {};
  for (const v of parsed.lists[sheetName] ?? []) {
    for (const r of v.ranges) {
      if (r.r2 <= headerRow) continue; // validation must cover data rows
      for (let c = r.c1; c <= r.c2 && c - r.c1 < 500; c++) if (!lists[c]) lists[c] = v.values;
    }
  }
  const numFmts: TemplateMeta["numFmts"] = {};
  const row = parsed.formats[sheetName]?.[headerRow]; // 0-based index headerRow = first row below the header
  if (row) row.forEach((f, c) => {
    if (f) numFmts[c] = f;
  });
  return { lists, numFmts };
}

/**
 * Limit data-validation ranges on a sheet to `maxRow`. Whole-column dropdowns (A2:A1048576) would
 * otherwise make the Excel writer expand millions of cells in memory.
 */
export function clampValidations(buf: Buffer, sheetName: string, maxRow: number): Buffer {
  const zip = XLSX.CFB.read(buf, { type: "buffer" });
  const p = sheetPaths(zip).get(sheetName);
  if (!p) return buf;
  const entry = XLSX.CFB.find(zip, "/" + p);
  if (!entry?.content) return buf;
  const xml = Buffer.from(entry.content as Uint8Array).toString("utf8");
  const clampRef = (sqref: string) =>
    sqref
      .trim()
      .split(/\s+/)
      .map((part) => {
        const m = part.match(/^(\$?[A-Z]+)(\$?)(\d+)(?::(\$?[A-Z]+)(\$?)(\d+))?$/i);
        if (!m || !m[4]) return part;
        const r1 = Number(m[3]);
        const r2 = Number(m[6]);
        if (r2 <= maxRow) return part;
        return `${m[1]}${m[2]}${r1}:${m[4]}${m[5]}${Math.max(r1, maxRow)}`;
      })
      .join(" ");
  let changed = false;
  let next = xml.replace(/(<dataValidation\b[^>]*\bsqref=")([^"]*)(")/g, (_m, a: string, ref: string, b: string) => {
    const r = clampRef(ref);
    if (r !== ref) changed = true;
    return a + r + b;
  });
  next = next.replace(/(<xm:sqref>)([^<]*)(<\/xm:sqref>)/g, (_m, a: string, ref: string, b: string) => {
    const r = clampRef(ref);
    if (r !== ref) changed = true;
    return a + r + b;
  });
  if (!changed) return buf;
  entry.content = Buffer.from(next, "utf8");
  (entry as { size: number }).size = (entry.content as Buffer).length;
  return Buffer.from(XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" }) as Uint8Array);
}

/** Read back a generated file for verification. */
export function readForVerification(buf: Buffer): XLSX.WorkBook {
  return XLSX.read(buf, { type: "buffer", dense: true, cellNF: true, cellText: true, cellDates: false });
}

export { XLSX };
