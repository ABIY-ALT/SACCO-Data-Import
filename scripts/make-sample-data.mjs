// Generates realistic sample files for trying out / testing the import workflow.
//   node scripts/make-sample-data.mjs [rows]
// Writes to ./test-data:
//   sacco-member-template.xlsx   – the "official" template downloaded from the SACCO system
//   original-members.xlsx        – messy real-world data with typical problems
//   original-members.csv         – the same data as CSV
//   original-members-large.xlsx  – a large file (default 50,000 rows) for performance testing
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("test-data");
mkdirSync(OUT, { recursive: true });
const LARGE_ROWS = Number(process.argv[2] ?? 50000);

// deterministic random numbers
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ------------------------------------------------------------------ template
async function makeTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Members");
  const lists = wb.addWorksheet("Lists");
  const help = wb.addWorksheet("Instructions");
  help.getCell("A1").value = "Fill one member per row. Do not change the column headers. Fields marked * are mandatory.";
  ["Single", "Married", "Divorced", "Widowed"].forEach((v, i) => (lists.getCell(`A${i + 1}`).value = v));
  ["Head Office", "Bole", "Adama", "Hawassa"].forEach((v, i) => (lists.getCell(`B${i + 1}`).value = v));

  const headers = [
    "Member ID*", "Full Name*", "Gender", "Date of Birth (DD/MM/YYYY)", "Phone Number*", "National ID", "Email",
    "Address", "Branch", "Join Date", "Savings Balance", "Share Capital", "Loan Balance", "Marital Status",
  ];
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.columns.forEach((c, i) => (c.width = Math.max(14, headers[i].length + 2)));
  // example row (must NOT end up in the final file)
  ws.addRow(["000001", "Example Member", "M", new Date(Date.UTC(1990, 0, 31)), "0911000000", "ID-000000", "example@mail.com",
    "Addis Ababa", "Head Office", new Date(Date.UTC(2024, 5, 1)), 1000, 500, 0, "Single"]);
  ws.getCell("A2").numFmt = "@";
  ws.getCell("E2").numFmt = "@";
  ws.getCell("D2").numFmt = "dd/mm/yyyy";
  ws.getCell("J2").numFmt = "dd/mm/yyyy";
  for (const c of ["K2", "L2", "M2"]) ws.getCell(c).numFmt = "#,##0.00";
  ws.getRow(2).font = { italic: true, color: { argb: "FF808080" } };
  ws.dataValidations.add("C2:C2000", { type: "list", allowBlank: true, formulae: ['"M,F"'] });
  ws.dataValidations.add("I2:I2000", { type: "list", allowBlank: true, formulae: ["Lists!$B$1:$B$4"] });
  ws.dataValidations.add("N2:N2000", { type: "list", allowBlank: true, formulae: ["Lists!$A$1:$A$4"] });
  await wb.xlsx.writeFile(path.join(OUT, "sacco-member-template.xlsx"));
}

// ------------------------------------------------------------------ original data
const FIRST = ["Abebe", "Sara", "Hana", "Daniel", "Meron", "Samuel", "Tigist", "Yonas", "Bethlehem", "Dawit", "Selam", "Kebede", "Almaz", "Getachew", "Rahel", "Mulugeta", "Liya", "Henok", "Saron", "Tewodros"];
const LAST = ["Kebede", "Tesfaye", "Girma", "Bekele", "Alemu", "Haile", "Tadesse", "Mekonnen", "Wolde", "Desta", "Ayele", "Gebre", "Negash", "Assefa", "Mengistu"];
const BRANCH = ["Head Office", "Bole", "Adama", "Hawassa"];
const MARITAL = ["Single", "single", "Married", "MARRIED", "Divorced", "widowed", "Married "];
const CITY = ["Addis Ababa", "Adama", "Hawassa", "Bahir Dar", "Mekelle", "Dire Dawa"];

function makeRows(n, messy = true) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const id = String(100 + i).padStart(6, "0");
    const first = pick(FIRST), last = pick(LAST);
    const y = 1960 + Math.floor(rnd() * 45), m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 28);
    const jy = 2015 + Math.floor(rnd() * 11), jm = 1 + Math.floor(rnd() * 12), jd = 1 + Math.floor(rnd() * 28);
    const phoneDigits = `9${String(10000000 + Math.floor(rnd() * 89999999))}`; // 9 digits
    const savings = Math.round(rnd() * 500000) / 100 * 10;
    rows.push({
      sno: i,
      id,
      name: `${first} ${last}`,
      sex: pick(["M", "F"]),
      dob: new Date(Date.UTC(y, m - 1, d)),
      mobile: "0" + phoneDigits,
      nid: `ET${String(1000000 + i * 7)}`,
      email: `${first}.${last}${i}@example.com`.toLowerCase(),
      residence: pick(CITY),
      branch: pick(BRANCH),
      joined: new Date(Date.UTC(jy, jm - 1, jd)),
      savings,
      shares: pick([500, 1000, 1500, 2000, 5000]),
      loan: rnd() < 0.4 ? Math.round(rnd() * 20000000) / 100 : null,
      marital: pick(MARITAL),
      remarks: rnd() < 0.1 ? "Transferred from old system" : "",
    });
  }
  if (!messy) return rows;
  // --- typical real-world problems
  const r = (k) => rows[k];
  r(1).name = "  sara   TESFAYE "; // extra spaces + capitalization
  r(2).sex = "Male"; r(3).sex = "female"; r(4).sex = "FEMALE"; r(5).sex = "m"; r(6).sex = "X"; // gender variants + invalid
  r(7).dob = "15/08/1987"; r(8).dob = "1979-03-22"; r(9).dob = "31/02/1990"; r(10).dob = "03-Apr-1985"; // text dates + invalid
  r(11).dob = new Date(Date.UTC(2030, 0, 1)); // future birth date
  r(12).mobile = Number(r(12).mobile); // stored as number: leading 0 lost
  r(13).mobile = "+251 " + r(13).mobile.slice(1, 4) + " " + r(13).mobile.slice(4); // international with spaces
  r(14).mobile = "091-234"; // invalid
  r(15).mobile = r(16).mobile; // duplicate phone
  r(17).id = r(18).id; // duplicate member id
  r(19).savings = "1,500.00"; r(20).savings = "ETB 2,750.50"; r(21).savings = -350; // text amounts + negative
  r(22).savings = 1234.5678; // more than 2 decimals (warning, kept exactly)
  r(23).name = ""; // missing mandatory
  r(24).email = "not-an-email";
  r(25).id = Number(r(25).id); // numeric id (shown as 0-padded via number format)
  rows.push({ ...r(30), sno: rows.length + 1 }); // fully identical record (except S/No)
  return rows;
}

const SRC_HEADERS = ["S/No", "Membership No", "Member Name", "Sex", "DOB", "Mobile", "ID Number", "E-mail", "Residence", "Branch", "Date Joined", "Savings", "Shares", "Loan Outstanding", "Marital", "Remarks"];
const toArray = (o) => [o.sno, o.id, o.name, o.sex, o.dob, o.mobile, o.nid, o.email, o.residence, o.branch, o.joined, o.savings, o.shares, o.loan, o.marital, o.remarks];

async function makeOriginal(file, rows, opts = {}) {
  const wb = opts.streaming
    ? new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path.join(OUT, file), useStyles: true, useSharedStrings: true })
    : new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Register");
  const title = ws.addRow(["ABC SAVINGS & CREDIT COOPERATIVE – MEMBER REGISTER AS AT 31/10/2026"]);
  title.font = { bold: true, size: 13 };
  if (opts.streaming) title.commit();
  if (opts.streaming) ws.addRow([]).commit(); else ws.addRow([]);
  const h = ws.addRow(SRC_HEADERS);
  h.font = { bold: true };
  if (opts.streaming) h.commit();
  rows.forEach((o, idx) => {
    const row = ws.addRow(toArray(o));
    for (const c of [5, 11]) if (row.getCell(c).value instanceof Date) row.getCell(c).numFmt = "dd/mm/yyyy";
    row.getCell(2).numFmt = typeof o.id === "number" ? "000000" : "@";
    row.getCell(12).numFmt = "#,##0.00";
    if (opts.streaming) row.commit();
    if (!opts.streaming && idx === 40) ws.addRow([]); // a blank row in the middle
  });
  if (opts.streaming) {
    ws.commit();
    await wb.commit();
  } else await wb.xlsx.writeFile(path.join(OUT, file));
}

function makeCsv(file, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, "0")}/${String(v.getUTCMonth() + 1).padStart(2, "0")}/${v.getUTCFullYear()}`;
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [SRC_HEADERS.join(","), ...rows.map((o) => toArray(o).map(esc).join(","))];
  writeFileSync(path.join(OUT, file), "﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

await makeTemplate();
const rows = makeRows(500);
await makeOriginal("original-members.xlsx", rows);
makeCsv("original-members.csv", rows);
seed = 7;
await makeOriginal("original-members-large.xlsx", makeRows(LARGE_ROWS, false), { streaming: true });
console.log(`Sample files written to ${OUT}`);
