"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, FileText, Repeat, ShieldCheck, Trash2, UploadCloud, XCircle } from "lucide-react";
import type { ImportDetailResponse, ImportEvent, OutputKind } from "@/lib/types";
import { APPROVAL_BLOCK, OUTPUT_LABELS } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { ApiError, apiSend, fmtBytes, fmtDateTime, useApi } from "@/lib/client/api";
import { useT, type T } from "@/components/i18n";
import { Alert, Badge, Button, Card, CardTitle, Field, Modal, buttonClass, inputCls } from "@/components/ui";
import { SummaryStats } from "./validation-step";

export function DownloadStage({
  detail,
  onGenerated,
  onBack,
}: {
  detail: ImportDetailResponse;
  onGenerated: (d: ImportDetailResponse) => void;
  onBack: () => void;
}) {
  const imp = detail.import;
  // After a failed verification the file can be generated again (e.g. once the cause has been fixed).
  const [retry, setRetry] = useState(false);
  const done = imp.status === "completed" || (imp.status === "failed" && !retry);
  const generated = (d: ImportDetailResponse) => {
    setRetry(false);
    onGenerated(d);
  };
  return done ? (
    <Results detail={detail} onChanged={onGenerated} onRetry={imp.status === "failed" ? () => setRetry(true) : undefined} />
  ) : (
    <Generate detail={detail} onGenerated={generated} onBack={onBack} />
  );
}

function Check({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : warn ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      )}
      <span className="text-slate-700">{children}</span>
    </li>
  );
}

function Generate({ detail, onGenerated, onBack }: { detail: ImportDetailResponse; onGenerated: (d: ImportDetailResponse) => void; onBack: () => void }) {
  const t = useT();
  const imp = detail.import;
  const s = imp.summary!;
  const config = imp.config!;
  const applied =
    config.appliedMappingTemplateId && !config.appliedMappingTemplateId.startsWith("import:") ? detail.mappingOptions.find((m) => m.id === config.appliedMappingTemplateId) : undefined;
  const [saveMapping, setSaveMapping] = useState(true);
  const [mappingName, setMappingName] = useState(applied?.name ?? `${imp.template?.originalName.replace(/\.(xlsx|xls|csv)$/i, "")} mapping`);
  const [updateExisting, setUpdateExisting] = useState(Boolean(applied));
  const [confirmDup, setConfirmDup] = useState(false);
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);

  // The approval itself is given on this page (checkbox below), so it does not block the button.
  const otherBlocking = s.blocking.filter((b) => b !== APPROVAL_BLOCK);
  const needApproval = s.approvalsNeeded.length > 0;
  const dup = detail.duplicateOf.length > 0;
  const canGenerate = otherBlocking.length === 0 && (!needApproval || approve) && (!dup || confirmDup);
  const fillMode = config.mode === "fill";
  const pendingMatches = config.mappings.filter((m) => m.status === "possible" && !m.confirmed && m.source !== null && !(fillMode && m.useTemplate)).length;
  // Fill mode: columns without original data keep the template's values, so nothing mandatory is missing.
  const missingRequired = fillMode ? 0 : config.mappings.filter((m) => m.rule.required && m.source === null && m.defaultValue === "").length;
  const notIncluded = s.totalRows - s.ready;

  async function generate() {
    setBusy(true);
    setError(null);
    setBlocking([]);
    try {
      const d = await apiSend<ImportDetailResponse>("POST", `/api/imports/${imp.id}/generate`, {
        confirmDuplicate: confirmDup,
        approveDefaults: approve,
        saveMapping: { save: saveMapping, name: mappingName, updateExisting },
        lang: t.lang,
      });
      onGenerated(d);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (Array.isArray(err.details?.blocking)) setBlocking(err.details.blocking as string[]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <SummaryStats s={s} />
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardTitle sub={t("Everything is checked again on the server when you generate the file.")}>{t("Final check")}</CardTitle>
          <ul className="space-y-2.5">
            <Check ok={missingRequired === 0}>
              {missingRequired === 0 ? t("Every mandatory template column has data") : t("{n} mandatory column(s) have no data", { n: missingRequired })}
            </Check>
            <Check ok={pendingMatches === 0}>
              {pendingMatches === 0 ? t("All column matches are confirmed") : t("{n} possible match(es) still need confirmation", { n: pendingMatches })}
            </Check>
            <Check ok={s.ready > 0}>
              {t.rich("<b>{n}</b> record(s) will be written to the final file, using the template’s exact column names and order", { n: s.ready })}
            </Check>
            {s.withErrors + s.excluded > 0 && (
              <Check ok={false} warn>
                {t.rich(
                  "<b>{n}</b> record(s) with errors or excluded by you will not be included. They go to the “invalid records” file with a description of each problem, so they can be fixed and imported later.",
                  { n: notIncluded },
                )}
              </Check>
            )}
            <Check ok>{t("Money amounts and IDs are written exactly as validated (leading zeros kept)")}</Check>
            <Check ok={!dup} warn>
              {dup ? t("This original file was processed before (see below)") : t("This original file has not been processed before")}
            </Check>
          </ul>
          {otherBlocking.length > 0 && (
            <Alert tone="error" className="mt-4" title={t("Cannot generate yet")}>
              <ul className="list-disc pl-5">
                {otherBlocking.map((b, i) => (
                  <li key={i}>{t.msg(b)}</li>
                ))}
              </ul>
              <button className="mt-2 font-medium underline" onClick={onBack}>
                {t("Go back to Compare & Validate")}
              </button>
            </Alert>
          )}
        </Card>

        <Card className="space-y-4">
          <CardTitle>{t("Options")}</CardTitle>
          {needApproval && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">{t("Approval needed")}</div>
              <ul className="mt-1 list-disc pl-5">
                {s.approvalsNeeded.map((a, i) => (
                  <li key={i}>{t.msg(a)}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="accent-amber-600" /> {t("I approve these items")}
              </label>
            </div>
          )}
          {dup && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">{t("This file was already processed")}</div>
              {detail.duplicateOf.slice(0, 2).map((d) => (
                <div key={d.id}>
                  <Link className="underline" href={`/imports/${d.id}`}>
                    “{d.name}”
                  </Link>{" "}
                  ({fmtDateTime(d.completedAt)})
                </div>
              ))}
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} className="accent-amber-600" data-testid="confirm-duplicate" />{" "}
                {t("I understand — process it again")}
              </label>
            </div>
          )}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input type="checkbox" checked={saveMapping} onChange={(e) => setSaveMapping(e.target.checked)} className="accent-brand-600" />{" "}
              {t("Remember this mapping for future imports")}
            </label>
            {saveMapping && (
              <>
                <Field label={t("Mapping name")}>
                  <input className={inputCls} value={mappingName} onChange={(e) => setMappingName(e.target.value)} />
                </Field>
                {applied && (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} className="accent-brand-600" />{" "}
                    {t("Update the saved mapping “{name}” (instead of saving a new one)", { name: applied.name })}
                  </label>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {error && (
        <Alert tone="error" title={error}>
          {blocking.length > 0 && (
            <ul className="list-disc pl-5">
              {blocking.map((b, i) => (
                <li key={i}>{t.msg(b)}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <div className="flex flex-col items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/60 p-6 text-center">
        <FileSpreadsheet className="h-10 w-10 text-brand-600" />
        <div className="text-lg font-semibold text-slate-900">{t("Generate the final Excel file")}</div>
        <p className="max-w-xl text-sm text-slate-600">
          {t(
            "The file uses the exact column names, order and sheet of “{file}”. After it is created it is opened again and checked automatically, cell by cell. The reports are written in the language you are using now.",
            { file: imp.template?.originalName ?? "" },
          )}
        </p>
        <Button variant="primary" size="lg" className="mt-2" disabled={!canGenerate} loading={busy} onClick={generate} icon={<Download className="h-5 w-5" />}>
          {busy ? t("Generating and verifying…") : t("Generate Final Excel File")}
        </Button>
      </div>
    </div>
  );
}

const KIND_ICON: Record<OutputKind, typeof FileSpreadsheet> = {
  final: FileSpreadsheet,
  final_csv: FileText,
  invalid: AlertTriangle,
  report: ShieldCheck,
  mapping: FileText,
};

function Results({ detail, onChanged, onRetry }: { detail: ImportDetailResponse; onChanged: (d: ImportDetailResponse) => void; onRetry?: () => void }) {
  const t = useT();
  const imp = detail.import;
  const router = useRouter();
  const v = imp.verification;
  const failed = imp.status === "failed" || (v && !v.ok);
  const purged = Boolean(imp.filesPurgedAt);
  const [repeating, setRepeating] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const final = imp.outputs.find((o) => o.kind === "final");
  const others = imp.outputs.filter((o) => o.kind !== "final");

  async function repeat() {
    setRepeating(true);
    try {
      const r = await apiSend<{ id: string }>("POST", `/api/imports/${imp.id}/repeat`, { withSource: false });
      router.push(`/imports/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setRepeating(false);
    }
  }

  return (
    <div className="space-y-5">
      {failed ? (
        <Alert
          tone="error"
          title={t("The generated file did not pass verification")}
          action={
            onRetry &&
            !purged && (
              <Button size="sm" variant="secondary" icon={<Repeat className="h-3.5 w-3.5" />} onClick={onRetry}>
                {t("Generate the file again")}
              </Button>
            )
          }
        >
          {t("The final file is blocked for download. Please download the validation report and contact support.")}{" "}
          {onRetry && !purged && t("If the cause has been fixed, you can generate the file again.")}
        </Alert>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div className="flex-1">
            <div className="text-xl font-semibold text-slate-900">{t("Your file is ready for import")}</div>
            <div className="text-sm text-slate-600">
              {t("{n} records · generated {date} · verified against the template", { n: imp.stats?.ready ?? 0, date: fmtDateTime(imp.completedAt) })}
            </div>
          </div>
          {final && !purged && (
            <a href={`/api/imports/${imp.id}/download/final`} data-testid="download-final-hero" className={buttonClass("primary", "lg")}>
              <Download className="h-5 w-5" /> {t("Download Final Excel")}
            </a>
          )}
        </div>
      )}

      {purged && (
        <Alert tone="info">
          {t("The files of this import were deleted on {date} (retention policy). The history and statistics are kept.", { date: fmtDateTime(imp.filesPurgedAt) })}
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle sub={t("The downloaded file was opened again and compared with the validated data.")}>{t("Automatic verification")}</CardTitle>
          {v ? (
            <ul className="space-y-2.5">
              {v.checks.map((c, i) => (
                <Check key={i} ok={c.ok}>
                  {t.msg(c.label)}
                  {c.detail && <div className="text-xs text-red-600">{t.msg(c.detail)}</div>}
                </Check>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{t("No verification information.")}</p>
          )}
        </Card>
        <Card>
          <CardTitle>{t("Downloads")}</CardTitle>
          <div className="space-y-2">
            {[...(final ? [final] : []), ...others].map((o) => {
              const Icon = KIND_ICON[o.kind];
              const blocked = purged || (failed && (o.kind === "final" || o.kind === "final_csv"));
              const rows = o.kind === "invalid" || o.kind.startsWith("final") ? (o.rows === 1 ? t("{n} record", { n: 1 }) : t("{n} records", { n: o.rows })) : null;
              return (
                <div key={o.kind} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                  <Icon className={`h-5 w-5 shrink-0 ${o.kind === "invalid" ? "text-amber-500" : "text-brand-600"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{t(OUTPUT_LABELS[o.kind])}</div>
                    <div className="truncate text-xs text-slate-500">{[rows, fmtBytes(o.size)].filter(Boolean).join(" · ")}</div>
                  </div>
                  {blocked ? (
                    <Badge tone="slate">{t("Unavailable")}</Badge>
                  ) : (
                    <a href={`/api/imports/${imp.id}/download/${o.kind}`} data-testid={`download-${o.kind}`} className={buttonClass("secondary", "sm")}>
                      <Download className="h-3.5 w-3.5" /> {t("Download")}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {imp.summary && <SummaryStats s={imp.summary} />}

      <div className="flex flex-wrap gap-2">
        <Link href="/imports/new" className={buttonClass("primary")}>
          <UploadCloud className="h-4 w-4" /> {t("Start a new import")}
        </Link>
        {!purged && (
          <Button loading={repeating} onClick={repeat} icon={<Repeat className="h-4 w-4" />}>
            {t("Repeat with the same template & mapping")}
          </Button>
        )}
        {!purged && (
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setPurgeOpen(true)}>
            {t("Delete stored files")}
          </Button>
        )}
      </div>

      <ActivityLog importId={imp.id} />

      <Modal
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title={t("Delete stored files?")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurgeOpen(false)}>
              {t("Keep files")}
            </Button>
            <Button
              variant="danger"
              loading={purging}
              onClick={async () => {
                setPurging(true);
                try {
                  onChanged(await apiSend<ImportDetailResponse>("POST", `/api/imports/${imp.id}/purge`));
                  setPurgeOpen(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setPurging(false);
                }
              }}
            >
              {t("Delete files")}
            </Button>
          </>
        }
      >
        {t("The uploaded originals and generated files of this import will be deleted from the server. The import history, statistics and audit log are kept. This cannot be undone.")}
      </Modal>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: tk("Import created"),
  file_uploaded: tk("File uploaded"),
  file_settings_changed: tk("Sheet / header row changed"),
  analyzed: tk("Files compared"),
  cell_edited: tk("Value corrected"),
  cell_reverted: tk("Correction undone"),
  cell_source_changed: tk("Value source chosen"),
  bulk_fix: tk("Many rows changed at once"),
  row_excluded: tk("Record excluded"),
  row_included: tk("Record included again"),
  generated: tk("Final file generated and verified"),
  failed: tk("Generated file failed verification"),
  downloaded: tk("File downloaded"),
  cancelled: tk("Import cancelled"),
  files_purged: tk("Stored files deleted"),
  repeat_of: tk("Started as a repeat"),
};

function describe(e: ImportEvent, t: T): string {
  const d = e.details ?? {};
  const s = (v: unknown) => String(v ?? "");
  switch (e.action) {
    case "file_uploaded":
      return (
        `${d.role === "template" ? t("Template") : t("Original file")}: ${s(d.name)} (${fmtBytes(Number(d.size))})` +
        (d.replaced ? `, ${t("replaced {name}", { name: s(d.replaced) })}` : "")
      );
    case "cell_edited":
      return t("Row {row}, {col}: “{from}” → “{to}” (original “{orig}”)", { row: s(d.row), col: s(d.column), from: s(d.from), to: s(d.to), orig: s(d.original) });
    case "cell_source_changed":
      return t("Row {row}, {col}: value from {_source}", {
        row: s(d.row),
        col: d.column === "(whole row)" ? t("(whole row)") : s(d.column),
        _source: d.to === "template" ? t("the template") : d.to === "original" ? t("the original file") : t("the column setting"),
      });
    case "cell_reverted":
    case "row_excluded":
    case "row_included":
      return t("Row {row}", { row: s(d.row) }) + (d.column ? `, ${d.column === "(all)" ? t("(all)") : s(d.column)}` : "");
    case "generated":
      return (
        t("{n} records ready, {e} with errors", { n: Number(d.ready), e: Number(d.errors) }) +
        (d.duplicateConfirmed ? ` · ${t("duplicate file confirmed by user")}` : "") +
        (d.savedMapping ? ` · ${t("mapping saved as “{name}”", { name: s(d.savedMapping) })}` : "")
      );
    case "downloaded":
      return s(d.fileName);
    case "analyzed":
      return (
        t("{a} template columns, {b} original columns, {c} matched", { a: s(d.templateColumns), b: s(d.sourceColumns), c: s(d.matched) }) +
        (d.savedMapping ? ` · ${t("saved mapping “{name}”", { name: s(d.savedMapping) })}` : "")
      );
    case "files_purged":
      return d.reason === "retention" ? t("By the retention policy") : t("By a user");
    case "bulk_fix":
      return [t("{n} rows", { n: Number(d.rows) }), d.column ? s(d.column) : "", d.problem ? t.msg(s(d.problem)) : "", d.find !== null && d.find !== undefined ? `“${s(d.find)}” → “${s(d.value)}”` : d.value ? `→ “${s(d.value)}”` : ""]
        .filter(Boolean)
        .join(" · ");
    default:
      return "";
  }
}

export function ActivityLog({ importId }: { importId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const events = useApi<{ events: ImportEvent[] }>(open ? `/api/imports/${importId}/events` : null);
  return (
    <Card padded={false}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        <span className="text-base font-semibold text-slate-900">{t("Activity log (audit trail)")}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200">
          {(events.data?.events ?? []).map((e) => (
            <div key={e.id} className="flex gap-4 border-b border-slate-100 px-5 py-2.5 text-sm last:border-0">
              <span className="w-40 shrink-0 text-xs text-slate-400">{fmtDateTime(e.createdAt)}</span>
              <span className="font-medium text-slate-700">{EVENT_LABEL[e.action] ? t(EVENT_LABEL[e.action]) : e.action}</span>
              <span className="min-w-0 truncate text-slate-500">{describe(e, t)}</span>
            </div>
          ))}
          {events.loading && <div className="px-5 py-3 text-sm text-slate-500">{t("Loading…")}</div>}
        </div>
      )}
    </Card>
  );
}
