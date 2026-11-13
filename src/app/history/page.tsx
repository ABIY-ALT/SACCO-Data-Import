"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, History, Repeat, Search } from "lucide-react";
import type { ImportRecord } from "@/lib/types";
import { apiSend, fmtDateTime, fmtNumber, useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Button, Card, EmptyState, LoadingBlock, PageHeader, StatusBadge, buttonClass, inputCls, inputClass } from "@/components/ui";

const PAGE = 25;

export default function HistoryPage() {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const { data, error: loadError } = useApi<{ items: ImportRecord[]; total: number }>(
    `/api/imports?status=${status}&q=${encodeURIComponent(query)}&limit=${PAGE}&offset=${offset}`,
  );

  async function repeat(id: string) {
    setBusy(id);
    setError(null);
    try {
      const r = await apiSend<{ id: string }>("POST", `/api/imports/${id}/repeat`, { withSource: false });
      router.push(`/imports/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("Import History")}
        description={t("Every import is kept here for auditing — including cancelled ones. Open an import to see its files, reports and activity log.")}
        actions={
          <Link href="/imports/new" className={buttonClass("primary")}>
            {t("New Data Import")}
          </Link>
        }
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={inputClass({ px: "pl-9 pr-3" })}
              placeholder={t("Search by import or file name")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <select
            className={`${inputCls} sm:w-56`}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
            aria-label={t("Status")}
          >
            <option value="all">{t("All statuses")}</option>
            <option value="completed">{t("Completed")}</option>
            <option value="mapping">{t("In progress")}</option>
            <option value="draft">{t("Uploading files")}</option>
            <option value="cancelled">{t("Cancelled")}</option>
            <option value="failed">{t("Failed verification")}</option>
          </select>
        </div>
        {(error || loadError) && (
          <div className="p-4">
            <Alert tone="error">{error ?? loadError}</Alert>
          </div>
        )}
        {!data ? (
          <LoadingBlock />
        ) : data.items.length === 0 ? (
          <EmptyState icon={<History className="h-10 w-10" />} title={t("No imports found")}>
            {query || status !== "all" ? t("Try a different search or status.") : t("Imports you start will appear here.")}
          </EmptyState>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">{t("Date")}</th>
                  <th className="px-4 py-3">{t("Import")}</th>
                  <th className="px-4 py-3">{t("Files")}</th>
                  <th className="px-4 py-3 text-right">{t("Records")}</th>
                  <th className="px-4 py-3 text-right">{t("Ready")}</th>
                  <th className="px-4 py-3 text-right">{t("Errors")}</th>
                  <th className="px-4 py-3">{t("Status")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((imp) => {
                  const final = imp.outputs.find((o) => o.kind === "final");
                  const canDownload = final && !imp.filesPurgedAt && imp.status === "completed";
                  return (
                    <tr key={imp.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{fmtDateTime(imp.createdAt)}</td>
                      <td className="min-w-48 max-w-72 px-4 py-3">
                        <Link href={`/imports/${imp.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                          {imp.name}
                        </Link>
                        {imp.repeatOf && <div className="text-xs text-slate-400">{t("Repeat of an earlier import")}</div>}
                      </td>
                      <td className="max-w-72 px-4 py-3 text-xs text-slate-500">
                        <div className="truncate">{t("Template: {name}", { name: imp.template?.originalName ?? "—" })}</div>
                        <div className="truncate">{t("Data: {name}", { name: imp.source?.originalName ?? "—" })}</div>
                        {imp.filesPurgedAt && (
                          <Badge tone="slate" className="mt-1">
                            {t("Files deleted")}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{imp.stats ? fmtNumber(imp.stats.totalRows) : "—"}</td>
                      <td className="px-4 py-3 text-right text-emerald-700 tabular-nums">{imp.stats ? fmtNumber(imp.stats.ready) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {imp.stats ? <span className={imp.stats.withErrors ? "text-red-600" : "text-slate-400"}>{fmtNumber(imp.stats.withErrors)}</span> : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={imp.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {canDownload && (
                            <a href={`/api/imports/${imp.id}/download/final`} className={buttonClass("secondary", "sm")} title={t("Download final Excel")}>
                              <Download className="h-3.5 w-3.5" /> {t("Final file")}
                            </a>
                          )}
                          {imp.template && !imp.filesPurgedAt && (imp.status === "completed" || imp.status === "failed") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busy === imp.id}
                              onClick={() => repeat(imp.id)}
                              icon={<Repeat className="h-3.5 w-3.5" />}
                              title={t("New import with the same template and mapping")}
                            >
                              {t("Repeat")}
                            </Button>
                          )}
                          <Link href={`/imports/${imp.id}`} className={buttonClass("ghost", "sm")}>
                            {t("Open")}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>{t("{a}–{b} of {n}", { a: offset + 1, b: Math.min(offset + PAGE, data.total), n: data.total })}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {t("Previous")}
              </Button>
              <Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                {t("Next")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
