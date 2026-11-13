# SACCO Data Import

A web application that turns any member, savings, loan or transaction spreadsheet into the **exact Excel template** a SACCO system
expects — without Excel skills.

1. **Upload** the official template downloaded from the SACCO system (the *sample file*) and the file with the real data (the *original file*).
2. **Compare & validate** — columns are matched automatically, uncertain matches are shown for confirmation, values are cleaned and checked.
3. **Download** a file with the template's exact column names, order and sheet — plus an invalid-records file, a validation report and a
   column-mapping report.

The sample file is the source of truth for structure; the original file is the source of the data. Original files are never modified.

## Requirements

- Node.js 22+ (developed on Node 24)
- PostgreSQL 14+ (developed on PostgreSQL 18). The database is **created automatically** on first start if the configured role may create databases.

## Setup

```bash
npm install
cp .env.example .env.local      # then edit DATABASE_URL if needed
npm run dev                     # http://localhost:3000
```

`.env.local`

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection for history, saved mappings and settings | `postgresql://postgres@localhost:5432/sacco_import` |
| `STORAGE_DIR` | Folder for uploaded originals and generated files (keep it outside any public web folder) | `./storage` |

Production:

```bash
npm run build
npm start -- --port 3000 --hostname 127.0.0.1   # bind to the interface your staff should use
```

Try it with realistic sample files: `npm run sample-data` writes a template and a messy original file (title row, renamed and reordered
columns, lost leading zeros, mixed date formats, duplicates, text amounts…) to `test-data/`.

## How it keeps data safe

| Rule | How it is enforced |
|---|---|
| Template decides the structure | Output headers are copied verbatim from the template (including `*` or hints), in the same order and on the same sheet. For `.xlsx` templates the template file itself is copied and filled, so styles, dropdowns and other sheets are kept. |
| No guessing of column meaning | Only identical names, previously confirmed names and well-known SACCO names are matched automatically. Similar-looking names (e.g. *Share Balance* vs *Loan Balance*) are only *suggested* and block generation until confirmed or rejected. |
| No silent changes | Every cleaning step is listed with counts and before → after examples and can be switched off (values then return to the original). Every changed cell is in the report's *Change log*. |
| Money and IDs untouched | Amounts are never rounded; text like `1,500.00` is converted to the same number. IDs and phone numbers are written as text, so leading zeros survive. Ambiguous values (`1.234,56`, `31/02/1990`, a day/month order that contradicts the column) are reported, not guessed. |
| Nothing invented | Default values are opt-in per column; defaults in money or ID columns need explicit approval. |
| Originals preserved | Uploads get a new random name, are written once and made read-only, and are stored with their SHA-256. |
| No double imports | Uploading a file whose content was already processed shows a warning; generating again requires explicit confirmation. |
| Output verified | After generation the file is opened again and every header and cell is compared with the validated data. A failed check blocks the download. |
| Audit trail | Uploads, corrections, exclusions, generation and downloads are logged per import. |
| Retention | Files are deleted after the configured number of days (Settings); history, statistics and the audit log are kept. |

## Architecture

One Next.js 16 app (App Router, TypeScript, Tailwind CSS 4). The browser only displays data; all file work happens on the server, so large
files do not freeze the browser.

```
src/
  lib/core/          Pure logic, unit-tested: header matching, value parsing, cleaning + validation pipeline
    dictionary.ts      SACCO field names (strong = auto match, weak = suggestion only)
    analyze.ts         header-row detection, template/original column analysis, match suggestions
    values.ts          dates, numbers, phones, gender, identifiers
    pipeline.ts        mapping → cleaning → validation for every row
  lib/server/        Server-only: PostgreSQL (pg, plain SQL), file storage, Excel read (SheetJS) / write (ExcelJS), workflow service
  app/api/           Route handlers (JSON API)
  app/…, components/ Pages and UI
scripts/             Sample-data generator and end-to-end tests
```

- **SheetJS 0.20.3** (from the vendor CDN — the npm `xlsx@0.18` has known security issues) reads `.xlsx`, `.xls` (including HTML/XML
  "xls" exports) and `.csv`.
- **ExcelJS** writes the output. Files above ~400,000 cells use its streaming writer.
- Tables are created on first use (`src/lib/server/db.ts`): `imports`, `import_events`, `mapping_templates`, `learned_aliases`, `settings`.

## Tests

```bash
npm test             # unit tests for matching, parsing and validation
npm run lint
# with the app running on :3210  (npm run dev -- --port 3210)
npm run test:e2e     # full workflow through the API; re-opens the downloaded file and compares it with the original
npm run test:edge    # CSV template + .xls source, blank header row, upload limit, retention purge
npm run test:ui      # full workflow in a real browser (Microsoft Edge/Chrome); screenshots in test-data/output/screenshots
```

The end-to-end tests create imports in the configured database — run them against a test database, not production.

## Deploying on Vercel

Vercel has no permanent disk and accepts at most 4.5 MB per request, so on Vercel the app keeps all files in a **private
Vercel Blob store** (browsers upload large files straight to it) and uses an online **Postgres** database (Neon). Nothing else
changes; without `BLOB_READ_WRITE_TOKEN` the app keeps using the local `storage` folder.

1. Install the CLI if needed (`npm i -g vercel`), then in this folder: `vercel login` and `vercel link` (creates the project).
2. In the Vercel dashboard → the project → **Storage**:
   - **Create Database → Neon (Postgres)**, region **Frankfurt (eu-central-1)**, connect it to all environments. This sets `DATABASE_URL`.
     The tables are created automatically on first use.
   - **Create → Blob**, choose **Private** access, connect it to all environments. This sets `BLOB_READ_WRITE_TOKEN`.
3. Deploy: `vercel --prod`.

`vercel.json` runs the functions in Frankfurt (`fra1`), close to the database. `.vercelignore` keeps `storage/`, `test-data/` and
`.env*` files out of the upload. Heavy API routes allow up to 300 seconds (`maxDuration`); lower it if your plan allows less.

⚠ The app has **no login**. On Vercel it is reachable from the internet — do not share the link until a password is added.

## Language (Amharic / English)

The screens, messages and reports are in **Amharic** by default. Each user can switch between **አማርኛ** and **English** in the side menu
or on the Settings page (the choice is remembered in that browser). Reports are written in the language the user had when generating the
file. Data is never translated: the final file keeps the template's own headers and values exactly.

All Amharic texts are in `src/lib/i18n/am.ts`, keyed by the English text in the code — to improve a wording, change only the Amharic text
(keep `{…}` placeholders and `<b>…</b>` marks). `npm test` fails if a text on a screen has no Amharic entry or a placeholder is missing.

## Notes and limits

- There is **no login**. Run it on an internal network or behind your existing authentication/reverse proxy.
- Phone validation uses the country code and number length from Settings (default Ethiopia, +251, 9 digits after the 0).
- Dates are converted from the Gregorian calendar only (no Ethiopian-calendar conversion).
- Multi-row headers and merged header cells are not supported; choose the single header row on the upload step.
