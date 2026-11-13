import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DEFAULT_SETTINGS, type ImportConfig, type RawCell, type UploadedFile } from "../types";
import { buildSources, buildTargets, suggestMappings, DEFAULT_TRANSFORMS, type SheetData } from "../core/analyze";
import { runPipeline } from "../core/pipeline";
import { buildMemberIndex } from "../core/members";
import { verifyFinal, writeFinalXlsx, writeInvalidXlsx, writeMappingXlsx, writeReportXlsx, type OutputContext } from "./excel-write";
import type { Lang } from "../i18n";

const S = DEFAULT_SETTINGS;
const sheet = (rows: RawCell[][]): SheetData => ({ name: "Sheet1", rows }) as SheetData;
const n = (v: number) => ({ n: v, w: String(v) });

// A template that lists its members, and an original file with one member that is not in the list.
const template = sheet([
  ["Member ID", "Full Name", "Savings"],
  ["M001", "Abebe Kebede", n(0)],
  ["M002", "Sara Tesfaye", n(0)],
]);
const source = sheet([
  ["Name", "Savings"],
  ["Abebe Kebede", n(500)],
  ["Unknown Person", n(70)],
]);
const { targets } = buildTargets(template, 1, { lists: {}, numFmts: {} }, S);
const { sources } = buildSources(source, 1, S);
const config: ImportConfig = {
  mappings: suggestMappings(targets, sources, source, 1, S, []).map((m) =>
    m.target === 2 ? { ...m, source: 1, status: "manual" as const, confirmed: true } : { ...m, source: null, status: "missing" as const, confirmed: true },
  ),
  transforms: { ...DEFAULT_TRANSFORMS },
  edits: {},
  excluded: [],
  appliedMappingTemplateId: null,
  mode: "fill",
  fill: { keyTarget: 0, nameTarget: 1, sourceKeyCol: null, sourceNameCol: 0, includeAll: false },
  memberOverrides: {},
  approvals: { month: false },
};
const result = runPipeline({
  targets, sources, sheet: source, headerRow: 1, config, settings: S, today: new Date(2026, 10, 13),
  template: { sheet: template, headerRow: 1 }, memberIndex: buildMemberIndex(template, 1, 0, 1),
});
const file = (name: string): UploadedFile => ({ originalName: name, sheet: "Sheet1", headerRow: 1, sha256: "x", ext: "xlsx" }) as UploadedFile;
const ctx = (lang?: Lang): OutputContext => ({
  importName: "Test", settings: S, template: file("template.xlsx"), source: file("data.xlsx"), templateSheet: template, templateBuffer: null,
  targets, sources, config, result, sourceSheet: source, generatedAt: new Date(2026, 10, 13), lang,
});

async function open(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
const text = (wb: ExcelJS.Workbook) => wb.worksheets.flatMap((ws) => ws.getSheetValues().flat().filter((v) => typeof v === "string")).join("\n");
const ETHIOPIC = /[ሀ-፿]/;

describe("reports in the user's language", () => {
  it("writes the reports in Amharic when asked", async () => {
    const report = await open(await writeReportXlsx(ctx("am"), verifyFinal((await writeFinalXlsx(ctx("am"))).buffer, ctx("am")), "fresh"));
    expect(report.worksheets.map((w) => w.name)).toEqual(["ማጠቃለያ", "የገንዘብ ማስታረቅ", "የአባላት ማዛመጃ", "ሁሉም ችግሮች", "የለውጥ መዝገብ"]);
    const all = text(report);
    expect(all).toContain("የሳኮ መረጃ ማስገቢያ — የማረጋገጫ ሪፖርት");
    expect(all).toContain("በአባላት ዝርዝሩ ውስጥ አልተገኘም"); // problem type
    expect(all).toContain("✔ አልፏል"); // verification passed
    expect(all).not.toMatch(/Mandatory value is missing|not in the member list/);

    const invalid = await open((await writeInvalidXlsx(ctx("am"))).buffer);
    expect(invalid.worksheets.map((w) => w.name)).toEqual(["ስህተት ያለባቸው መዝገቦች", "የችግሮች ዝርዝር"]);
    expect(text(invalid)).toMatch(ETHIOPIC);

    const mapping = await open(await writeMappingXlsx(ctx("am")));
    expect(mapping.worksheets.map((w) => w.name)).toEqual(["የአምዶች ማዛመጃ", "ጥቅም ላይ ያልዋሉ አምዶች"]);
  });

  it("handles a stray value in the last Excel column (XFD) of the original file", async () => {
    // Like "Abisinya 2018.xlsx": one value typed far to the right makes the sheet 16,384 columns wide.
    const wide: RawCell[][] = [["Name", "Savings"], ["Abebe Kebede", n(500)], ["Unknown Person", n(70)]].map((r) => [...r]);
    wide[2][16383] = { n: 20, w: " 20.00 " };
    const wideSheet = sheet(wide);
    const wideSources = buildSources(wideSheet, 1, S).sources;
    expect(wideSources.length).toBe(16384);
    const wideResult = runPipeline({
      targets, sources: wideSources, sheet: wideSheet, headerRow: 1, config, settings: S, today: new Date(2026, 10, 13),
      template: { sheet: template, headerRow: 1 }, memberIndex: buildMemberIndex(template, 1, 0, 1),
    });
    const wideCtx: OutputContext = { ...ctx("am"), sources: wideSources, sourceSheet: wideSheet, result: wideResult };
    const invalid = await open((await writeInvalidXlsx(wideCtx)).buffer);
    const header = (invalid.worksheets[0].getRow(1).values as unknown[]).slice(1);
    // 5 columns of explanations + Name, Savings and the stray column — not 16,384 empty ones
    expect(header).toHaveLength(8);
    expect((invalid.worksheets[0].getRow(2).values as unknown[]).some((v) => String(v).includes("20.00"))).toBe(true); // the stray value is kept
    const mapping = await open(await writeMappingXlsx(wideCtx));
    expect(mapping.worksheets[1].rowCount).toBeLessThan(5);
  });

  it("removes all of the template's member rows from the copy of the template", async () => {
    // A real .xlsx template that lists its members below the header (like the 5,745-member SACCO template).
    const tplWb = new ExcelJS.Workbook();
    const tplWs = tplWb.addWorksheet("Sheet1");
    tplWs.addRow(["Member ID", "Full Name", "Savings"]).font = { bold: true };
    for (let i = 1; i <= 40; i++) tplWs.addRow([`M${String(i).padStart(3, "0")}`, `Member ${i}`, 0]);
    const templateBuffer = Buffer.from(await tplWb.xlsx.writeBuffer());
    const c: OutputContext = { ...ctx("am"), templateBuffer };

    const final = await writeFinalXlsx(c);
    expect(final.mode).toBe("template"); // the template itself was copied, not a new workbook
    const check = verifyFinal(final.buffer, c);
    expect(check.checks.filter((x) => !x.ok)).toEqual([]);
    const ws = (await open(final.buffer)).getWorksheet("Sheet1")!;
    expect(ws.actualRowCount).toBe(2); // header + the one member with data; none of the other 39 template members
    expect(ws.getRow(2).values).toEqual([undefined, "M001", "Abebe Kebede", 500]);
    expect(ws.getRow(1).font?.bold).toBe(true); // template formatting is kept
  });

  it("keeps English reports when no language is given, and never translates the final data file", async () => {
    const report = await open(await writeReportXlsx(ctx(), null, "fresh"));
    expect(report.getWorksheet("Summary")).toBeTruthy();
    expect(report.getWorksheet("Change log")).toBeTruthy();
    const final = await open((await writeFinalXlsx(ctx("am"))).buffer);
    expect(final.worksheets[0].getRow(1).values).toEqual([undefined, "Member ID", "Full Name", "Savings"]);
    expect(final.worksheets[0].getRow(2).values).toEqual([undefined, "M001", "Abebe Kebede", 500]);
  });
});
