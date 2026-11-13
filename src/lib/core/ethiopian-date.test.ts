import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type ImportConfig, type RawCell } from "../types";
import { ethiopianToGregorian, gregorianToEthiopian, isValidEthiopian, looksEthiopian, parseEthiopianDate } from "./ethiopian-date";
import { buildSources, buildTargets, suggestMappings, DEFAULT_TRANSFORMS, type SheetData } from "./analyze";
import { runPipeline } from "./pipeline";

describe("Ethiopian calendar", () => {
  it("converts known dates", () => {
    expect(ethiopianToGregorian(2016, 1, 1)).toEqual({ y: 2023, m: 9, d: 12 }); // Ethiopian new year 2016
    expect(ethiopianToGregorian(2015, 13, 6)).toEqual({ y: 2023, m: 9, d: 11 }); // ጳጉሜ 6 in the leap year 2015
    expect(ethiopianToGregorian(2017, 1, 1)).toEqual({ y: 2024, m: 9, d: 11 });
    expect(ethiopianToGregorian(2017, 10, 1)).toEqual({ y: 2025, m: 6, d: 8 }); // ሰኔ 1, 2017
    expect(ethiopianToGregorian(2016, 4, 28)).toEqual({ y: 2024, m: 1, d: 7 });
  });
  it("converts back and forth for every day of several years", () => {
    for (let y = 1990; y <= 2030; y++)
      for (let m = 1; m <= 13; m++)
        for (let d = 1; d <= 30; d++) {
          if (!isValidEthiopian(y, m, d)) continue;
          expect(gregorianToEthiopian(ethiopianToGregorian(y, m, d))).toEqual({ y, m, d });
        }
  });
  it("knows which days exist", () => {
    expect(isValidEthiopian(2015, 13, 6)).toBe(true); // leap year (2015 % 4 === 3)
    expect(isValidEthiopian(2016, 13, 6)).toBe(false);
    expect(isValidEthiopian(2016, 2, 30)).toBe(true); // every month has 30 days
    expect(isValidEthiopian(2016, 2, 31)).toBe(false);
    expect(isValidEthiopian(2016, 14, 1)).toBe(false);
  });
  it("reads the ways Ethiopian dates are written", () => {
    const gc = (cell: RawCell) => {
      const p = parseEthiopianDate(cell, "DMY", 2018);
      return p.ok ? p.date : p.reason;
    };
    const new_year_2016 = { y: 2023, m: 9, d: 12 };
    expect(gc("01/01/2016")).toEqual(new_year_2016);
    expect(gc("1/1/2016 ዓ.ም")).toEqual(new_year_2016);
    expect(gc("1-1-2016 ዓ/ም")).toEqual(new_year_2016);
    expect(gc("2016-01-01")).toEqual(new_year_2016);
    expect(gc("መስከረም 1 2016")).toEqual(new_year_2016);
    expect(gc("1 መስከረም 2016 ዓ.ም")).toEqual(new_year_2016);
    expect(gc("የመስከረም 1, 2016")).toEqual(new_year_2016);
    expect(gc("Meskerem 1 2016 E.C.")).toEqual(new_year_2016);
    expect(gc("6/13/2015")).toEqual({ y: 2023, m: 9, d: 11 }); // ጳጉሜ = month 13
    expect(gc({ n: 42648, w: "1/1/2016", d: "2016-01-01" })).toEqual(new_year_2016); // Excel kept it as a date
    expect(gc("31/01/2016")).toContain("not a real Ethiopian calendar date");
  });
  it("recognises Ethiopian dates on their own", () => {
    expect(looksEthiopian("12/10/2016 ዓ.ም")).toBe(true);
    expect(looksEthiopian("ሰኔ 12 2016")).toBe(true);
    expect(looksEthiopian("12/10/2016")).toBe(false); // only numbers: the column setting decides
    expect(looksEthiopian("Abebe Kebede")).toBe(false);
  });
  it("converts a date column in an import, and shows it as a change", () => {
    const sheet = (rows: RawCell[][]): SheetData => ({ name: "Sheet1", rows }) as SheetData;
    const template = sheet([["Member ID", "Join Date (DD/MM/YYYY)"]]);
    const source = sheet([["Member ID", "Join Date"], ["001", "1/1/2016 ዓ.ም"], ["002", "10/06/2015"]]);
    const S = DEFAULT_SETTINGS;
    const { targets } = buildTargets(template, 1, { lists: {}, numFmts: {} }, S);
    const { sources } = buildSources(source, 1, S);
    const mappings = suggestMappings(targets, sources, source, 1, S, []).map((m) => ({ ...m, confirmed: true }));
    const config: ImportConfig = { mappings, transforms: { ...DEFAULT_TRANSFORMS }, edits: {}, excluded: [], appliedMappingTemplateId: null, mode: "rows", fill: null, memberOverrides: {}, approvals: { month: false } };
    const run = (cfg: ImportConfig) => runPipeline({ targets, sources, sheet: source, headerRow: 1, config: cfg, settings: S, today: new Date(2026, 10, 13) });

    const auto = run(config);
    expect(auto.rows[0].values[1]).toEqual({ date: "2023-09-12" }); // says ዓ.ም → Ethiopian
    expect(auto.rows[0].changed?.[1]).toBe("calendar");
    expect(auto.rows[1].values[1]).toEqual({ date: "2015-06-10" }); // only numbers → Gregorian

    const ethiopian = run({ ...config, mappings: config.mappings.map((m) => (m.target === 1 ? { ...m, rule: { ...m.rule, calendar: "ethiopian" as const } } : m)) });
    expect(ethiopian.rows[1].values[1]).toEqual({ date: "2023-02-17" }); // 10/06/2015 = 10 የካቲት 2015 ዓ.ም
    expect(ethiopian.summary.transforms.find((t) => t.key === "calendar")?.cells).toBe(2);
  });
});
