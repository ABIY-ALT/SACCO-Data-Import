"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet } from "lucide-react";
import type { TemplateChange, TemplateChangeStat, TemplateChangeSummary, ValueSource } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { fmtNumber } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Button, Card, StatCard, type BadgeTone } from "@/components/ui";

/** Short labels used for cell markers in the preview table and the row inspector (translated where shown). */
export const TEMPLATE_TAG_LABEL: Record<TemplateChange, string> = {
  replaced: tk("Replaces template value"),
  member: tk("From the template's member list"),
  kept: tk("Kept from the template"),
  chosen: tk("Template value (your choice)"),
};

const TONE: Record<TemplateChange, BadgeTone> = { replaced: "indigo", member: "indigo", kept: "slate", chosen: "indigo" };

const HELP: Record<TemplateChange, string> = {
  replaced: tk("The template already has a value in these cells. The final file gets the value from the original file instead."),
  chosen: tk(
    "You chose the template’s value for these cells (for a whole column on Column mapping, or for a cell or row in the row inspector). The original file’s value is not used — its money is shown as not imported in the report.",
  ),
  member: tk("The original file spells these members differently. The final file uses the member ID and name exactly as they are in the template's member list."),
  kept: tk("The original file has nothing for these cells (blank cell or no matching column), so the template's own value stays in the final file."),
};

type Targets = { index: number; label: string }[];

/** Two-way switch: take a value from the original file or from the template. */
export function SourceSwitch({
  value,
  onChange,
  label,
  disabled = [],
  loading = false,
}: {
  value: ValueSource | null; // null = neither (e.g. a value typed by you)
  onChange: (v: ValueSource) => void;
  label: string;
  disabled?: ValueSource[];
  loading?: boolean;
}) {
  const t = useT();
  const options: { v: ValueSource; text: string }[] = [
    { v: "original", text: t("Original file") },
    { v: "template", text: t("Template") },
  ];
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-lg bg-slate-100 p-0.5 text-xs ${loading ? "opacity-60" : ""}`}>
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={loading || disabled.includes(o.v)}
            onClick={() => !active && onChange(o.v)}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? `bg-white shadow-sm ${o.v === "template" ? "text-indigo-700" : "text-slate-900"}` : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

/** What the final file does with the rows and values the template already has. */
export function TemplateChanges({ s, targets, onShowRows }: { s: TemplateChangeSummary | null | undefined; targets: Targets; onShowRows?: () => void }) {
  const t = useT();
  if (!s) return null;

  if (s.mode === "rows") {
    if (s.templateRows === 0) return null;
    return (
      <Alert
        tone="info"
        title={s.templateRows === 1 ? t("The template’s own row is not copied to the final file") : t("The template’s own {n} rows are not copied to the final file", { n: s.templateRows })}
      >
        {s.templateRows === 1
          ? t("The template already has a row below its header. The final file contains only the records from the original file, so this row is left out:")
          : t("The template already has {n} rows below its header. The final file contains only the records from the original file, so these rows are left out:", {
              n: s.templateRows,
            })}
        <RemovedRows s={s} />
      </Alert>
    );
  }

  const cells = (k: TemplateChange) => s.changes.find((c) => c.key === k)?.cells ?? 0;
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t("Changes to the template")}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {t.rich(
                "The template already has values for its {n} members. This compares the final file with the <b>template</b>, not only with the original file. Only records without errors are counted — rows with errors do not change the template.",
                { n: s.templateRows },
              )}
            </p>
          </div>
        </div>
        {onShowRows && (cells("replaced") > 0 || cells("member") > 0 || cells("chosen") > 0) && (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={onShowRows}>
            {t("Show these rows")}
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("Members updated")} value={fmtNumber(s.rowsUpdated)} tone="blue" hint={t("get data from the original file")} />
        {s.rowsUnchanged > 0 ? (
          <StatCard label={t("Members unchanged")} value={fmtNumber(s.rowsUnchanged)} hint={t("copied exactly as in the template")} />
        ) : (
          <StatCard label={t("Members left out")} value={fmtNumber(s.rowsRemoved)} hint={t("no data in the original file")} />
        )}
        <StatCard label={t("Template values replaced")} value={fmtNumber(cells("replaced"))} tone={cells("replaced") ? "blue" : "slate"} />
        <StatCard label={t("Template values kept")} value={fmtNumber(cells("kept") + cells("chosen"))} hint={t("nothing in the original file, or your choice")} />
      </div>

      {s.changes.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{t("No template values are changed yet.")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {s.changes.map((c) => (
            <ChangeBlock key={c.key} stat={c} targets={targets} />
          ))}
        </div>
      )}

      {s.rowsRemoved > 0 && s.rowsUnchanged > 0 && (
        <div className="mt-4 text-sm text-slate-600">
          {s.rowsRemoved === 1 ? t("{n} template row is not in the final file.", { n: 1 }) : t("{n} template rows are not in the final file.", { n: s.rowsRemoved })}
        </div>
      )}
    </Card>
  );
}

function RemovedRows({ s }: { s: TemplateChangeSummary }) {
  const t = useT();
  if (s.removedSamples.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 font-mono text-xs">
      {s.removedSamples.map((r) => (
        <li key={r.excelRow}>
          <span className="text-sky-700/70">{t("Row {n}", { n: r.excelRow })}:</span> {r.text}
        </li>
      ))}
      {s.rowsRemoved > s.removedSamples.length && <li className="font-sans">{t("… and {n} more", { n: s.rowsRemoved - s.removedSamples.length })}</li>}
    </ul>
  );
}

function ChangeBlock({ stat, targets }: { stat: TemplateChangeStat; targets: Targets }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = (i: number) => targets.find((x) => x.index === i)?.label ?? "";
  const shown = (v: string, blank = t("(blank)")) => (v === "" ? <span className="text-slate-400">{blank}</span> : `“${v}”`);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-800">{t(stat.label)}</div>
        <Badge tone={TONE[stat.key]}>{stat.cells === 1 ? t("{n} cell", { n: 1 }) : t("{n} cells", { n: stat.cells })}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t(HELP[stat.key])}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {stat.columns.map((c) => (
          <span key={c.target} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {label(c.target)}: {fmtNumber(c.count)}
          </span>
        ))}
      </div>
      <button onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {open ? t("Hide examples") : t("Show examples")}
      </button>
      {open && (
        <div className="scroll-thin mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">{t("Row")}</th>
                <th className="px-3 py-1.5 font-medium">{t("Column")}</th>
                <th className="px-3 py-1.5 font-medium">{t("In the template")}</th>
                <th className="px-3 py-1.5 font-medium">{t("In the original file")}</th>
                <th className="px-3 py-1.5 font-medium">{t("In the final file")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stat.samples.map((s, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 text-slate-400">{s.row}</td>
                  <td className="px-3 py-1.5 text-slate-600">{label(s.target)}</td>
                  <td className={`px-3 py-1.5 font-mono whitespace-pre ${stat.key === "kept" || stat.key === "chosen" ? "text-emerald-700" : "text-red-700/80"}`}>
                    {shown(s.template)}
                  </td>
                  <td className={`px-3 py-1.5 font-mono whitespace-pre ${stat.key === "member" || stat.key === "chosen" ? "text-red-700/80" : "text-slate-600"}`}>
                    {shown(s.original, stat.key === "kept" ? t("(nothing)") : t("(blank)"))}
                  </td>
                  <td className="px-3 py-1.5 font-mono whitespace-pre text-emerald-700">{shown(s.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
