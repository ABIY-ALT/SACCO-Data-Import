"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { ArrowRight, CheckCircle2, Eye, FileSpreadsheet, RefreshCw, UploadCloud, X } from "lucide-react";
import type { DuplicateRef, FileRole, ImportDetailResponse, UploadedFile } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { ApiError, apiSend, fmtBytes, fmtDateTime, uploadFile, uploadFileViaBlob, useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Button, Card, Field, ProgressBar, inputCls, inputClass } from "@/components/ui";

type SlotState =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; size: number; progress: number; abort: () => void }
  | { kind: "finishing"; name: string; size: number; storedName: string }
  | { kind: "error"; message: string };

const ROLE_TEXT: Record<FileRole, { title: string; sub: string }> = {
  template: {
    title: tk("1. Sample template"),
    sub: tk("The Excel template downloaded from your SACCO system. It decides the final columns, their names and their order."),
  },
  source: {
    title: tk("2. Original data file"),
    sub: tk("The file with the actual data (members, savings, loans…). Column names and order can be different."),
  },
};

export function UploadStage({
  importId,
  detail,
  maxUploadMb,
  uploadMode = "server",
  ensureImport,
  onChanged,
  onAnalyze,
  analyzing,
  analyzeError,
}: {
  importId: string | null;
  detail: ImportDetailResponse | null;
  maxUploadMb: number;
  /** "blob": the browser uploads straight to Vercel Blob (on Vercel); "server": through this server. */
  uploadMode?: "blob" | "server";
  ensureImport: () => Promise<string>;
  onChanged: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
  analyzeError: string | null;
}) {
  const t = useT();
  const imp = detail?.import ?? null;
  const [dupes, setDupes] = useState<DuplicateRef[] | null>(null);
  const duplicateOf = dupes ?? detail?.duplicateOf ?? [];
  const bothReady = Boolean(imp?.template && imp?.source);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {(["template", "source"] as const).map((role) => (
          <FileSlot
            key={role}
            role={role}
            importId={importId}
            file={role === "template" ? (imp?.template ?? null) : (imp?.source ?? null)}
            maxUploadMb={maxUploadMb}
            uploadMode={uploadMode}
            ensureImport={ensureImport}
            onUploaded={(d) => {
              if (role === "source") setDupes(d);
              onChanged();
            }}
          />
        ))}
      </div>

      {duplicateOf.length > 0 && (
        <Alert tone="warning" title={t("This original file was already processed before")}>
          {t("The same file (identical content) was used in:")}{" "}
          {duplicateOf.slice(0, 2).map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link className="font-medium underline" href={`/imports/${d.id}`}>
                “{d.name}”
              </Link>{" "}
              ({fmtDateTime(d.completedAt)})
            </span>
          ))}
          {duplicateOf.length > 2 && ` ${t("and {n} more", { n: duplicateOf.length - 2 })}`}.{" "}
          {t("Importing it again could create duplicate records in the SACCO system. You can continue, but you will be asked to confirm.")}
        </Alert>
      )}

      {analyzeError && <Alert tone="error" title={t("The files could not be compared")}>{analyzeError}</Alert>}

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {bothReady ? t("Both files are uploaded. Next, the columns of the two files are compared.") : t("Upload both files to continue.")}
        </p>
        <Button variant="primary" size="lg" disabled={!bothReady} loading={analyzing} onClick={onAnalyze} icon={!analyzing && <ArrowRight className="h-5 w-5" />}>
          {analyzing ? t("Comparing files…") : t("Compare & Validate")}
        </Button>
      </div>
    </div>
  );
}

function FileSlot({
  role,
  importId,
  file,
  maxUploadMb,
  uploadMode,
  ensureImport,
  onUploaded,
}: {
  role: FileRole;
  importId: string | null;
  file: UploadedFile | null;
  maxUploadMb: number;
  uploadMode: "blob" | "server";
  ensureImport: () => Promise<string>;
  onUploaded: (duplicateOf: DuplicateRef[]) => void;
}) {
  const t = useT();
  const [state, setState] = useState<SlotState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const text = ROLE_TEXT[role];

  async function start(f: File) {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!ext || !["xlsx", "xls", "csv"].includes(ext)) {
      setState({ kind: "error", message: t('"{name}" is not supported. Please choose an Excel (.xlsx, .xls) or CSV file.', { name: f.name }) });
      return;
    }
    if (f.size > maxUploadMb * 1024 * 1024) {
      setState({
        kind: "error",
        message: t('"{name}" is {size}. The maximum upload size is {max} MB (it can be changed in Settings).', { name: f.name, size: fmtBytes(f.size), max: maxUploadMb }),
      });
      return;
    }
    if (f.size === 0) {
      setState({ kind: "error", message: t('"{name}" is empty.', { name: f.name }) });
      return;
    }
    let id: string;
    try {
      id = await ensureImport();
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
      return;
    }
    type Result = { file: UploadedFile; duplicateOf: DuplicateRef[] };
    const onProgress = (p: number) => setState((s) => (s.kind === "uploading" ? { ...s, progress: p } : s));
    const url = `/api/imports/${id}/files/${role}`;
    const up = uploadMode === "blob" ? uploadFileViaBlob<Result>(url, id, role, f, onProgress) : uploadFile<Result>(url, f, onProgress);
    setState({ kind: "uploading", name: f.name, size: f.size, progress: 0, abort: up.abort });
    try {
      const res = await up.promise;
      // keep showing the progress card until the refreshed import details include the new file
      setState({ kind: "finishing", name: f.name, size: f.size, storedName: res.file.storedName });
      onUploaded(res.duplicateOf);
    } catch (e) {
      const err = e as ApiError;
      setState(err.status === 499 ? { kind: "idle" } : { kind: "error", message: err.message });
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void start(f);
  }

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept=".xlsx,.xls,.csv"
      className="hidden"
      data-testid={`file-input-${role}`}
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void start(f);
      }}
    />
  );

  return (
    <Card className="flex flex-col">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">{t(text.title)}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{t(text.sub)}</p>
      </div>
      {picker}
      {state.kind === "uploading" || (state.kind === "finishing" && file?.storedName !== state.storedName) ? (
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-8 w-8 shrink-0 text-brand-600" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-800">{state.name}</div>
              <div className="text-xs text-slate-500">
                {fmtBytes(state.size)} ·{" "}
                {state.kind === "uploading" && state.progress < 1
                  ? t("Uploading {p}%", { p: Math.round(state.progress * 100) })
                  : state.kind === "uploading"
                    ? t("Reading the file…")
                    : t("Uploaded — loading details…")}
              </div>
            </div>
            {state.kind === "uploading" && (
              <Button size="sm" variant="ghost" onClick={state.abort} icon={<X className="h-4 w-4" />}>
                {t("Cancel")}
              </Button>
            )}
          </div>
          <div className="mt-3">
            <ProgressBar value={state.kind === "uploading" ? state.progress : 1} indeterminate={state.kind === "uploading" && state.progress >= 1} />
          </div>
        </div>
      ) : file && importId ? (
        <UploadedCard role={role} importId={importId} file={file} onReplace={() => inputRef.current?.click()} onDrop={onDrop} onChanged={() => onUploaded([])} />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid={`dropzone-${role}`}
          className={`flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
          }`}
        >
          <UploadCloud className={`mb-3 h-10 w-10 ${dragging ? "text-brand-600" : "text-slate-400"}`} />
          <span className="text-sm font-medium text-slate-800">{t.rich("Drag & drop the file here, or <b>browse</b>")}</span>
          <span className="mt-1 text-xs text-slate-500">{t("Excel (.xlsx, .xls) or CSV · up to {max} MB", { max: maxUploadMb })}</span>
        </button>
      )}
      {state.kind === "error" && (
        <Alert
          tone="error"
          className="mt-3"
          action={
            <button onClick={() => setState({ kind: "idle" })} aria-label={t("Dismiss")}>
              <X className="h-4 w-4" />
            </button>
          }
        >
          {state.message}
        </Alert>
      )}
    </Card>
  );
}

function UploadedCard({
  role,
  importId,
  file,
  onReplace,
  onDrop,
  onChanged,
}: {
  role: FileRole;
  importId: string;
  file: UploadedFile;
  onReplace: () => void;
  onDrop: (e: DragEvent) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useApi<{ rows: string[][]; headerRow: number; headers: string[] }>(
    `/api/imports/${importId}/files/${role}?k=${file.storedName}-${file.sheet}-${file.headerRow}`,
  );
  const headers = (preview.data?.headers ?? []).map((h) => h.trim()).filter(Boolean);

  async function change(body: { sheet?: string; headerRow?: number }) {
    setSaving(true);
    setError(null);
    try {
      await apiSend("PATCH", `/api/imports/${importId}/files/${role}`, body);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const maxHeaderRow = Math.min(20, file.sheets.find((s) => s.name === file.sheet)?.rowCount ?? 20);
  return (
    <div className="space-y-3" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
        <FileSpreadsheet className="h-8 w-8 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900" title={file.originalName}>
            {file.originalName}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span>{fmtBytes(file.size)}</span>·<span>.{file.ext}</span>·
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t("Uploaded")}
            </span>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onReplace} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          {t("Replace")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {file.sheets.length > 1 ? (
          <Field label={t("Sheet")}>
            <select className={inputCls} value={file.sheet} disabled={saving} onChange={(e) => change({ sheet: e.target.value })}>
              {file.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({t("{n} rows", { n: s.rowCount })})
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={t("Sheet")}>
            <div className={inputClass({ bg: "bg-slate-50", extra: "flex items-center" })}>{file.sheet}</div>
          </Field>
        )}
        <Field
          label={t("Column headers are on row")}
          hint={file.headerRow === file.headerRowDetected ? t("Detected automatically") : t("Detected: row {n}", { n: file.headerRowDetected })}
        >
          <select className={inputCls} value={file.headerRow} disabled={saving} onChange={(e) => change({ headerRow: Number(e.target.value) })} data-testid={`header-row-${role}`}>
            {Array.from({ length: Math.max(maxHeaderRow, file.headerRow) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {t("Row {n}", { n })}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="slate">{file.columnCount === 1 ? t("{n} column", { n: 1 }) : t("{n} columns", { n: file.columnCount })}</Badge>
        <Badge tone="slate">{file.dataRowCount === 1 ? t("{n} data row", { n: 1 }) : t("{n} data rows", { n: file.dataRowCount })}</Badge>
        <button type="button" onClick={() => setShowPreview((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <Eye className="h-3.5 w-3.5" /> {showPreview ? t("Hide first rows") : t("Show first rows")}
        </button>
      </div>

      {headers.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">{t("Column headers found")}</div>
          <div className="flex flex-wrap gap-1.5">
            {headers.slice(0, 18).map((h, i) => (
              <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {h}
              </span>
            ))}
            {headers.length > 18 && <span className="text-xs text-slate-500">{t("+{n} more", { n: headers.length - 18 })}</span>}
          </div>
        </div>
      )}

      {showPreview && preview.data && (
        <div className="scroll-thin max-h-64 overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <tbody>
              {preview.data.rows.map((r, i) => (
                <tr key={i} className={i + 1 === file.headerRow ? "bg-brand-50 font-semibold text-brand-900" : i + 1 < file.headerRow ? "text-slate-400" : ""}>
                  <td className="sticky left-0 border-r border-slate-200 bg-slate-50 px-2 py-1 text-right text-slate-400">{i + 1}</td>
                  {r.slice(0, 12).map((c, j) => (
                    <td key={j} className="max-w-40 truncate border-b border-slate-100 px-2 py-1 whitespace-nowrap">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
