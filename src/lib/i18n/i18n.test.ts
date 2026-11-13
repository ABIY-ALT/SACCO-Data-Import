import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AM } from "./am";
import { translate, translateMessage } from "./index";
import { COLUMN_TYPE_LABELS, MEMBER_STATUS_LABELS, OUTPUT_LABELS, TEMPLATE_CHANGE_LABELS, TRANSFORM_INFO } from "../types";
import { TRANSFORM_TAG_LABELS, issueLabel } from "../core/pipeline";

const SRC = path.resolve(__dirname, "../..");
const ETHIOPIC = /[ሀ-፿]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

/** Every literal text passed to t(), t.rich(), tr() or tk() in the code. */
function textsInCode(): { text: string; file: string }[] {
  const out: { text: string; file: string }[] = [];
  const re = /(?<![\w.])(?:t|tr|tk|t\.rich|translate\(\w+,)\(?\s*"((?:[^"\\]|\\.)*)"/g;
  for (const file of files(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) out.push({ text: JSON.parse(`"${m[1]}"`), file: path.relative(SRC, file) });
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Amharic translation", () => {
  it("has an Amharic text for every text shown on the screens", () => {
    const texts = textsInCode();
    expect(texts.length).toBeGreaterThan(50);
    const missing = [...new Set(texts.filter((x) => AM[x.text] === undefined).map((x) => `${x.file}: ${x.text}`))];
    expect(missing).toEqual([]);
  });

  it("has an Amharic text for the labels defined in the shared types", () => {
    const labels = [
      ...Object.values(COLUMN_TYPE_LABELS),
      ...Object.values(MEMBER_STATUS_LABELS),
      ...Object.values(OUTPUT_LABELS),
      ...Object.values(TEMPLATE_CHANGE_LABELS),
      ...Object.values(TRANSFORM_TAG_LABELS),
      ...Object.values(TRANSFORM_INFO).flatMap((i) => [i.label, i.description]),
    ];
    expect(labels.filter((l) => AM[l] === undefined)).toEqual([]);
  });

  it("keeps the same {placeholders} and bold marks in every Amharic text", () => {
    const bad = Object.entries(AM).filter(
      ([en, am]) => placeholders(en).join() !== placeholders(am).join() || (en.match(/<b>/g)?.length ?? 0) !== (am.match(/<b>/g)?.length ?? 0),
    );
    expect(bad).toEqual([]);
  });

  it("every Amharic text is written in Amharic", () => {
    expect(Object.entries(AM).filter(([, am]) => !ETHIOPIC.test(am))).toEqual([]);
  });

  it("fills in values and falls back to English for unknown texts", () => {
    expect(translate("am", "{n} records", { n: 1500 })).toBe("1,500 መዝገቦች");
    expect(translate("en", "{n} records", { n: 2 })).toBe("2 records");
    expect(translate("am", "A text that is not in the dictionary")).toBe("A text that is not in the dictionary");
  });

  it("translates messages that the server filled in", () => {
    const issues = ["required", "duplicate", "date", "phone", "number_text", "member_not_found", "money_not_imported"];
    for (const code of issues) expect(translate("am", issueLabel(code))).toMatch(ETHIOPIC);
    const messages = [
      '"abc" is not a number',
      '"12/13/2020" is not valid as day/month/year',
      'Negative value -50 is not allowed in this column',
      "Mandatory value is missing",
      "Member ID BT10193 is not in the member list. No member with this name in the template's member list.",
      "Similar spelling: “ድሪባ አንበሴ”. Please check it is the same person.",
      "2 possible column matches need your confirmation on the Column Mapping step.",
      'Default value "0" for money amount column "Savings" creates data that is not in the original file.',
      "This import is already completed. Use \"Repeat import\" to make changes.",
    ];
    for (const m of messages) {
      const am = translateMessage("am", m);
      expect(am, m).toMatch(ETHIOPIC);
      expect(am, m).not.toMatch(/\b(is|the|not|member|column)\b/);
    }
    // values keep their original text
    expect(translateMessage("am", '"abc" is not a number')).toContain("abc");
    expect(translateMessage("en", '"abc" is not a number')).toBe('"abc" is not a number');
  });
});
