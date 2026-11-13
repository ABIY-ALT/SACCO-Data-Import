// Drives the real user interface in a browser (Microsoft Edge or Chrome) through the whole workflow.
//   node scripts/e2e-ui.mjs [baseUrl] [screenshotDir]
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://localhost:3210";
const SHOTS = path.resolve(process.argv[3] ?? "test-data/output/screenshots");
const DATA = path.resolve("test-data");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  problems.push(`console: ${m.text()}`);
  console.log("    [browser console error]", m.text().slice(0, 600));
});

let n = 0;
const shot = async (name) => page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, "0")}-${name}.png`), fullPage: true, caret: "initial" });
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    console.log(`  ✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    console.error(`  ✘ ${name}`);
    await shot(`FAILED-${name.replace(/\W+/g, "-")}`).catch(() => {});
    console.error(e);
    await browser.close();
    process.exit(1);
  }
};
const visible = (sel) => page.locator(sel).locator("visible=true");

console.log(`UI E2E against ${BASE}`);

// Forget what earlier test runs saved, so the uncertain Gender ← Sex match is asked again.
await step("reset test mappings and remembered names", async () => {
  const get = async (u) => (await fetch(BASE + u)).json();
  for (const m of (await get("/api/mappings")).mappings)
    if (m.name === "E2E members mapping" || m.name.startsWith("sacco-member-template")) await fetch(`${BASE}/api/mappings/${m.id}`, { method: "DELETE" });
  for (const a of (await get("/api/aliases")).aliases)
    if ((a.targetLabel === "Gender" && a.sourceLabel === "Sex") || (a.targetLabel === "Address" && a.sourceLabel === "Residence"))
      await fetch(`${BASE}/api/aliases?target=${encodeURIComponent(a.targetKey)}&source=${encodeURIComponent(a.sourceKey)}`, { method: "DELETE" });
});

await step("dashboard loads", async () => {
  await page.goto(BASE + "/");
  await visible("h1:has-text('Dashboard')").waitFor();
  await page.getByText("Total imports").first().waitFor();
  await shot("dashboard");
});

await step("upload both files on New Data Import", async () => {
  await page.goto(BASE + "/imports/new");
  await visible("h1:has-text('New Data Import')").waitFor();
  await shot("new-import-empty");
  await page.setInputFiles("[data-testid=file-input-template]", path.join(DATA, "sacco-member-template.xlsx"));
  await visible("text=sacco-member-template.xlsx").waitFor();
  await visible("text=Column headers found").first().waitFor({ timeout: 30000 });
  await page.setInputFiles("[data-testid=file-input-source]", path.join(DATA, "original-members.xlsx"));
  await visible("text=original-members.xlsx").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid^=header-row-]").length === 2, null, { timeout: 30000 });
  assert.equal(await page.locator("[data-testid=header-row-source]").inputValue(), "3", "title row skipped, headers on row 3");
  await shot("new-import-uploaded");
});

await step("compare & validate opens the mapping step", async () => {
  await page.getByRole("button", { name: "Compare & Validate", exact: true }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 60000 });
  await visible("text=Template column (final file)").waitFor({ timeout: 60000 });
  await shot("mapping");
});

await step("confirm the uncertain Gender ← Sex match", async () => {
  const row = page.locator("[data-testid=mapping-row-2]");
  await row.getByText("Possible match").waitFor();
  await row.getByRole("button", { name: "Confirm" }).click();
  await row.getByText("Confirmed by you").waitFor();
  await visible("text=Saved & checked").waitFor({ timeout: 30000 });
});

await step("column rules drawer opens", async () => {
  await page.getByRole("button", { name: "Rules for Gender" }).click();
  await visible("text=Values found in the original file").waitFor();
  await visible("text=“Male”").waitFor({ timeout: 15000 });
  await shot("column-rules-gender");
  await page.keyboard.press("Escape");
});

await step("cleaning step shows changes with examples", async () => {
  await page.getByRole("button", { name: "Continue to cleaning", exact: true }).click();
  await visible("text=Your original file is never changed").waitFor();
  await page.getByText("Show examples").first().click();
  await shot("cleaning");
});

await step("validation step shows problems and records", async () => {
  await page.getByRole("button", { name: "Continue to validation", exact: true }).click();
  await visible("text=Problems found").waitFor();
  await page.locator("[data-testid=data-row]").first().waitFor({ timeout: 30000 });
  await shot("validation");
});

await step("filter errors and correct a value in the row inspector", async () => {
  await page.getByRole("button", { name: /^Invalid gender value/ }).click();
  await page.locator("[data-testid=data-row]").first().click();
  await visible("text=of the original file").waitFor();
  await shot("row-inspector");
  const genderBox = page.locator("[role=dialog] .rounded-lg.border").filter({ hasText: /^Gender/ }).first();
  await genderBox.getByRole("button", { name: "Correct" }).click();
  await page.getByLabel("New value for Gender").fill("F");
  await genderBox.getByRole("button", { name: "Save" }).click();
  await visible("[role=dialog] >> text=Corrected by you").first().waitFor({ timeout: 15000 });
  await page.keyboard.press("Escape");
});

await step("continue to download and generate", async () => {
  await page.getByRole("button", { name: "Continue to download", exact: true }).click();
  await visible("text=Final check").waitFor();
  const dup = page.locator("[data-testid=confirm-duplicate]");
  if (await dup.count()) await dup.check();
  await shot("generate");
  await page.getByRole("button", { name: "Generate Final Excel File", exact: true }).click();
  await visible("text=Your file is ready for import").waitFor({ timeout: 120000 });
  await shot("results");
});

await step("download final Excel through the browser and reopen it", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-testid=download-final-hero]").click()]);
  const file = path.join(SHOTS, "..", "ui-final.xlsx");
  await download.saveAs(file);
  assert.match(download.suggestedFilename(), /READY FOR IMPORT .*\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("Members");
  assert.deepEqual(ws.getRow(1).values.slice(1, 4), ["Member ID*", "Full Name*", "Gender"]);
  assert.ok(ws.rowCount > 400);
  for (let r = 2; r <= ws.rowCount; r++) assert.match(String(ws.getRow(r).getCell(1).value), /^\d{6}$/);
});

for (const [p, title] of [["/history", "Import History"], ["/mappings", "Mapping Templates"], ["/reports", "Validation Reports"], ["/settings", "Settings"], ["/", "Dashboard"]]) {
  await step(`${title} page`, async () => {
    await page.goto(BASE + p);
    await visible(`h1:has-text('${title}')`).waitFor();
    await page.waitForLoadState("networkidle");
    await shot(title.toLowerCase().replace(/\s+/g, "-"));
  });
}

await step("small screen layout", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/imports/new");
  await visible("h1:has-text('New Data Import')").waitFor();
  await shot("mobile-new-import");
});

await browser.close();
const real = problems.filter((p) => !/Download the React DevTools|\[HMR\]|\[Fast Refresh\]/.test(p));
if (real.length) {
  console.error("\nBrowser errors:\n" + real.join("\n"));
  process.exit(1);
}
console.log(`\nUI workflow passed. Screenshots in ${SHOTS}`);
