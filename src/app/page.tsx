"use client";

import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Database, FileSpreadsheet, UploadCloud, Workflow } from "lucide-react";
import type { ImportRecord } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { fmtNumber, timeAgo, useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Card, CardTitle, EmptyState, LoadingBlock, PageHeader, StatCard, StatusBadge, buttonClass } from "@/components/ui";

interface DashboardData {
  stats: { totalImports: number; successfulImports: number; inProgress: number; recordsProcessed: number; recordsImported: number; failedRecords: number };
  recent: { id: string; importId: string; name: string; action: string; details: Record<string, unknown> | null; createdAt: string }[];
  latest: ImportRecord[];
  savedMappings: number;
  retentionDays: number;
  organizationName: string;
}

const ACTION_TEXT: Record<string, string> = {
  created: tk("started a new import"),
  generated: tk("final file generated"),
  failed: tk("verification failed"),
  cancelled: tk("import cancelled"),
  files_purged: tk("stored files deleted"),
};

export default function DashboardPage() {
  const t = useT();
  const { data, error } = useApi<DashboardData>("/api/dashboard");
  return (
    <div>
      <PageHeader
        title={t("Dashboard")}
        description={data?.organizationName ? t("{org} — data imports at a glance", { org: data.organizationName }) : t("Your data imports at a glance")}
        actions={
          <Link href="/imports/new" className={buttonClass("primary")}>
            <UploadCloud className="h-4 w-4" /> {t("New Data Import")}
          </Link>
        }
      />
      {error && <Alert tone="error" title={t("The dashboard could not be loaded")}>{error}</Alert>}
      {!data && !error && <LoadingBlock />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label={t("Total imports")}
              value={fmtNumber(data.stats.totalImports)}
              hint={data.stats.inProgress ? t("{n} in progress", { n: data.stats.inProgress }) : t("none in progress")}
              icon={<FileSpreadsheet className="h-4 w-4 text-slate-400" />}
            />
            <StatCard
              label={t("Records processed")}
              value={fmtNumber(data.stats.recordsProcessed)}
              hint={t("{n} ready for import", { n: data.stats.recordsImported })}
              icon={<Database className="h-4 w-4 text-slate-400" />}
            />
            <StatCard
              label={t("Successful imports")}
              value={fmtNumber(data.stats.successfulImports)}
              tone="green"
              hint={t("final file generated & verified")}
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            />
            <StatCard
              label={t("Failed records")}
              value={fmtNumber(data.stats.failedRecords)}
              tone={data.stats.failedRecords ? "red" : "slate"}
              hint={t("with errors or excluded")}
              icon={<AlertTriangle className="h-4 w-4 text-slate-400" />}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2" padded={false}>
              <div className="flex items-center justify-between px-5 pt-5">
                <CardTitle>{t("Recent imports")}</CardTitle>
                <Link href="/history" className="text-sm font-medium text-brand-700 hover:underline">
                  {t("View all")}
                </Link>
              </div>
              {data.latest.length === 0 ? (
                <EmptyState
                  icon={<UploadCloud className="h-10 w-10" />}
                  title={t("No imports yet")}
                  action={
                    <Link href="/imports/new" className={buttonClass("primary")}>
                      {t("Start your first import")}
                    </Link>
                  }
                >
                  {t("Upload the SACCO template and your data file — the system does the rest.")}
                </EmptyState>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.latest.map((imp) => (
                    <Link key={imp.id} href={`/imports/${imp.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                      <FileSpreadsheet className="h-5 w-5 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">{imp.name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {imp.source?.originalName ?? t("No data file yet")} · {timeAgo(imp.createdAt)}
                        </div>
                      </div>
                      {imp.stats && (
                        <div className="hidden text-right text-xs sm:block">
                          <div className="font-medium text-emerald-700">{t("{n} ready", { n: imp.stats.ready })}</div>
                          {imp.stats.withErrors > 0 && <div className="text-red-600">{t("{n} errors", { n: imp.stats.withErrors })}</div>}
                        </div>
                      )}
                      <StatusBadge status={imp.status} />
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-6">
              <Card>
                <CardTitle>
                  <span className="inline-flex items-center gap-2">
                    <Activity className="h-4 w-4 text-slate-400" /> {t("Recent activity")}
                  </span>
                </CardTitle>
                {data.recent.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("No activity yet.")}</p>
                ) : (
                  <ol className="space-y-3">
                    {data.recent.slice(0, 8).map((e) => (
                      <li key={e.id} className="flex gap-3 text-sm">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.action === "generated" ? "bg-emerald-500" : e.action === "failed" ? "bg-red-500" : "bg-slate-300"}`} />
                        <div className="min-w-0">
                          <Link href={`/imports/${e.importId}`} className="font-medium text-slate-800 hover:underline">
                            {e.name}
                          </Link>{" "}
                          <span className="text-slate-500">{ACTION_TEXT[e.action] ? t(ACTION_TEXT[e.action]) : e.action}</span>
                          {e.action === "generated" && e.details && (
                            <span className="text-slate-500"> · {t("{n} records", { n: Number(e.details.ready) })}</span>
                          )}
                          <div className="text-xs text-slate-400">{timeAgo(e.createdAt)}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
              <Card>
                <CardTitle>{t("How it works")}</CardTitle>
                <ol className="space-y-3 text-sm text-slate-600">
                  <li>{t.rich("<b>1. Upload</b> the template from the SACCO system and your data file.")}</li>
                  <li>{t.rich("<b>2. Compare & validate</b> — columns are matched for you; confirm anything uncertain and fix errors.")}</li>
                  <li>{t.rich("<b>3. Download</b> a file with the template’s exact columns, ready to import.")}</li>
                </ol>
                <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <Link href="/mappings" className="inline-flex items-center gap-1 hover:text-brand-700">
                    <Workflow className="h-3.5 w-3.5" />{" "}
                    {data.savedMappings === 1 ? t("{n} saved mapping", { n: data.savedMappings }) : t("{n} saved mappings", { n: data.savedMappings })}
                  </Link>
                  <span>· {t("Files kept {n} days", { n: data.retentionDays })}</span>
                </div>
                <Link href="/imports/new" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                  {t("Start an import")} <ArrowRight className="h-4 w-4" />
                </Link>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
