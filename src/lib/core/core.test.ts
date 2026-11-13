import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type ImportConfig, type RawCell } from "../types";
import { headerKey, parseHeaderHints, colLetter } from "./text";
import {
  detectDateOrder,
  excelFormatToPattern,
  excelSerialToDate,
  formatDate,
  identifierText,
  parseDate,
  parseNumber,
  parsePhone,
  formatPhone,
  patternFromExample,
} from "./values";
import { buildSources, buildTargets, suggestMappings, detectHeaderRow, DEFAULT_TRANSFORMS, type SheetData } from "./analyze";
import { runPipeline, toApiRow } from "./pipeline";
import { buildMemberIndex } from "./members";

const S = DEFAULT_SETTINGS;
const PS = { countryCode: "251", nationalLength: 9 };

describe("text helpers", () => {
  it("normalizes header variants to the same key", () => {
    expect(headerKey("Member No.")).toBe(headerKey("member_number"));
    expect(headerKey("MemberID")).toBe(headerKey("Member ID"));
    expect(headerKey("DOB")).toBe(headerKey("Date of Birth"));
    expect(headerKey("Phone Number*")).toBe(headerKey("phone number"));
  });
  it("reads hints from headers", () => {
    expect(parseHeaderHints("Gender (M/F)*")).toEqual({ required: true, dateFormat: undefined, allowedValues: ["M", "F"] });
    expect(parseHeaderHints("Date of Birth (DD/MM/YYYY)").dateFormat).toBe("DD/MM/YYYY");
  });
  it("column letters", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(27)).toBe("AB");
  });
});

describe("dates", () => {
  it("reads Excel serials without time zone drift", () => {
    expect(excelSerialToDate(1)).toEqual({ y: 1900, m: 1, d: 1 });
    expect(excelSerialToDate(61)).toEqual({ y: 1900, m: 3, d: 1 });
    expect(excelSerialToDate(32874)).toEqual({ y: 1990, m: 1, d: 1 });
    expect(excelSerialToDate(45658)).toEqual({ y: 2025, m: 1, d: 1 });
  });
  it("parses common formats", () => {
    expect(parseDate("1990-04-03", "DMY")).toMatchObject({ ok: true, date: { y: 1990, m: 4, d: 3 } });
    expect(parseDate("03/04/1990", "DMY")).toMatchObject({ ok: true, date: { y: 1990, m: 4, d: 3 } });
    expect(parseDate("03/04/1990", "MDY")).toMatchObject({ ok: true, date: { y: 1990, m: 3, d: 4 } });
    expect(parseDate("3-Apr-1990", "DMY")).toMatchObject({ ok: true, date: { y: 1990, m: 4, d: 3 } });
    expect(parseDate("April 3, 1990", "DMY")).toMatchObject({ ok: true, date: { y: 1990, m: 4, d: 3 } });
    expect(parseDate("1990-04-03 00:00:00", "DMY")).toMatchObject({ ok: true });
  });
  it("rejects impossible dates instead of guessing", () => {
    expect(parseDate("31/02/1990", "DMY").ok).toBe(false);
    expect(parseDate("13/25/1990", "DMY").ok).toBe(false);
    expect(parseDate("25/12/1990", "MDY").ok).toBe(false); // not silently swapped
    expect(parseDate("not a date", "DMY").ok).toBe(false);
  });
  it("detects day/month order from evidence", () => {
    expect(detectDateOrder(["25/12/1990", "03/04/1991"]).order).toBe("DMY");
    expect(detectDateOrder(["12/25/1990", "03/04/1991"]).order).toBe("MDY");
    expect(detectDateOrder(["03/04/1991"]).ambiguous).toBe(true);
  });
  it("formats and converts Excel formats", () => {
    expect(formatDate({ y: 1990, m: 4, d: 3 }, "DD/MM/YYYY")).toBe("03/04/1990");
    expect(formatDate({ y: 1990, m: 4, d: 3 }, "YYYY-MM-DD")).toBe("1990-04-03");
    expect(formatDate({ y: 1990, m: 4, d: 3 }, "DD-MMM-YYYY")).toBe("03-Apr-1990");
    expect(excelFormatToPattern("dd/mm/yyyy;@")).toBe("DD/MM/YYYY");
    expect(excelFormatToPattern("m/d/yy")).toBe("M/D/YY");
    expect(excelFormatToPattern("#,##0.00")).toBeUndefined();
    expect(patternFromExample("31/12/1990")).toBe("DD/MM/YYYY");
    expect(patternFromExample("1990-12-31")).toBe("YYYY-MM-DD");
  });
});

describe("numbers", () => {
  it("never changes the amount", () => {
    expect(parseNumber({ n: 1500.5, w: "1,500.50" }, false)).toEqual({ ok: true, value: 1500.5, converted: false });
    expect(parseNumber("1,500.00", true)).toEqual({ ok: true, value: 1500, converted: true });
    expect(parseNumber("ETB 2,000", true)).toMatchObject({ ok: true, value: 2000 });
    expect(parseNumber("(250.75)", true)).toMatchObject({ ok: true, value: -250.75 });
    expect(parseNumber("1234.5678", true)).toMatchObject({ ok: true, value: 1234.5678 });
  });
  it("rejects ambiguous or non-numbers", () => {
    expect(parseNumber("1.234,56", true).ok).toBe(false);
    expect(parseNumber("-", true).ok).toBe(false);
    expect(parseNumber("N/A", true).ok).toBe(false);
    expect(parseNumber("12abc", true).ok).toBe(false);
  });
  it("flags text numbers when conversion is off", () => {
    expect(parseNumber("1,500", false)).toMatchObject({ ok: false });
    expect(parseNumber("1500", false)).toMatchObject({ ok: true, value: 1500 });
  });
});

describe("identifiers and phones", () => {
  it("keeps leading zeros and expands scientific notation", () => {
    expect(identifierText("000123")).toBe("000123");
    expect(identifierText({ n: 123, w: "000123" })).toBe("000123");
    expect(identifierText({ n: 251912345678, w: "2.51912E+11" })).toBe("251912345678");
  });
  it("parses phones and restores lost zeros", () => {
    const a = parsePhone("0912 345 678", PS);
    expect(a.ok && formatPhone(a, "local", PS)).toBe("0912345678");
    const b = parsePhone("912345678", PS);
    expect(b.ok && b.lostZero).toBe(true);
    expect(b.ok && formatPhone(b, "local", PS)).toBe("0912345678");
    const c = parsePhone("+251-912-345-678", PS);
    expect(c.ok && formatPhone(c, "local", PS)).toBe("0912345678");
    expect(c.ok && formatPhone(c, "international", PS)).toBe("+251912345678");
    expect(parsePhone("12345", PS).ok).toBe(false);
    expect(parsePhone("0912345678 / 0911111111", PS).ok).toBe(false);
  });
});

// ------------------------------------------------------------- end-to-end core

function sheet(rows: RawCell[][], name = "Sheet1"): SheetData {
  return { name, rows };
}

describe("matching", () => {
  const template = sheet([
    ["Member ID*", "Full Name*", "Phone Number", "Gender", "Date of Birth (DD/MM/YYYY)", "Address", "Savings Balance", "Loan Balance"],
  ]);
  const source = sheet([
    ["Membership No", "Member Name", "Mobile", "Sex", "DOB", "Share Balance", "Savings", "Remarks"],
    ["001", "Abebe Kebede", "0912345678", "M", "03/04/1990", "500", "1,200.50", "ok"],
    ["002", "Sara Tesfaye", "0911111111", "F", "25/12/1985", "300", "800", ""],
  ]);
  const { targets } = buildTargets(template, 1, { lists: {}, numFmts: {} }, S);
  const { sources } = buildSources(source, 1, S);
  const mappings = suggestMappings(targets, sources, source, 1, S, []);
  const by = (label: string) => mappings[targets.findIndex((t) => t.label.startsWith(label))];

  it("matches known synonyms automatically", () => {
    expect(by("Member ID")).toMatchObject({ source: 0, status: "synonym", confirmed: true });
    expect(by("Full Name")).toMatchObject({ source: 1, status: "synonym" });
    expect(by("Phone Number")).toMatchObject({ source: 2, status: "synonym" });
    expect(by("Date of Birth")).toMatchObject({ source: 4, status: "exact" }); // DOB is the abbreviation
    expect(by("Savings Balance")).toMatchObject({ source: 6, status: "synonym" });
  });
  it("asks for confirmation on uncertain matches", () => {
    expect(by("Gender")).toMatchObject({ source: 3, status: "possible", confirmed: false });
  });
  it("does not map different financial columns because the names look alike", () => {
    // "Share Balance" must never be auto-mapped to "Loan Balance".
    const loan = by("Loan Balance");
    expect(loan.confirmed && loan.source === 5).toBe(false);
  });
  it("reports missing columns", () => {
    expect(by("Address")).toMatchObject({ source: null, status: "missing" });
  });
  it("reads required markers and types", () => {
    expect(by("Member ID").rule).toMatchObject({ type: "identifier", required: true, unique: true });
    expect(by("Date of Birth").rule).toMatchObject({ type: "date", dateFormat: "DD/MM/YYYY" });
  });
});

describe("pipeline", () => {
  const template = sheet([["Member ID*", "Full Name*", "Phone Number", "Gender (M/F)", "Date of Birth (DD/MM/YYYY)", "Savings Balance"]]);
  const source = sheet([
    ["SACCO MEMBERS LIST"],
    [],
    ["Member No", "Name", "Mobile", "Gender", "Birth Date", "Savings"],
    ["000123", "  abebe   kebede ", { n: 912345678, w: "912345678" }, "male", { n: 32874, w: "01/01/1990", d: "1990-01-01" }, "1,500.00"],
    ["000124", "Sara Tesfaye", "+251 911 111 111", "F", "25/12/1985", { n: 2000.257, w: "2000.257" }],
    ["000123", "Duplicate Person", "0922222222", "X", "31/02/1990", "-50"],
    [null, null, null, null, null, null],
    ["000125", "", "12345", "f", "2099-01-01", "abc"],
  ]);
  const headerRow = detectHeaderRow(source.rows);
  const { targets } = buildTargets(template, 1, { lists: {}, numFmts: {} }, S);
  const { sources } = buildSources(source, headerRow, S);
  const mappings = suggestMappings(targets, sources, source, headerRow, S, []).map((m) => ({ ...m, confirmed: true }));
  const config: ImportConfig = { mappings, transforms: { ...DEFAULT_TRANSFORMS }, edits: {}, excluded: [], appliedMappingTemplateId: null, mode: "rows", fill: null, memberOverrides: {}, approvals: { month: false } };
  const res = runPipeline({ targets, sources, sheet: source, headerRow, config, settings: S, today: new Date(2026, 10, 13) });

  it("detects the header row below a title", () => {
    expect(headerRow).toBe(3);
  });
  it("skips blank rows and counts records", () => {
    expect(res.summary.totalRows).toBe(4);
    expect(res.summary.blankRowsSkipped).toBe(1);
  });
  it("transforms safely and visibly", () => {
    const r0 = res.rows[0];
    expect(r0.values).toEqual(["000123", "abebe kebede", "0912345678", "M", { date: "1990-01-01" }, 1500]);
    expect(r0.changed).toMatchObject({ 1: "trim", 2: "phone", 3: "code", 5: "number" });
  });
  it("keeps amounts exactly and warns about extra decimals", () => {
    const r1 = res.rows[1];
    expect(r1.values[5]).toBe(2000.257);
    expect(r1.issues.some((i) => i.code === "decimals" && i.level === "warning")).toBe(true);
    expect(r1.values[4]).toEqual({ date: "1985-12-25" });
  });
  it("flags duplicates, invalid values and negatives", () => {
    const r2 = res.rows[2];
    const codes = r2.issues.map((i) => i.code);
    expect(codes).toContain("duplicate");
    expect(codes).toContain("gender");
    expect(codes).toContain("date");
    expect(codes).toContain("negative");
    expect(res.rows[0].issues.map((i) => i.code)).toContain("duplicate");
  });
  it("flags missing mandatory, bad phones, future birth dates and non-numbers", () => {
    const r3 = res.rows[3];
    const codes = r3.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["required", "phone", "dob_future", "number"]));
    expect(r3.values[3]).toBe("F");
  });
  it("summarizes and blocks nothing when there are ready rows", () => {
    expect(res.summary.ready).toBe(1);
    expect(res.summary.withErrors).toBe(3);
    expect(res.summary.duplicates).toBe(2);
    expect(res.summary.missingMandatory).toBe(1);
    expect(res.summary.blocking).toEqual([]);
  });
  it("turning transformations off restores original values and reports them", () => {
    const off = runPipeline({
      targets, sources, sheet: source, headerRow, settings: S, today: new Date(2026, 10, 13),
      config: { ...config, transforms: { trim: false, dates: false, numbers: false, phones: false, codes: false, nameCase: false, emailCase: false } },
    });
    const r0 = off.rows[0];
    expect(r0.values[1]).toBe("  abebe   kebede ");
    expect(r0.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["phone_zero", "gender", "number_text"]));
  });
  it("applies user edits and exclusions", () => {
    const edited = runPipeline({
      targets, sources, sheet: source, headerRow, settings: S, today: new Date(2026, 10, 13),
      config: { ...config, edits: { "4": { "1": "Kebede Alemu", "4": "01/02/1995", "5": "100" } }, excluded: [2] },
    });
    const r = edited.rows.find((x) => x.i === 4)!;
    expect(r.values[1]).toBe("Kebede Alemu");
    expect(r.values[4]).toEqual({ date: "1995-02-01" });
    expect(r.edited).toMatchObject({ 1: true, 4: true, 5: true });
    expect(edited.rows.find((x) => x.i === 2)!.status).toBe("excluded");
  });
});

describe("changes to the template's own values", () => {
  const n = (v: number) => ({ n: v, w: String(v) });
  const template = sheet([
    ["Member ID", "Full Name", "Savings", "Loan Period"],
    ["M001", "Abebe Kebede", n(0), n(90)],
    ["M002", "Sara Tesfaye", n(0), n(90)],
    ["M003", "Hana Girma", n(0), n(90)],
    ["M004", "Dawit Alemu", n(0), n(90)],
  ]);
  const source = sheet([
    ["Name", "Savings"],
    ["ABEBE KEBEDE", n(500)], // other spelling, savings replace the template's 0
    ["Sara Tesfaye", n(0)], // same value as the template: not a change
    ["Hana Girma", null], // nothing in the original file: the template's 0 is kept
    ["Unknown Person", n(70)], // not a member: error, never changes the template
  ]);
  const { targets } = buildTargets(template, 1, { lists: {}, numFmts: {} }, S);
  const { sources } = buildSources(source, 1, S);
  const mappings = suggestMappings(targets, sources, source, 1, S, []).map((m) =>
    m.target === 2 ? { ...m, source: 1, status: "manual" as const, confirmed: true } : { ...m, source: null, status: "missing" as const, confirmed: true },
  );
  const config: ImportConfig = {
    mappings,
    transforms: { ...DEFAULT_TRANSFORMS },
    edits: {},
    excluded: [],
    appliedMappingTemplateId: null,
    mode: "fill",
    fill: { keyTarget: 0, nameTarget: 1, sourceKeyCol: null, sourceNameCol: 0, includeAll: false },
    memberOverrides: {},
    approvals: { month: false },
  };
  const res = runPipeline({
    targets, sources, sheet: source, headerRow: 1, config, settings: S, today: new Date(2026, 10, 13),
    template: { sheet: template, headerRow: 1 }, memberIndex: buildMemberIndex(template, 1, 0, 1),
  });

  it("marks each cell as replaced, kept or taken from the member list", () => {
    expect(res.rows[0].values).toEqual(["M001", "Abebe Kebede", 500, 90]);
    expect(res.rows[0].tpl).toEqual(["M001", "Abebe Kebede", 0, 90]);
    expect(res.rows[0].tplExcelRow).toBe(2);
    expect(res.rows[0].tplChange).toEqual({ 1: "member", 2: "replaced", 3: "kept" });
    expect(res.rows[1].tplChange).toEqual({ 3: "kept" }); // savings 0 → 0 is not a change
    expect(res.rows[2].tplChange).toEqual({ 2: "kept", 3: "kept" });
    expect(res.rows[3].tpl).toBeNull();
    expect(res.rows[3].tplChange).toBeNull();
  });
  it("summarizes the template rows and values, counting only rows written to the final file", () => {
    const t = res.summary.template!;
    expect(t).toMatchObject({ mode: "fill", templateRows: 4, rowsUpdated: 3, rowsUnchanged: 0, rowsRemoved: 1 });
    expect(t.removedSamples[0]).toEqual({ excelRow: 5, text: "M004 · Dawit Alemu · 0 · 90" });
    const by = Object.fromEntries(t.changes.map((c) => [c.key, c]));
    expect(t.changes.map((c) => c.key)).toEqual(["replaced", "member", "kept"]);
    expect(by.replaced.cells).toBe(1);
    expect(by.replaced.samples[0]).toEqual({ row: 2, target: 2, template: "0", original: "500", after: "500" });
    expect(by.member.samples[0]).toMatchObject({ template: "Abebe Kebede", original: "ABEBE KEBEDE", after: "Abebe Kebede" });
    expect(by.kept.cells).toBe(4);
    expect(by.kept.columns).toEqual(expect.arrayContaining([{ target: 3, count: 3 }, { target: 2, count: 1 }]));
  });
  it("counts template members that stay unchanged when every member is included", () => {
    const all = runPipeline({
      targets, sources, sheet: source, headerRow: 1, settings: S, today: new Date(2026, 10, 13),
      config: { ...config, fill: { ...config.fill!, includeAll: true } },
      template: { sheet: template, headerRow: 1 }, memberIndex: buildMemberIndex(template, 1, 0, 1),
    });
    expect(all.summary.template).toMatchObject({ rowsUpdated: 3, rowsUnchanged: 1, rowsRemoved: 0 });
  });
  const run = (patch: Partial<ImportConfig>) =>
    runPipeline({
      targets, sources, sheet: source, headerRow: 1, settings: S, today: new Date(2026, 10, 13),
      config: { ...config, ...patch },
      template: { sheet: template, headerRow: 1 }, memberIndex: buildMemberIndex(template, 1, 0, 1),
    });
  const savingsFromTemplate = config.mappings.map((m) => (m.target === 2 ? { ...m, useTemplate: true } : m));

  it("takes a whole column from the template when you choose it", () => {
    const r = run({ mappings: savingsFromTemplate });
    expect(r.rows.map((x) => x.values[2])).toEqual([0, 0, 0, 70]); // the unmatched row keeps its own value (and its error)
    expect(r.rows[0].tplChange?.[2]).toBe("chosen");
    expect(r.rows[2].tplChange?.[2]).toBe("kept"); // empty in the original anyway
    const chosen = r.summary.template!.changes.find((c) => c.key === "chosen")!;
    expect(chosen.cells).toBe(2);
    expect(chosen.samples[0]).toMatchObject({ template: "0", original: "500", after: "0" });
    const api = toApiRow(r.rows[0], targets, { ...config, mappings: savingsFromTemplate }, source, 1);
    expect(api.valueFrom).toEqual(["template", "template", "template", "template"]);
  });
  it("lets you choose the template or the original file for a single cell", () => {
    const one = run({ cellSources: { "0": { "2": "template" } } });
    expect(one.rows[0].values[2]).toBe(0);
    expect(one.rows[0].tplChange?.[2]).toBe("chosen");
    expect(toApiRow(one.rows[0], targets, { ...config, cellSources: { "0": { "2": "template" } } }, source, 1).sourceChoice).toEqual([null, null, "template", null]);
    // the column comes from the template, but this one cell from the original file
    const back = run({ mappings: savingsFromTemplate, cellSources: { "0": { "2": "original" } } });
    expect(back.rows[0].values[2]).toBe(500);
    expect(back.rows[0].tplChange?.[2]).toBe("replaced");
    expect(back.rows[1].tplChange?.[2]).toBe("chosen");
  });
  it("a value you typed wins over both files", () => {
    const r = run({ mappings: savingsFromTemplate, cellSources: { "0": { "2": "template" } }, edits: { "0": { "2": "750" } } });
    expect(r.rows[0].values[2]).toBe(750);
  });
  it("money of cells taken from the template is reported as not imported", () => {
    const r = run({ mappings: savingsFromTemplate });
    const rec = r.summary.reconciliation!;
    expect(rec).not.toBeNull();
    expect(rec.columns.find((c) => c.source === 1)!.importedTotal).toBe(0);
    expect(rec.notImportedByChoice).toBe(500);
  });

  it("reports the template's own rows that a normal import leaves out", () => {
    const tpl = sheet([["Member ID", "Full Name"], ["000001", "Example Member"]]);
    const src = sheet([["Member ID", "Full Name"], ["000777", "Real Member"]]);
    const t = buildTargets(tpl, 1, { lists: {}, numFmts: {} }, S).targets;
    const s = buildSources(src, 1, S).sources;
    const maps = suggestMappings(t, s, src, 1, S, []).map((m) => ({ ...m, confirmed: true }));
    const r = runPipeline({
      targets: t, sources: s, sheet: src, headerRow: 1, settings: S, template: { sheet: tpl, headerRow: 1 },
      config: { ...config, mappings: maps, mode: "rows", fill: null },
    });
    expect(r.summary.template).toMatchObject({ mode: "rows", templateRows: 1, rowsRemoved: 1, changes: [] });
    expect(r.summary.template!.removedSamples).toEqual([{ excelRow: 2, text: "000001 · Example Member" }]);
    expect(r.rows[0].tplChange).toBeNull();
  });
});

describe("decimal places", () => {
  it("ignores floating-point noise but catches real extra decimals", async () => {
    const { decimalPlaces } = await import("./values");
    expect(decimalPlaces(4973.17 * 10)).toBe(1); // 49731.700000000004
    expect(decimalPlaces(0.1 + 0.2)).toBe(1);
    expect(decimalPlaces(1500)).toBe(0);
    expect(decimalPlaces(1234.5678)).toBe(4);
    expect(decimalPlaces(2000.257)).toBe(3);
  });
});

describe("template headers known only by a related name", () => {
  it("offers Sex (template) ← Gender (original) as a possible match, never automatic", () => {
    const template = sheet([["MemberNo", "Sex", "Age"]]);
    const source = sheet([["Member Number", "Gender", "Age"], ["001", "M", { n: 34, w: "34" }]]);
    const { targets } = buildTargets(template, 1, { lists: {}, numFmts: {} }, S);
    const { sources } = buildSources(source, 1, S);
    const m = suggestMappings(targets, sources, source, 1, S, []);
    expect(targets[1]).toMatchObject({ concept: "gender", conceptWeak: true, inferredType: "gender" });
    expect(m[1]).toMatchObject({ source: 1, status: "possible", confirmed: false });
    expect(targets[2].inferredType).not.toBe("date"); // "Age" is not a date of birth
  });
});
