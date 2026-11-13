"use client";

import Link from "next/link";
import { AlertTriangle, Download, FileCheck2, ShieldCheck, XCircle } from "lucide-react";
import type { ImportRecord, ProcessSummary } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { fmtDateTime, fmtNumber, useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Card, EmptyState, LoadingBlock, PageHeader, StatusBadge, buttonClass } from "@/components/ui";

type Row = ImportRecord & { summary: ProcessSummary | null };

const SHORT_LABEL = {
  report: tk("Import validation report"),
  invalid: tk("Invalid records"),
  mapping: tk("Column mapping report"),
} as const;

export default function ReportsPage() {
  const t = useT();
  const completed = useApi<{ items: Row[] }>("/api/imports?status=completed&limit=100");
  const failed = useApi<{ items: Row[] }>("/api/imports?status=failed&limit=100");
  const items = [...(completed.data?.items ?? []), ...(failed.data?.items ?? [])].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const loading = !completed.data || !failed.data;

  return (
    <div>
      <PageHeader
        title={t("Validation Reports")}
        description={t(
          "Validation results of every generated file. Download the full report, the invalid records (with a description of each problem) or the column mapping report.",
        )}
      />
      {(completed.error || failed.error) && <Alert tone="error">{completed.error ?? failed.error}</Alert>}
      {loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<FileCheck2 className="h-10 w-10" />} title={t("No reports yet")}>
            {t("Reports appear here after a final file is generated.")}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((imp) => {
            const s = imp.summary;
            const purged = Boolean(imp.filesPurgedAt);
            return (
              <Card key={imp.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/imports/${imp.id}`} className="truncate text-base font-semibold text-slate-900 hover:underline">
                        {imp.name}
                      </Link>
                      <StatusBadge status={imp.status} />
                      {imp.verification?.ok && (
                        <Badge tone="green">
                          <ShieldCheck className="h-3 w-3" /> {t("Verified")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-sm text-slate-500">
                      {fmtDateTime(imp.completedAt)} · {imp.source?.originalName} → {imp.template?.originalName}
                    </div>
                    {s && (
                      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
                        <Metric label={t("Records")} value={s.totalRows} />
                        <Metric label={t("Imported")} value={s.ready} tone="text-emerald-700" />
                        <Metric label={t("Errors")} value={s.withErrors} tone={s.withErrors ? "text-red-600" : undefined} />
                        <Metric label={t("Duplicates")} value={s.duplicates} tone={s.duplicates ? "text-amber-700" : undefined} />
                        <Metric label={t("Missing mandatory")} value={s.missingMandatory} tone={s.missingMandatory ? "text-red-600" : undefined} />
                      </div>
                    )}
                    {s && s.issues.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {s.issues.slice(0, 5).map((is) => (
                          <span
                            key={`${is.code}-${is.col}`}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${is.level === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}
                          >
                            {is.level === "error" ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            {t.msg(is.label)}: {fmtNumber(is.count)}
                          </span>
                        ))}
                        {s.issues.length > 5 && <span className="text-xs text-slate-500">{t("+{n} more", { n: s.issues.length - 5 })}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                    {purged ? (
                      <Badge tone="slate">{t("Files deleted")}</Badge>
                    ) : (
                      (["report", "invalid", "mapping"] as const).map((k) =>
                        imp.outputs.some((o) => o.kind === k) ? (
                          <a key={k} href={`/api/imports/${imp.id}/download/${k}`} className={buttonClass("secondary", "sm", "justify-start")}>
                            <Download className="h-3.5 w-3.5" /> {t(SHORT_LABEL[k])}
                          </a>
                        ) : null,
                      )
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>{fmtNumber(value)}</div>
    </div>
  );
}
