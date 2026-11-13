// Edge cases through the API: CSV template + legacy .xls source, blank header row, upload size limit, retention purge.
//   node scripts/e2e-edge-cases.mjs   (needs the app on :3210 and the psql client for the retention check)
import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

const BASE = process.argv[2] ?? "http://localhost:3210";
async function api(method, url, body, expect = 200) {
  const res = await fetch(BASE + url, {
    method,
    headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (res.status !== expect) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}
const up = (id, role, name, buf) => {
  const fd = new FormData();
  fd.append("file", new Blob([buf]), name);
  return api("POST", `/api/imports/${id}/files/${role}`, fd);
};

// 1. CSV template + legacy .xls original
const csvTemplate = "﻿MemberNo,FirstName,LastName,Sex,Mobile,OpeningBalance\r\n";
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Member Number", "First Name", "Surname", "Gender", "Phone", "Opening Balance"],
  ["00501", "Alemu", "Bekele", "Male", 911223344, "2,500.00"],
  ["00502", "Sara", "Haile", "F", "0922334455", 1000],
]), "Data");
const xls = XLSX.write(wb, { type: "buffer", bookType: "biff8" });
writeFileSync("test-data/output/legacy.xls", xls);

const { id } = await api("POST", "/api/imports", { name: "Edge: csv template + xls source" });
await up(id, "template", "template.csv", Buffer.from(csvTemplate, "utf8"));
const src = await up(id, "source", "legacy.xls", xls);
assert.equal(src.file.ext, "xls");
const d = await api("POST", `/api/imports/${id}/analyze`, {});
const labels = d.import.config.mappings.map((m) => [d.import.analysis.targets[m.target].label, m.source === null ? null : d.import.analysis.sources[m.source].label, m.status, m.confirmed]);
console.log("CSV template mapping:", JSON.stringify(labels));
for (const m of d.import.config.mappings) m.confirmed = true;
const p = await api("POST", `/api/imports/${id}/process`, { config: d.import.config });
assert.deepEqual(p.summary.blocking, []);
const g = await api("POST", `/api/imports/${id}/generate`, { confirmDuplicate: true });
assert.ok(g.import.verification.ok, JSON.stringify(g.import.verification));
console.log("notes:", g.notes);
const csvOut = (await api("GET", `/api/imports/${id}/download/final_csv`)).toString("utf8");
console.log("final CSV:\n" + csvOut);
const out = XLSX.read(await api("GET", `/api/imports/${id}/download/final`), { type: "buffer" });
console.log("final xlsx rows:", JSON.stringify(XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1, raw: false })));

// 2. a header row that has no headers gives a clear error
const { id: id2 } = await api("POST", "/api/imports", {});
await up(id2, "template", "sacco-member-template.xlsx", readFileSync("test-data/sacco-member-template.xlsx"));
await up(id2, "source", "original-members.xlsx", readFileSync("test-data/original-members.xlsx"));
await api("PATCH", `/api/imports/${id2}/files/source`, { headerRow: 2 }); // blank row
const blank = await api("POST", `/api/imports/${id2}/analyze`, {});
console.log("blank header row →", blank.import.analysis.sourceIssues[0]);
assert.match(blank.import.analysis.sourceIssues[0], /has no column names/);

// 3. upload size limit from settings
const before = (await api("GET", "/api/settings")).settings;
await api("PUT", "/api/settings", { ...before, maxUploadMb: 1 });
const big = await fetch(`${BASE}/api/imports/${id2}/files/source`, { method: "POST", body: (() => { const fd = new FormData(); fd.append("file", new Blob([readFileSync("test-data/original-members-large.xlsx")]), "big.xlsx"); return fd; })() });
console.log("over limit →", big.status, (await big.json()).error);
await api("PUT", "/api/settings", before);

// 4. retention: age an import, run cleanup, files gone, history kept
execSync(`psql -U postgres -h localhost -w -d sacco_import -c "update imports set created_at = now() - interval '400 days' where id = '${id}'"`);
const r = await api("POST", "/api/maintenance/retention");
console.log("retention purged:", r.purged);
const after = await api("GET", `/api/imports/${id}`);
assert.ok(after.import.filesPurgedAt, "files purged");
assert.equal(after.import.status, "completed", "history kept");
await api("GET", `/api/imports/${id}/download/final`, undefined, 410);
console.log("download after purge → 410 ✔");
console.log("\nEdge cases passed.");
