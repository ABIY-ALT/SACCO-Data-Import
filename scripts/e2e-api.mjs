// End-to-end test of the import workflow through the HTTP API.
//   node scripts/e2e-api.mjs [baseUrl]
// Requires the app running (npm run dev / npm start) and sample files (node scripts/make-sample-data.mjs).
import ExcelJS from "exceljs";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://localhost:3210";
const DATA = path.resolve("test-data");
const OUT = path.join(DATA, "output");
mkdirSync(OUT, { recursive: true });

let passed = 0;
const step = async (name, fn) => {
  const t = Date.now();
  try {
    const r = await fn();
    passed++;
    console.log(`  ✔ ${name} (${Date.now() - t} ms)`);
    return r;
  } catch (e) {
    console.error(`  ✘ ${name}\n`, e);
    process.exit(1);
  }
};

async function api(method, url, body, expectStatus = 200) {
  const res = await fetch(BASE + url, {
    method,
    headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (res.status !== expectStatus) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data).slice(0, 500)}`);
  return { data, res };
}

async function upload(id, role, file) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(path.join(DATA, file))]), file);
  return (await api("POST", `/api/imports/${id}/files/${role}`, fd)).data;
}

console.log(`E2E against ${BASE}`);

// Start from a clean memory: remove only what previous runs of this test saved.
await step("reset this test's saved mapping and learned names", async () => {
  const { mappings } = (await api("GET", "/api/mappings")).data;
  for (const m of mappings.filter((x) => x.name === "E2E members mapping" || x.name.startsWith("sacco-member-template"))) await api("DELETE", `/api/mappings/${m.id}`);
  const { aliases } = (await api("GET", "/api/aliases")).data;
  for (const al of aliases.filter((x) => (x.targetLabel === "Gender" && x.sourceLabel === "Sex") || (x.targetLabel === "Address" && x.sourceLabel === "Residence")))
    await api("DELETE", `/api/aliases?target=${encodeURIComponent(al.targetKey)}&source=${encodeURIComponent(al.sourceKey)}`);
});

// ------------------------------------------------------------------ 1. upload
const { id } = (await step("create import", () => api("POST", "/api/imports", { name: "E2E member import" }))).data;
const tpl = await step("upload sample template", async () => {
  const r = await upload(id, "template", "sacco-member-template.xlsx");
  assert.equal(r.file.headerRow, 1);
  assert.equal(r.file.sheet, "Members");
  assert.equal(r.file.columnCount, 14);
  return r;
});
const src = await step("upload original data (title row above headers)", async () => {
  const r = await upload(id, "source", "original-members.xlsx");
  assert.equal(r.file.headerRow, 3, "header row detected below title");
  assert.equal(r.file.dataRowCount, 501);
  return r;
});

// ------------------------------------------------------------------ 2. compare
let detail = await step("analyze & compare", async () => {
  const d = (await api("POST", `/api/imports/${id}/analyze`, {})).data;
  const a = d.import.analysis;
  assert.equal(a.targets.length, 14);
  assert.equal(a.sources.length, 16);
  return d;
});
const a = detail.import.analysis;
let config = detail.import.config;
const byLabel = (l) => config.mappings[a.targets.findIndex((t) => t.label.startsWith(l))];
const srcLabel = (m) => (m.source === null ? null : a.sources[m.source].label);

await step("automatic matches are correct", () => {
  assert.equal(srcLabel(byLabel("Member ID")), "Membership No");
  assert.equal(srcLabel(byLabel("Full Name")), "Member Name");
  assert.equal(srcLabel(byLabel("Date of Birth")), "DOB");
  assert.equal(srcLabel(byLabel("Phone Number")), "Mobile");
  assert.equal(srcLabel(byLabel("National ID")), "ID Number");
  assert.equal(srcLabel(byLabel("Email")), "E-mail");
  assert.equal(srcLabel(byLabel("Branch")), "Branch");
  assert.equal(srcLabel(byLabel("Join Date")), "Date Joined");
  assert.equal(srcLabel(byLabel("Savings Balance")), "Savings");
  assert.equal(srcLabel(byLabel("Share Capital")), "Shares");
  assert.equal(srcLabel(byLabel("Loan Balance")), "Loan Outstanding");
  assert.equal(srcLabel(byLabel("Marital Status")), "Marital");
});
await step("uncertain match waits for confirmation (Sex → Gender); Residence is a known name for Address", () => {
  assert.deepEqual([byLabel("Gender").status, byLabel("Gender").confirmed], ["possible", false]);
  assert.equal(srcLabel(byLabel("Gender")), "Sex");
  assert.equal(srcLabel(byLabel("Address")), "Residence");
  assert.equal(byLabel("Address").status, "synonym");
});
await step("template dropdown lists and formats were read", () => {
  assert.deepEqual(byLabel("Gender").rule.allowedValues, ["M", "F"]);
  assert.deepEqual(byLabel("Branch").rule.allowedValues, ["Head Office", "Bole", "Adama", "Hawassa"]);
  assert.deepEqual(byLabel("Marital Status").rule.allowedValues, ["Single", "Married", "Divorced", "Widowed"]);
  assert.equal(byLabel("Join Date").rule.dateFormat, "DD/MM/YYYY");
  assert.equal(byLabel("Member ID").rule.required, true);
  assert.equal(byLabel("Phone Number").rule.required, true);
  assert.equal(a.extraSources.map((i) => a.sources[i].label).join(","), "S/No,Remarks");
});
await step("generation is blocked until uncertain matches are confirmed", async () => {
  const r = await api("POST", `/api/imports/${id}/generate`, {}, 409);
  assert.equal(r.data.details.code, "blocked");
});

// ------------------------------------------------------------------ 3. map + validate
let summary = await step("confirm matches and re-process", async () => {
  const g = byLabel("Gender");
  g.confirmed = true;
  const r = (await api("POST", `/api/imports/${id}/process`, { config })).data;
  config = r.config;
  assert.deepEqual(r.summary.blocking, []);
  return r.summary;
});
await step("validation finds the planted problems", () => {
  const codes = Object.fromEntries(summary.issues.map((i) => [i.code + "|" + a.targets[i.col]?.label.split(" (")[0], i.count]));
  const has = (k) => assert.ok(codes[k] > 0, `expected issue ${k}; got ${Object.keys(codes).join(", ")}`);
  has("gender|Gender");
  has("date|Date of Birth");
  has("dob_future|Date of Birth");
  has("phone|Phone Number");
  has("duplicate|Phone Number");
  has("duplicate|Member ID");
  has("negative|Savings Balance");
  has("required|Full Name");
  has("email|Email");
  has("decimals|Savings Balance");
  assert.equal(summary.totalRows, 501);
  assert.equal(summary.blankRowsSkipped, 1);
  assert.ok(summary.duplicates >= 4);
});
await step("cleaning is visible (trim, dates, numbers, phones, codes)", () => {
  const tags = summary.transforms.map((t) => t.key).sort();
  for (const t of ["code", "date", "number", "phone", "trim"]) assert.ok(tags.includes(t), `missing transform ${t}`);
});
const errRows = await step("list rows with errors", async () => {
  const r = (await api("GET", `/api/imports/${id}/rows?filter=errors&size=100`)).data;
  assert.equal(r.total, summary.withErrors);
  return r.rows;
});
await step("correct a value in the row inspector", async () => {
  const bad = errRows.find((r) => r.issues.some((i) => i.code === "gender"));
  const genderCol = a.targets.findIndex((t) => t.label === "Gender");
  const r = (await api("POST", `/api/imports/${id}/rows`, { action: "edit", row: bad.i, target: genderCol, value: "F" })).data;
  assert.equal(r.row.values[genderCol], "F");
  assert.ok(r.row.edited[genderCol]);
  assert.ok(!r.row.issues.some((i) => i.code === "gender"));
  summary = r.summary;
});
await step("exclude an identical duplicate record", async () => {
  const dupRows = (await api("GET", `/api/imports/${id}/rows?filter=duplicates&size=100`)).data.rows;
  const identical = dupRows.filter((r) => r.issues.some((i) => i.code === "duplicate_row"));
  assert.equal(identical.length, 2);
  const r = (await api("POST", `/api/imports/${id}/rows`, { action: "exclude", row: identical[1].i })).data;
  assert.equal(r.row.status, "excluded");
  summary = r.summary;
});

// ------------------------------------------------------------------ 4. generate
detail = await step("generate final file (+ save mapping)", async () => {
  const d = (await api("POST", `/api/imports/${id}/generate`, { confirmDuplicate: src.duplicateOf.length > 0, saveMapping: { save: true, name: "E2E members mapping" } })).data;
  assert.equal(d.import.status, "completed");
  assert.ok(d.import.verification.ok, JSON.stringify(d.import.verification.checks));
  assert.equal(d.import.outputs.length, 5);
  return d;
});
await step("app's own verification passed", () => {
  for (const c of detail.import.verification.checks) assert.ok(c.ok, c.label);
});

// ------------------------------------------------------------------ 5. reopen the downloaded file independently
const finalBuf = await step("download final Excel", async () => {
  const { data, res } = await api("GET", `/api/imports/${id}/download/final`);
  assert.match(res.headers.get("content-disposition"), /READY FOR IMPORT/);
  writeFileSync(path.join(OUT, "final.xlsx"), data);
  return data;
});
await step("reopen final file: exact headers, order, sheet, values", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(finalBuf);
  const ws = wb.getWorksheet("Members");
  assert.ok(ws, "sheet Members exists");
  assert.ok(wb.getWorksheet("Instructions") && wb.getWorksheet("Lists"), "template's other sheets kept");
  const headers = ws.getRow(1).values.slice(1);
  assert.deepEqual(headers, [
    "Member ID*", "Full Name*", "Gender", "Date of Birth (DD/MM/YYYY)", "Phone Number*", "National ID", "Email",
    "Address", "Branch", "Join Date", "Savings Balance", "Share Capital", "Loan Balance", "Marital Status",
  ]);
  const dataRows = [];
  ws.eachRow((row, n) => n > 1 && dataRows.push(row));
  assert.equal(dataRows.length, summary.ready, "row count = ready records");
  assert.ok(!dataRows.some((r) => r.getCell(2).value === "Example Member"), "template example row removed");

  // independent comparison with the original file
  const orig = new ExcelJS.Workbook();
  await orig.xlsx.readFile(path.join(DATA, "original-members.xlsx"));
  const ows = orig.getWorksheet("Register");
  const origById = new Map();
  ows.eachRow((row, n) => {
    if (n <= 3) return;
    const idCell = row.getCell(2);
    const idText = typeof idCell.value === "number" ? String(idCell.value).padStart(6, "0") : idCell.value;
    if (idText) origById.set(idText, row);
  });
  let checked = 0;
  for (const r of dataRows) {
    const idVal = r.getCell(1).value;
    assert.equal(typeof idVal, "string", "member id stored as text");
    assert.match(idVal, /^\d{6}$/, "leading zeros kept");
    const o = origById.get(idVal);
    assert.ok(o, `member ${idVal} exists in original`);
    // financial values never altered
    const savO = o.getCell(12).value;
    const savF = r.getCell(11).value;
    const expected = typeof savO === "number" ? savO : Number(String(savO).replace(/[^0-9.\-]/g, ""));
    assert.equal(savF, expected, `savings for ${idVal}`);
    assert.equal(r.getCell(12).value, o.getCell(13).value, `shares for ${idVal}`);
    assert.equal(r.getCell(13).value ?? null, o.getCell(14).value ?? null, `loan for ${idVal}`);
    // phone standardised to local format with leading zero
    assert.match(r.getCell(5).value, /^0\d{9}$/, "phone format");
    // dates are real Excel dates in template format
    const dob = r.getCell(4);
    assert.ok(dob.value instanceof Date, "date of birth is a date");
    assert.equal(dob.numFmt, "dd/mm/yyyy");
    assert.ok(["M", "F"].includes(r.getCell(3).value), "gender coded");
    checked++;
  }
  assert.equal(checked, summary.ready);
});
await step("other downloads: CSV, invalid records, report, mapping", async () => {
  const csv = (await api("GET", `/api/imports/${id}/download/final_csv`)).data.toString("utf8");
  assert.ok(csv.startsWith("﻿Member ID*,Full Name*,Gender"));
  assert.equal(csv.trim().split("\r\n").length, summary.ready + 1);
  for (const k of ["invalid", "report", "mapping"]) {
    const buf = (await api("GET", `/api/imports/${id}/download/${k}`)).data;
    writeFileSync(path.join(OUT, `${k}.xlsx`), buf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    assert.ok(wb.worksheets.length >= 1);
    if (k === "invalid") {
      // every record NOT in the final file must be here, each with a reason
      const ws = wb.getWorksheet("Invalid records");
      const expected = summary.totalRows - summary.ready;
      assert.equal(ws.rowCount - 1, expected, "invalid rows = total - ready");
      ws.eachRow((row, n) => n > 1 && assert.match(String(row.getCell(3).value), /\w/, `reason on row ${n}`));
      assert.equal(ws.getRow(1).getCell(5).value, "Membership No", "original columns kept");
    }
    if (k === "report") assert.ok(wb.getWorksheet("Summary") && wb.getWorksheet("All problems") && wb.getWorksheet("Change log"));
    if (k === "mapping") assert.equal(wb.getWorksheet("Column mapping").rowCount, 15);
  }
});

// ------------------------------------------------------------------ 6. duplicate processing protection + memory
const id2 = (await step("second import with the SAME original file", () => api("POST", "/api/imports", { name: "E2E duplicate" }))).data.id;
await upload(id2, "template", "sacco-member-template.xlsx");
const up2 = await upload(id2, "source", "original-members.xlsx");
await step("duplicate file is detected on upload", () => assert.equal(up2.duplicateOf[0]?.id, id));
const d2 = await step("saved mapping is applied automatically", async () => {
  const d = (await api("POST", `/api/imports/${id2}/analyze`, {})).data;
  assert.equal(d.import.analysis.savedMapping?.name, "E2E members mapping");
  const g = d.import.config.mappings[d.import.analysis.targets.findIndex((t) => t.label === "Gender")];
  assert.equal(g.confirmed, true, "previously confirmed match is remembered");
  return d;
});
await step("generation requires confirmation for an already-processed file", async () => {
  const r = await api("POST", `/api/imports/${id2}/generate`, {}, 409);
  assert.equal(r.data.details.code, "duplicate");
  const ok = (await api("POST", `/api/imports/${id2}/generate`, { confirmDuplicate: true })).data;
  assert.equal(ok.import.status, "completed");
  assert.equal(d2.import.id, id2);
});

// ------------------------------------------------------------------ 7. CSV source, repeat, cancel, history
await step("CSV original file works the same way", async () => {
  const { id: id3 } = (await api("POST", "/api/imports", {})).data;
  await upload(id3, "template", "sacco-member-template.xlsx");
  const u = await upload(id3, "source", "original-members.csv");
  assert.equal(u.file.ext, "csv");
  const d = (await api("POST", `/api/imports/${id3}/analyze`, {})).data;
  assert.equal(d.import.summary.totalRows, 501);
  const ids = (await api("GET", `/api/imports/${id3}/rows?size=5`)).data.rows.map((r) => r.values[0]);
  assert.ok(ids.every((v) => /^\d{6}$/.test(v)), "CSV ids keep leading zeros: " + ids.join(","));
  await api("PATCH", `/api/imports/${id3}`, { action: "cancel" });
  assert.equal((await api("GET", `/api/imports/${id3}`)).data.import.status, "cancelled");
});
await step("repeat an import (same template + mapping)", async () => {
  const { id: id4 } = (await api("POST", `/api/imports/${id}/repeat`, { withSource: false })).data;
  const d = (await api("GET", `/api/imports/${id4}`)).data;
  assert.ok(d.import.template && !d.import.source);
  await upload(id4, "source", "original-members.xlsx");
  const an = (await api("POST", `/api/imports/${id4}/analyze`, {})).data;
  assert.ok(an.import.analysis.savedMapping);
  assert.deepEqual(an.import.summary.blocking, []);
});
await step("rejects unsupported / fake files", async () => {
  const { id: id5 } = (await api("POST", "/api/imports", {})).data;
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("not really excel")]), "fake.xlsx");
  const r = await api("POST", `/api/imports/${id5}/files/source`, fd, 400);
  assert.match(r.data.error, /not a valid \.xlsx/);
  const fd2 = new FormData();
  fd2.append("file", new Blob([Buffer.from("hello")]), "notes.pdf");
  await api("POST", `/api/imports/${id5}/files/source`, fd2, 415);
  await api("PATCH", `/api/imports/${id5}`, { action: "cancel" });
});
await step("history, dashboard, events (audit log)", async () => {
  const h = (await api("GET", "/api/imports?limit=10")).data;
  assert.ok(h.total >= 4);
  const dash = (await api("GET", "/api/dashboard")).data;
  assert.ok(dash.stats.successfulImports >= 2);
  const ev = (await api("GET", `/api/imports/${id}/events`)).data.events.map((e) => e.action);
  for (const a of ["created", "file_uploaded", "analyzed", "cell_edited", "row_excluded", "generated", "downloaded"]) assert.ok(ev.includes(a), `event ${a}`);
});

console.log(`\nAll ${passed} steps passed. Outputs saved in ${OUT}`);
