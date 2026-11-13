"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Pencil, Search, Undo2, XCircle } from "lucide-react";
import type { ProcessSummary, ProcessedRow, RowsResponse, TargetColumn, ValueSource } from "@/lib/types";
import { COLUMN_TYPE_LABELS } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { apiSend, fmtNumber, useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Button, Card, Drawer, LoadingBlock, StatCard, inputClass } from "@/components/ui";
import type { CompareContext } from "./compare-stage";
import { SourceSwitch, TEMPLATE_TAG_LABEL, TemplateChanges } from "./template-changes";

type Filter = "all" | "ready" | "errors" | "warnings" | "duplicates" | "changed" | "template" | "excluded";

const TAG_LABEL: Record<string, string> = {
  trim: tk("Spaces removed"),
  date: tk("Date converted"),
  number: tk("Text → number"),
  phone: tk("Phone standardized"),
  code: tk("Value standardized"),
  case: tk("Capitalization"),
  default: tk("Default value"),
  edit: tk("Corrected by you"),
  calendar: tk("Ethiopian date converted"),
};

export function SummaryStats({ s }: { s: ProcessSummary }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <StatCard label={t("Original records")} value={fmtNumber(s.totalRows)} hint={s.blankRowsSkipped ? t("{n} blank rows ignored", { n: s.blankRowsSkipped }) : undefined} />
      <StatCard label={t("Ready for import")} value={fmtNumber(s.ready)} tone="green" hint={s.withWarnings ? t("{n} with warnings", { n: s.withWarnings }) : t("no warnings")} />
      <StatCard label={t("Valid (no issues)")} value={fmtNumber(s.clean)} tone="green" />
      <StatCard label={t("Records with errors")} value={fmtNumber(s.withErrors)} tone={s.withErrors ? "red" : "slate"} hint={t("not included")} />
      <StatCard label={t("Duplicate records")} value={fmtNumber(s.duplicates)} tone={s.duplicates ? "amber" : "slate"} />
      <StatCard label={t("Missing mandatory")} value={fmtNumber(s.missingMandatory)} tone={s.missingMandatory ? "red" : "slate"} hint={t("values")} />
      <StatCard
        label={t("Excluded by you")}
        value={fmtNumber(s.excluded)}
        hint={s.edited ? (s.edited === 1 ? t("{n} cell corrected", { n: 1 }) : t("{n} cells corrected", { n: s.edited })) : undefined}
      />
    </div>
  );
}

export function ValidationStep({ ctx }: { ctx: CompareContext }) {
  const t = useT();
  const { summary, detail, importId, version } = ctx;
  const targets = detail.import.analysis!.targets;
  const [filter, setFilter] = useState<Filter>("all");
  const [code, setCode] = useState<{ code: string; col: number } | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [inspect, setInspect] = useState<ProcessedRow | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const url = `/api/imports/${importId}/rows?filter=${filter}&page=${page}&size=50&q=${encodeURIComponent(query)}${code ? `&code=${code.code}&col=${code.col}` : ""}&v=${version}`;
  const rows = useApi<RowsResponse>(url);
  const fillMode = summary.template?.mode === "fill";

  const filters: { key: Filter; label: string; n?: number }[] = [
    { key: "all", label: t("All"), n: summary.totalRows },
    { key: "ready", label: t("Ready"), n: summary.ready },
    { key: "errors", label: t("Errors"), n: summary.withErrors },
    { key: "warnings", label: t("Warnings"), n: summary.withWarnings },
    { key: "duplicates", label: t("Duplicates"), n: summary.duplicates },
    { key: "changed", label: t("Changed by cleaning") },
    ...(fillMode ? [{ key: "template" as const, label: t("Changes the template") }] : []),
    { key: "excluded", label: t("Excluded"), n: summary.excluded },
  ];
  const activeIssue = code ? summary.issues.find((x) => x.code === code.code && x.col === code.col) : undefined;

  return (
    <div className="space-y-5">
      <SummaryStats s={summary} />

      {summary.blocking.length > 0 && (
        <Alert tone="warning" title={t("Before the final file can be generated")}>
          <ul className="mt-1 list-disc pl-5">
            {summary.blocking.map((b, i) => (
              <li key={i}>{t.msg(b)}</li>
            ))}
          </ul>
        </Alert>
      )}

      <TemplateChanges
        s={summary.template}
        targets={targets}
        onShowRows={() => {
          setFilter("template");
          setCode(null);
          setPage(1);
        }}
      />

      {summary.issues.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">{t("Problems found")}</h2>
            {code && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCode(null);
                  setPage(1);
                }}
              >
                {t("Clear problem filter")}
              </Button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {summary.issues.map((is) => {
              const active = code?.code === is.code && code.col === is.col;
              const col = targets.find((x) => x.index === is.col);
              return (
                <button
                  key={`${is.code}-${is.col}`}
                  onClick={() => {
                    setCode(active ? null : { code: is.code, col: is.col });
                    setFilter("all");
                    setPage(1);
                  }}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {is.level === "error" ? <XCircle className="h-4 w-4 shrink-0 text-red-500" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{t.msg(is.label)}</span>
                    <span className="block truncate text-xs text-slate-500">{col ? col.label : t("Whole record")}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-slate-700">{fmtNumber(is.count)}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setFilter(f.key);
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {f.label}
                {f.n !== undefined && <span className={`ml-1.5 tabular-nums ${filter === f.key ? "text-white/80" : "text-slate-400"}`}>{fmtNumber(f.n)}</span>}
              </button>
            ))}
          </div>
          <div className="relative lg:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={inputClass({ px: "pl-9 pr-3" })}
              placeholder={t("Search values or row number")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-1.5 text-xs text-slate-500">
          <span>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 align-middle" /> {t("Changed by cleaning (compared with the original file)")}
          </span>
          {fillMode && (
            <span>
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 align-middle" /> {t("Replaces the template’s value")}
            </span>
          )}
          {fillMode && (
            <span>
              <span className="mr-1 inline-block h-2.5 w-3 rounded-sm bg-indigo-100 align-middle" /> {t("Template value (your choice)")}
            </span>
          )}
          <span>
            <span className="mr-1 inline-block h-2.5 w-3 rounded-sm bg-violet-100 align-middle" /> {t("Corrected by you")}
          </span>
          <span>{fillMode ? t("Hover a cell or open a row to see the original and template value.") : t("Hover a cell or open a row to see the original value.")}</span>
        </div>
        {code && (
          <div className="border-b border-slate-200 bg-brand-50 px-4 py-2 text-sm text-brand-900">
            {t.rich("Showing only rows with: <b>{problem}</b>", { problem: activeIssue ? t.msg(activeIssue.label) : "" })}
            {code.col >= 0 && <> {t.rich("in <b>{col}</b>", { col: targets.find((x) => x.index === code.col)?.label ?? "" })}</>}
          </div>
        )}
        {rows.loading && !rows.data ? (
          <LoadingBlock label={t("Loading records…")} />
        ) : rows.error ? (
          <div className="p-4">
            <Alert tone="error">{rows.error}</Alert>
          </div>
        ) : (
          <DataTable rows={rows.data?.rows ?? []} targets={targets} onOpen={setInspect} />
        )}
        {rows.data && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              {rows.data.total === 1
                ? t("{n} record · page {p} of {pages}", { n: 1, p: rows.data.page, pages: rows.data.pages })
                : t("{n} records · page {p} of {pages}", { n: rows.data.total, p: rows.data.page, pages: rows.data.pages })}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={rows.data.page <= 1} onClick={() => setPage(rows.data!.page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
                {t("Previous")}
              </Button>
              <Button size="sm" disabled={rows.data.page >= rows.data.pages} onClick={() => setPage(rows.data!.page + 1)}>
                {t("Next")} <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <RowInspector row={inspect} ctx={ctx} onClose={() => setInspect(null)} onUpdated={(r) => setInspect(r)} siblings={rows.data?.rows ?? []} />
    </div>
  );
}

function DataTable({ rows, targets, onOpen }: { rows: ProcessedRow[]; targets: TargetColumn[]; onOpen: (r: ProcessedRow) => void }) {
  const t = useT();
  if (rows.length === 0) return <div className="px-4 py-12 text-center text-sm text-slate-500">{t("No records match this filter.")}</div>;
  return (
    <div className="scroll-thin max-h-[60vh] overflow-auto">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr className="text-left text-slate-600">
            <th className="sticky left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold">{t("Row")}</th>
            <th className="border-b border-slate-200 px-2 py-2 font-semibold">{t("Status")}</th>
            {targets.map((col) => (
              <th key={col.index} className="border-b border-slate-200 px-3 py-2 font-semibold whitespace-nowrap">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const errCols = new Map<number, string[]>();
            for (const is of r.issues)
              if (is.col >= 0) errCols.set(is.col, [...(errCols.get(is.col) ?? []), `${is.level === "error" ? t("Error") : t("Warning")}: ${t.msg(is.message)}`]);
            return (
              <tr key={r.i} onClick={() => onOpen(r)} className="cursor-pointer border-b border-slate-100 hover:bg-brand-50/40" data-testid="data-row">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-medium text-slate-500">{r.excelRow}</td>
                <td className="px-2 py-1.5">
                  <RowStatusIcon r={r} />
                </td>
                {targets.map((col, k) => {
                  const problems = errCols.get(col.index);
                  const hasError = r.issues.some((x) => x.col === col.index && x.level === "error");
                  const tag = r.changed[k];
                  const tplTag = r.fromTemplate?.[k] ?? null;
                  const title = [
                    ...(problems ?? []),
                    tag ? t("{change} — original: “{v}”", { change: t(TAG_LABEL[tag] ?? tag), v: r.original[k] }) : "",
                    tplTag && r.template ? t("{change} — template: “{v}”", { change: t(TEMPLATE_TAG_LABEL[tplTag]), v: r.template[k] }) : "",
                  ]
                    .filter(Boolean)
                    .join("\n");
                  return (
                    <td
                      key={col.index}
                      title={title || undefined}
                      className={`max-w-56 truncate px-3 py-1.5 whitespace-nowrap ${
                        hasError
                          ? "bg-red-50 text-red-800"
                          : problems
                            ? "bg-amber-50 text-amber-900"
                            : r.edited[k]
                              ? "bg-violet-50 text-violet-900"
                              : tplTag === "chosen"
                                ? "bg-indigo-50 text-indigo-900"
                                : "text-slate-700"
                      }`}
                    >
                      {tag && !hasError && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 align-middle" />}
                      {(tplTag === "replaced" || tplTag === "member") && !hasError && (
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 align-middle" />
                      )}
                      {r.display[k] || (hasError ? <span className="italic text-red-400">{t("blank")}</span> : "")}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowStatusIcon({ r }: { r: ProcessedRow }) {
  const t = useT();
  if (r.status === "excluded")
    return (
      <Badge tone="slate">
        <Ban className="h-3 w-3" /> {t("Excluded")}
      </Badge>
    );
  if (r.status === "error")
    return (
      <Badge tone="red">
        <XCircle className="h-3 w-3" /> {t("Error")}
      </Badge>
    );
  if (r.status === "warning")
    return (
      <Badge tone="amber">
        <AlertTriangle className="h-3 w-3" /> {t("Warning")}
      </Badge>
    );
  return (
    <Badge tone="green">
      <CheckCircle2 className="h-3 w-3" /> {t("Ready")}
    </Badge>
  );
}

function RowInspector({
  row,
  ctx,
  onClose,
  onUpdated,
  siblings,
}: {
  row: ProcessedRow | null;
  ctx: CompareContext;
  onClose: () => void;
  onUpdated: (r: ProcessedRow) => void;
  siblings: ProcessedRow[];
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!row) return null;
  const targets = ctx.detail.import.analysis!.targets;
  const mappings = ctx.config.mappings;
  const idx = siblings.findIndex((s) => s.i === row.i);

  async function act(body: { action: "edit" | "revert" | "exclude" | "include" | "source"; target?: number; value?: string }, key: string) {
    setBusy(key);
    setError(null);
    try {
      const r = await apiSend<{ summary: ProcessSummary; row: ProcessedRow | null }>("POST", `/api/imports/${ctx.importId}/rows`, { ...body, row: row!.i });
      ctx.setSummary(r.summary);
      if (r.row) onUpdated(r.row);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rowIssues = row.issues.filter((x) => x.col < 0);
  const fill = ctx.config.mode === "fill" ? ctx.config.fill : null;
  const isMemberCol = (target: number) => target === fill?.keyTarget || target === fill?.nameTarget;
  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-2xl"
      title={t("Row {n} of the original file", { n: row.excelRow })}
      subtitle={<RowStatusIcon r={row} />}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={idx <= 0} onClick={() => onUpdated(siblings[idx - 1])} icon={<ChevronLeft className="h-4 w-4" />}>
              {t("Previous")}
            </Button>
            <Button size="sm" variant="ghost" disabled={idx < 0 || idx >= siblings.length - 1} onClick={() => onUpdated(siblings[idx + 1])}>
              {t("Next")} <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {row.status === "excluded" ? (
            <Button variant="secondary" loading={busy === "include"} onClick={() => act({ action: "include" }, "include")}>
              {t("Include this record again")}
            </Button>
          ) : (
            <Button variant="danger" loading={busy === "exclude"} icon={<Ban className="h-4 w-4" />} onClick={() => act({ action: "exclude" }, "exclude")}>
              {t("Exclude from final file")}
            </Button>
          )}
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {rowIssues.map((is, i) => (
        <Alert key={i} tone={is.level === "error" ? "error" : "warning"} className="mb-3">
          {t.msg(is.message)}
        </Alert>
      ))}
      <p className="mb-4 text-sm text-slate-500">
        {t("Correct a value and press save. The original file is not changed — corrections are applied to the final file and recorded in the audit log.")}
        {row.template && ` ${t("For each value you can choose whether it comes from the original file or from the template.")}`}
      </p>
      {fill && row.template && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-sm font-medium text-slate-700">{t("Whole row:")}</span>
          <Button size="sm" variant="secondary" loading={busy === "row-original"} onClick={() => act({ action: "source", value: "original" }, "row-original")}>
            {t("All values from the original file")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "row-template"}
            icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
            onClick={() => act({ action: "source", value: "template" }, "row-template")}
          >
            {t("All values from the template")}
          </Button>
          {row.sourceChoice.some(Boolean) && (
            <Button size="sm" variant="ghost" loading={busy === "row-auto"} icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => act({ action: "source", value: "auto" }, "row-auto")}>
              {t("Back to the column settings")}
            </Button>
          )}
        </div>
      )}
      {fill && !row.template && (
        <Alert tone="info" className="mb-4">
          {t.rich("This row is not matched to a member yet, so there are no template values to choose from. Match it on the <b>Members</b> step.")}
        </Alert>
      )}
      <div className="space-y-3">
        {targets.map((col, k) => (
          <FieldEditor
            key={`${row.i}-${col.index}-${row.display[k]}-${row.edited[k]}-${row.sourceChoice?.[k] ?? ""}`}
            col={col}
            type={mappings[k].rule.type}
            dateFormat={mappings[k].rule.dateFormat}
            row={row}
            k={k}
            busy={busy}
            onSave={(value) => act({ action: "edit", target: col.index, value }, `edit-${col.index}`)}
            source={
              fill && row.template && !isMemberCol(col.index)
                ? {
                    columnUsesTemplate: Boolean(mappings[k].useTemplate),
                    onChange: (value) => act({ action: "source", target: col.index, value }, `src-${col.index}`),
                  }
                : null
            }
            onRevert={() => act({ action: "revert", target: col.index }, `revert-${col.index}`)}
          />
        ))}
      </div>
    </Drawer>
  );
}

function FieldEditor({
  col,
  type,
  dateFormat,
  row,
  k,
  busy,
  onSave,
  source,
  onRevert,
}: {
  col: TargetColumn;
  type: keyof typeof COLUMN_TYPE_LABELS;
  dateFormat: string;
  row: ProcessedRow;
  k: number;
  busy: string | null;
  onSave: (v: string) => void;
  /** Fill mode: choose whether this cell comes from the original file or from the template. */
  source: { columnUsesTemplate: boolean; onChange: (v: ValueSource | "auto") => void } | null;
  onRevert: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(row.display[k]);
  const [editing, setEditing] = useState(false);
  const issues = row.issues.filter((x) => x.col === col.index);
  const hasError = issues.some((x) => x.level === "error");
  const tag = row.changed[k];
  const tplTag = row.fromTemplate?.[k] ?? null;
  const choice = row.sourceChoice?.[k] ?? null;
  // A typed correction wins over both files; otherwise your choice for this cell, else the column's setting.
  const activeSource: ValueSource | null = row.edited[k] ? null : (choice ?? (source?.columnUsesTemplate ? "template" : "original"));
  const sensitive = type === "amount" || type === "identifier";
  const placeholder = type === "date" ? dateFormat : type === "amount" ? t("e.g. 1500.00") : "";
  const quoted = (v: string) => (v === "" ? t("(blank)") : `“${v}”`);
  const columnSetting = source?.columnUsesTemplate ? t("template") : t("original file");
  return (
    <div className={`rounded-lg border p-3 ${hasError ? "border-red-200 bg-red-50/40" : issues.length ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">{col.label}</div>
          <div className="text-xs text-slate-500">
            {t("Original:")} <span className="font-mono">{quoted(row.original[k])}</span>
            {tag && (
              <Badge tone={tag === "edit" ? "violet" : "blue"} className="ml-2">
                {t(TAG_LABEL[tag] ?? tag)}
              </Badge>
            )}
          </div>
          {row.template && (
            <div className="mt-0.5 text-xs text-slate-500">
              {row.templateRow ? t("Template (row {n}):", { n: row.templateRow }) : t("Template:")} <span className="font-mono">{quoted(row.template[k])}</span>
              {tplTag && (
                <Badge tone={tplTag === "kept" ? "slate" : "indigo"} className="ml-2">
                  {t(TEMPLATE_TAG_LABEL[tplTag])}
                </Badge>
              )}
            </div>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            {row.edited[k] && (
              <Button size="sm" variant="ghost" loading={busy === `revert-${col.index}`} onClick={onRevert} icon={<Undo2 className="h-3.5 w-3.5" />}>
                {t("Undo")}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)} icon={<Pencil className="h-3.5 w-3.5" />}>
              {t("Correct")}
            </Button>
          </div>
        )}
      </div>
      {source && !editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">{t("Value from:")}</span>
          <SourceSwitch
            label={t("Where the value of {col} comes from", { col: col.label })}
            value={activeSource}
            loading={busy === `src-${col.index}`}
            onChange={(v) => source.onChange(v)}
          />
          {choice && (
            <button type="button" onClick={() => source.onChange("auto")} disabled={busy !== null} className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50">
              {t("Use the column setting ({setting})", { setting: columnSetting })}
            </button>
          )}
          <span className="w-full text-xs text-slate-500">
            {row.edited[k]
              ? t("Your correction is used. Choose a file to use its value instead.")
              : activeSource === "original" && row.valueFrom?.[k] === "template"
                ? t("The original file is empty here, so the template’s value is kept.")
                : choice
                  ? t("Your choice for this cell.")
                  : t("Column setting: {setting}.", { setting: columnSetting })}
          </span>
        </div>
      )}
      {editing ? (
        <div className="mt-2">
          {sensitive && (
            <div className="mb-2 text-xs text-amber-800">
              {type === "amount"
                ? t("You are changing a money amount. This change is recorded in the audit log.")
                : t("You are changing a member/account ID. This change is recorded in the audit log.")}
            </div>
          )}
          <div className="flex gap-2">
            <input
              className={inputClass({ h: "h-9" })}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              aria-label={t("New value for {col}", { col: col.label })}
            />
            <Button
              size="sm"
              variant="primary"
              className="h-9"
              loading={busy === `edit-${col.index}`}
              onClick={() => {
                onSave(value);
                setEditing(false);
              }}
            >
              {t("Save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9"
              onClick={() => {
                setEditing(false);
                setValue(row.display[k]);
              }}
            >
              {t("Cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 text-sm text-slate-900">
          {t("Final value:")}{" "}
          <span className="font-mono">{row.display[k] === "" ? <span className="text-slate-400">{t("(blank)")}</span> : `“${row.display[k]}”`}</span>
        </div>
      )}
      {issues.map((is, i) => (
        <div key={i} className={`mt-1.5 text-xs ${is.level === "error" ? "text-red-700" : "text-amber-700"}`}>
          {is.level === "error" ? "✘ " : "⚠ "}
          {t.msg(is.message)}
        </div>
      ))}
    </div>
  );
}
