// TEMPORARY: runs the engine on the user's uploaded files (local cache) to check matching quality. Deleted after use.
import { it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type ImportConfig } from "../types";
import { buildSources, buildTargets, detectHeaderRow, suggestMappings, DEFAULT_TRANSFORMS, type SheetData } from "./analyze";
import { detectFill, detectTotalColumn, moneyColumns, sameMonth, sheetMonth, templateMonth } from "./structure";
import { buildMemberIndex } from "./members";
import { runPipeline } from "./pipeline";
import { lookupConcepts } from "./dictionary";

const DIR = "C:/system import/storage/imports/aa8dd479-370e-477b-b7d5-2f3bdea47b65/cache";

it("real data", () => {
  const tpl = JSON.parse(readFileSync(path.join(DIR, "template.json"), "utf8")).sheets[0] as SheetData;
  const thr = detectHeaderRow(tpl.rows);
  const tm = templateMonth(tpl, thr);
  console.log("template header row", thr, "month", tm?.label);
  const sheets = readdirSync(DIR).filter((f) => f.startsWith("source-")).map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as SheetData);
  for (const s of sheets) {
    const m = sheetMonth(s);
    if (m) console.log("  sheet", s.name.padEnd(10), m.label, sameMonth(m, tm) ? "<= MATCH" : "");
  }
  const src = sheets.find((s) => sameMonth(sheetMonth(s), tm))!;
  const shr = detectHeaderRow(src.rows);
  const S = DEFAULT_SETTINGS;
  const { targets } = buildTargets(tpl, thr, { lists: {}, numFmts: {} }, S);
  const { sources } = buildSources(src, shr, S);
  const fillInfo = detectFill(targets, tpl, thr);
  console.log("fill", JSON.stringify(fillInfo));
  let mappings = suggestMappings(targets, sources, src, shr, S, []);
  const nameM = mappings.find((m) => m.target === fillInfo.nameTarget);
  const sourceNameCol = nameM?.source ?? sources.find((s) => lookupConcepts(s.header).some((e) => e.concept.id === "full_name"))?.index ?? null;
  mappings = mappings.map((m) => (m.target === fillInfo.keyTarget || m.target === fillInfo.nameTarget ? { ...m, source: null, status: "missing" as const } : m));
  console.log("\nMAPPING (template ← original):");
  for (const m of mappings) {
    const t = targets[m.target];
    console.log(`  ${t.label.padEnd(44)} ← ${(m.source === null ? "—" : sources[m.source].label).padEnd(22)} ${m.status}${m.confirmed ? "" : " (confirm)"}  ${m.reason}`);
  }
  const money = moneyColumns(src, shr, sources, [sourceNameCol]);
  const totalCol = detectTotalColumn(src, shr, sources, money);
  console.log("\nname col", sourceNameCol, sources[sourceNameCol!]?.label, "| total col", totalCol, totalCol !== null ? sources[totalCol].label : "", "| money cols", money.map((c) => sources[c].label).join(", "));

  const config: ImportConfig = {
    mappings: mappings.map((m) => ({ ...m, confirmed: true })),
    transforms: { ...DEFAULT_TRANSFORMS },
    edits: {},
    excluded: [],
    appliedMappingTemplateId: null,
    mode: "fill",
    fill: { keyTarget: fillInfo.keyTarget!, nameTarget: fillInfo.nameTarget, sourceNameCol, sourceKeyCol: null, includeAll: false },
    memberOverrides: {},
    approvals: { month: false },
  };
  const t0 = Date.now();
  const index = buildMemberIndex(tpl, thr, fillInfo.keyTarget!, fillInfo.nameTarget);
  const res = runPipeline({
    targets, sources, sheet: src, headerRow: shr, config, settings: S,
    template: { sheet: tpl, headerRow: thr }, memberIndex: index, learnedMembers: [], totalCol, months: { template: tm, source: sheetMonth(src) },
  });
  console.log(`\npipeline ${Date.now() - t0} ms; rows ${res.summary.totalRows}, ready ${res.summary.ready}, errors ${res.summary.withErrors}, output rows ${res.summary.outputRows}`);
  console.log("members:", JSON.stringify(res.summary.members));
  for (const r of res.rows) {
    const m = r.member!;
    if (["exact", "id"].includes(m.status)) continue;
    console.log(`  row ${shr + 1 + r.i} “${m.sourceName}” → ${m.status} ${m.member ? m.member.id + " " + m.member.name : ""} | ${m.reason} | cands: ${m.candidates.slice(0, 3).map((c) => c.id + " " + c.name + " " + c.score).join("; ")}`);
  }
  console.log("\nskipped rows:", JSON.stringify(res.summary.reconciliation?.skippedRows));
  console.log("reconciliation:", JSON.stringify({ ...res.summary.reconciliation, skippedRows: undefined }, null, 1));
  console.log("issues:", res.summary.issues.map((i) => `${i.label}/${i.col}:${i.count}`).join(", "));
  console.log("blocking:", res.summary.blocking, "approvals:", res.summary.approvalsNeeded);
  const first = res.outputRows[0];
  console.log("first output row:", JSON.stringify(first?.values));
});
