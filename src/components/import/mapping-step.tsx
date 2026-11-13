"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, Info, Settings2, X } from "lucide-react";
import type { ColumnMapping, ColumnRule, RowsResponse, SourceColumn, TargetColumn } from "@/lib/types";
import { COLUMN_TYPE_LABELS } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Button, Card, CardTitle, Modal, inputCls, inputClass, type BadgeTone } from "@/components/ui";
import type { CompareContext } from "./compare-stage";
import { ColumnSettings } from "./column-settings";
import { SourceSwitch } from "./template-changes";

const MONEY_OR_ID = new Set(["amount", "identifier"]);

/** Badge for a column match. The label is translated where it is shown. */
export function matchInfo(m: ColumnMapping): { tone: BadgeTone; label: string } {
  if (m.source === null) return m.rule.required ? { tone: "red", label: tk("Missing – mandatory") } : { tone: "slate", label: tk("Missing") };
  switch (m.status) {
    case "exact":
      return { tone: "green", label: tk("Match") };
    case "synonym":
      return { tone: "green", label: tk("Match") };
    case "learned":
      return { tone: "green", label: tk("Match (remembered)") };
    case "possible":
      return m.confirmed ? { tone: "green", label: tk("Confirmed by you") } : { tone: "amber", label: tk("Possible match") };
    case "manual":
      return { tone: "blue", label: tk("Chosen by you") };
    default:
      return { tone: "slate", label: tk("Missing") };
  }
}

export function MappingStep({ ctx, onReanalyze }: { ctx: CompareContext; onReanalyze: (mappingTemplateId: string) => Promise<void> }) {
  const t = useT();
  const { detail, config, update, summary } = ctx;
  const analysis = detail.import.analysis!;
  const { targets, sources } = analysis;
  const [settingsFor, setSettingsFor] = useState<number | null>(null);
  const [pendingMapping, setPendingMapping] = useState<string | null>(null);
  const [reapplying, setReapplying] = useState(false);

  const setMapping = (target: number, patch: Partial<ColumnMapping>) =>
    update({ ...config, mappings: config.mappings.map((m) => (m.target === target ? { ...m, ...patch } : m)) });
  const setRule = (target: number, patch: Partial<ColumnRule>) =>
    update({ ...config, mappings: config.mappings.map((m) => (m.target === target ? { ...m, rule: { ...m.rule, ...patch } } : m)) });

  const usedBy = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const m of config.mappings) if (m.source !== null) map.set(m.source, [...(map.get(m.source) ?? []), m.target]);
    return map;
  }, [config.mappings]);

  const counts = useMemo(() => {
    const c = { matched: 0, possible: 0, missingRequired: 0, missingOptional: 0 };
    const fillMode = config.mode === "fill";
    for (const m of config.mappings) {
      if (m.source === null) {
        // Fill mode: the template's own value is used, so a mandatory column is never empty.
        if (m.rule.required && m.defaultValue === "" && !fillMode) c.missingRequired++;
        else c.missingOptional++;
      } else if (m.status === "possible" && !m.confirmed) c.possible++;
      else c.matched++;
    }
    return c;
  }, [config.mappings, config.mode]);
  // Columns without a header and without any value are left out of lists. One stray value far to the right (e.g. in column XFD)
  // makes a sheet thousands of columns wide.
  const usable = useMemo(() => sources.filter((s) => !(s.blankHeader && s.empty)), [sources]);
  const extra = usable.filter((s) => !usedBy.has(s.index));
  const pendingTargets = config.mappings.filter((m) => m.status === "possible" && !m.confirmed && m.source !== null);

  const savedValue = analysis.savedMapping?.id ?? "none";
  // Fill mode: the template has its own value for every member, so each column can take its values from either file.
  const fill = config.mode === "fill" ? config.fill : null;
  const fromTemplateCount = fill ? config.mappings.filter((m) => m.useTemplate && m.target !== fill.keyTarget && m.target !== fill.nameTarget).length : 0;
  const notes = [...analysis.templateIssues, ...analysis.sourceIssues];

  return (
    <div className="space-y-5">
      {/* summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="slate">{t("{n} template columns", { n: targets.length })}</Badge>
        <Badge tone="green">{t("{n} matched", { n: counts.matched })}</Badge>
        {counts.possible > 0 && <Badge tone="amber">{t("{n} to confirm", { n: counts.possible })}</Badge>}
        {counts.missingRequired > 0 && <Badge tone="red">{t("{n} mandatory missing", { n: counts.missingRequired })}</Badge>}
        {counts.missingOptional > 0 && <Badge tone="slate">{t("{n} not in original file", { n: counts.missingOptional })}</Badge>}
        <Badge tone="violet">{t("{n} extra in original file", { n: extra.length })}</Badge>
        {pendingTargets.length > 1 && (
          <Button
            size="sm"
            variant="subtle"
            className="ml-auto"
            icon={<Check className="h-3.5 w-3.5" />}
            onClick={() => update({ ...config, mappings: config.mappings.map((m) => (m.status === "possible" && m.source !== null ? { ...m, confirmed: true } : m)) })}
          >
            {t("Confirm all {n} possible matches", { n: pendingTargets.length })}
          </Button>
        )}
      </div>

      {/* notices */}
      <div className="space-y-2">
        {pendingTargets.length > 0 && (
          <Alert
            tone="warning"
            title={
              pendingTargets.length === 1
                ? t("{n} possible match needs your confirmation", { n: 1 })
                : t("{n} possible matches need your confirmation", { n: pendingTargets.length })
            }
          >
            {t.rich("These columns have related names but we are not sure they mean the same thing. Check the sample values and press <b>Confirm</b> or <b>Reject</b>.")}
          </Alert>
        )}
        {analysis.savedMapping && (
          <Alert tone="success" title={t("Saved mapping applied: {name}", { name: analysis.savedMapping.name })}>
            {t("Columns were matched the same way as last time.")}
            {analysis.savedMappingNotFound.length > 0 && <> {t("These saved columns were not found in this file: {list}.", { list: analysis.savedMappingNotFound.join(", ") })}</>}
          </Alert>
        )}
        {analysis.orderDiffers && (
          <Alert tone="info">{t("The original file has its columns in a different order. The final file will follow the template order exactly.")}</Alert>
        )}
        {notes.length > 0 && (
          <Alert tone="info" title={t("Notes about the files")}>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {notes.map((n, i) => (
                <li key={i}>{t.msg(n)}</li>
              ))}
            </ul>
          </Alert>
        )}
        {fill && (
          <Alert tone="info" title={t("Choose where each column’s values come from")}>
            {t.rich("The template already has a value for every member. For each column, choose <b>Original file</b> or <b>Template</b> below.")}{" "}
            {fromTemplateCount > 0 &&
              (fromTemplateCount === 1 ? t("({n} column now uses the template.)", { n: 1 }) : t("({n} columns now use the template.)", { n: fromTemplateCount }))}{" "}
            {t(
              "With “Original file”, empty cells still keep the template’s value. You can also choose for a single cell or a whole row: open the row on the Validation step. Member ID and name always come from the template’s member list.",
            )}
          </Alert>
        )}
        {summary.approvalsNeeded.length > 0 && (
          <Alert tone="warning" title={t("Default values in money or ID columns need your approval")}>
            {t("Tick “I approve” next to the column below. Default values add data that is not in the original file.")}
          </Alert>
        )}
      </div>

      {(detail.mappingOptions.length > 0 || analysis.savedMapping) && (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 text-sm">
            <div className="font-medium text-slate-800">{t("Start from a saved mapping")}</div>
            <div className="text-slate-500">{t("Re-apply a mapping you saved for this template, or start again from automatic suggestions.")}</div>
          </div>
          <select className={`${inputCls} sm:w-72`} value={savedValue} onChange={(e) => setPendingMapping(e.target.value)} aria-label={t("Saved mapping")}>
            <option value="none">{t("Automatic suggestions only")}</option>
            {analysis.savedMapping?.id.startsWith("import:") && <option value={analysis.savedMapping.id}>{analysis.savedMapping.name}</option>}
            {detail.mappingOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({t("used {n}×", { n: o.timesUsed })})
              </option>
            ))}
          </select>
        </Card>
      )}

      {/* mapping table */}
      <Card padded={false}>
        <div className="scroll-thin overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="w-10 px-4 py-3">#</th>
                <th className="px-4 py-3">{t("Template column (final file)")}</th>
                <th className="w-8 px-0 py-3" />
                <th className="px-4 py-3">{t("Column from original file")}</th>
                <th className="px-4 py-3">{t("Match")}</th>
                <th className="w-12 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {targets.map((col) => {
                const m = config.mappings.find((x) => x.target === col.index)!;
                return (
                  <MappingRow
                    key={col.index}
                    col={col}
                    m={m}
                    sources={sources}
                    options={usable}
                    usedBy={usedBy}
                    targets={targets}
                    fill={fill ? { locked: col.index === fill.keyTarget || col.index === fill.nameTarget } : null}
                    onUseTemplate={(v) => setMapping(col.index, { useTemplate: v })}
                    onSource={(value) =>
                      value === ""
                        ? setMapping(col.index, { source: null, status: "missing", confirmed: true, reason: "You chose: not in the original file", warnings: [] })
                        : setMapping(col.index, { source: Number(value), status: "manual", confirmed: true, reason: "Chosen by you", warnings: [] })
                    }
                    onConfirm={() => setMapping(col.index, { confirmed: true })}
                    onReject={() => setMapping(col.index, { source: null, status: "missing", confirmed: true, reason: "You rejected the suggested match", warnings: [] })}
                    onRequired={(v) => setRule(col.index, { required: v })}
                    onDefault={(patch) => setMapping(col.index, patch)}
                    onSettings={() => setSettingsFor(col.index)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {extra.length > 0 && (
        <Card>
          <CardTitle
            sub={t(
              "These columns are in the original file but not in the template. They will not be included in the final file (they stay in the invalid-records file for reference).",
            )}
          >
            {t("Extra columns in the original file")}
          </CardTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {extra.map((s) => (
              <div key={s.index} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-500">{s.letter}</span>
                  <span className="truncate">{s.label}</span>
                  {s.empty && <Badge tone="slate">{t("empty")}</Badge>}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{s.samples.join(" · ") || "—"}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <PreviewCard ctx={ctx} />

      <ColumnSettings open={settingsFor !== null} onClose={() => setSettingsFor(null)} ctx={ctx} target={settingsFor === null ? null : targets[settingsFor]} />

      <Modal
        open={pendingMapping !== null}
        onClose={() => setPendingMapping(null)}
        title={t("Re-apply mapping?")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingMapping(null)}>
              {t("Keep current mapping")}
            </Button>
            <Button
              variant="primary"
              loading={reapplying}
              onClick={async () => {
                setReapplying(true);
                try {
                  await onReanalyze(pendingMapping!);
                } finally {
                  setReapplying(false);
                  setPendingMapping(null);
                }
              }}
            >
              {t("Re-apply")}
            </Button>
          </>
        }
      >
        {t("The column mapping and cleaning options on this page will be replaced. Corrections you made to individual rows are also reset.")}
      </Modal>
    </div>
  );
}

function MappingRow({
  col,
  m,
  sources,
  options,
  targets,
  usedBy,
  fill,
  onUseTemplate,
  onSource,
  onConfirm,
  onReject,
  onRequired,
  onDefault,
  onSettings,
}: {
  col: TargetColumn;
  m: ColumnMapping;
  sources: SourceColumn[];
  /** Original columns offered in the dropdown (empty columns without a header are left out). */
  options: SourceColumn[];
  targets: TargetColumn[];
  usedBy: Map<number, number[]>;
  fill: { locked: boolean } | null;
  onUseTemplate: (v: boolean) => void;
  onSource: (value: string) => void;
  onConfirm: () => void;
  onReject: () => void;
  onRequired: (v: boolean) => void;
  onDefault: (patch: Partial<ColumnMapping>) => void;
  onSettings: () => void;
}) {
  const t = useT();
  const s = m.source !== null ? sources[m.source] : null;
  // Fill mode: a column without original data still gets the template's value, so it is never "missing".
  const fromTemplate = Boolean(fill && (fill.locked || m.useTemplate || m.source === null));
  const info: { tone: BadgeTone; label: string } = fromTemplate ? { tone: "indigo", label: tk("From the template") } : matchInfo(m);
  const others = s ? (usedBy.get(s.index) ?? []).filter((x) => x !== col.index) : [];
  const needsApproval = m.defaultValue !== "" && (m.source === null || m.fillBlanks) && MONEY_OR_ID.has(m.rule.type);
  const pending = m.status === "possible" && !m.confirmed && m.source !== null;
  return (
    <tr className={pending ? "bg-amber-50/50" : !fill && m.source === null && m.rule.required && !m.defaultValue ? "bg-red-50/40" : ""} data-testid={`mapping-row-${col.index}`}>
      <td className="px-4 py-3 align-top text-xs text-slate-400">{col.letter}</td>
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-slate-900">{col.label}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone="slate">{t(COLUMN_TYPE_LABELS[m.rule.type])}</Badge>
          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={m.rule.required} onChange={(e) => onRequired(e.target.checked)} className="h-3.5 w-3.5 rounded accent-brand-600" />
            {t("Mandatory")}
          </label>
        </div>
      </td>
      <td className="px-0 py-3 align-top">
        <ArrowLeft className="mt-2 h-4 w-4 text-slate-300" />
      </td>
      <td className="min-w-72 px-4 py-3 align-top">
        {fill && (
          <div className="mb-2">
            {fill.locked ? (
              <div className="rounded-md bg-indigo-50 px-2 py-1.5 text-xs text-indigo-800">
                {t("Always from the template’s member list (the SACCO system’s own ID and name)")}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">{t("Values from:")}</span>
                <SourceSwitch
                  label={t("Where the values of {col} come from", { col: col.label })}
                  value={m.useTemplate ? "template" : "original"}
                  onChange={(v) => onUseTemplate(v === "template")}
                />
              </div>
            )}
            {!fill.locked && (
              <div className="mt-1 text-xs text-slate-500">
                {m.useTemplate
                  ? t("Every value comes from the template. The original file is not used for this column.")
                  : m.source === null
                    ? t("Not in the original file — the template’s value is used.")
                    : t("From the original file. Where the original is empty, the template’s value is kept.")}
              </div>
            )}
          </div>
        )}
        {fill?.locked || m.useTemplate ? null : (
          <>
            <select className={inputCls} value={m.source === null ? "" : String(m.source)} onChange={(e) => onSource(e.target.value)} aria-label={t("Original column for {col}", { col: col.label })}>
              <option value="">{t("— Not in the original file —")}</option>
              {(s && !options.includes(s) ? [...options, s] : options).map((x) => (
                <option key={x.index} value={x.index}>
                  {x.letter}: {x.label}
                  {x.empty ? ` (${t("empty")})` : ""}
                </option>
              ))}
            </select>
            {s ? (
              <div className="mt-1.5 truncate text-xs text-slate-500" title={s.samples.join(" · ")}>
                <span className="text-slate-400">{t("e.g.")}</span> {s.samples.slice(0, 3).join(" · ") || t("(no values)")}
              </div>
            ) : (
              <div className="mt-2">
                <input
                  className={inputClass({ h: "h-9" })}
                  placeholder={col.example ? t("Default value for every row, e.g. {ex}", { ex: col.example }) : t("Default value for every row (optional)")}
                  value={m.defaultValue}
                  onChange={(e) => onDefault({ defaultValue: e.target.value, defaultApproved: false })}
                  aria-label={t("Default value for {col}", { col: col.label })}
                />
              </div>
            )}
            {needsApproval && (
              <label className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                <input type="checkbox" checked={m.defaultApproved} onChange={(e) => onDefault({ defaultApproved: e.target.checked })} className="mt-0.5 accent-amber-600" />
                {m.rule.type === "amount"
                  ? t("I approve writing “{v}” into this money column. It is not in the original file.", { v: m.defaultValue })
                  : t("I approve writing “{v}” into this ID column. It is not in the original file.", { v: m.defaultValue })}
              </label>
            )}
            {others.length > 0 && (
              <div className="mt-1 text-xs text-amber-700">{t("Also used for: {list}", { list: others.map((o) => targets[o].label).join(", ") })}</div>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <Badge tone={info.tone}>{t(info.label)}</Badge>
        <div className="mt-1 max-w-64 text-xs text-slate-500">{t.msg(m.reason)}</div>
        {m.warnings.map((w, i) => (
          <div key={i} className="mt-1 max-w-64 text-xs text-amber-700">
            {t.msg(w)}
          </div>
        ))}
        {pending && (
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="primary" onClick={onConfirm} icon={<Check className="h-3.5 w-3.5" />}>
              {t("Confirm")}
            </Button>
            <Button size="sm" variant="secondary" onClick={onReject} icon={<X className="h-3.5 w-3.5" />}>
              {t("Reject")}
            </Button>
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <button
          onClick={onSettings}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title={t("Column rules (type, format, values)")}
          aria-label={t("Rules for {col}", { col: col.label })}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

function PreviewCard({ ctx }: { ctx: CompareContext }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const targets = ctx.detail.import.analysis!.targets;
  const rows = useApi<RowsResponse>(open ? `/api/imports/${ctx.importId}/rows?size=5&v=${ctx.version}` : null);
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t("Preview of the final file")}</h2>
          <p className="text-sm text-slate-500">{t("First rows exactly as they will be written, in the template’s column order.")}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? t("Hide") : t("Show")}
        </Button>
      </div>
      {open && (
        <div className="scroll-thin overflow-x-auto border-t border-slate-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left">
                {targets.map((col) => (
                  <th key={col.index} className="border-b border-slate-200 px-3 py-2 font-semibold whitespace-nowrap text-slate-700">
                    {col.header || t("(blank)")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.data?.rows ?? []).map((r) => (
                <tr key={r.i} className="border-b border-slate-100">
                  {r.display.map((v, k) => (
                    <td
                      key={k}
                      className={`max-w-48 truncate px-3 py-1.5 whitespace-nowrap ${r.issues.some((x) => x.col === targets[k].index && x.level === "error") ? "bg-red-50 text-red-800" : "text-slate-700"}`}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.data && rows.data.rows.length === 0 && (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-slate-500">
              <Info className="h-4 w-4" /> {t("No rows")}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
