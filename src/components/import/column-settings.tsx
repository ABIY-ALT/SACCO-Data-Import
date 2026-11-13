"use client";

import { useState } from "react";
import type { ColumnMapping, ColumnRule, ColumnType, TargetColumn } from "@/lib/types";
import { COLUMN_TYPE_LABELS } from "@/lib/types";
import { useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Drawer, Field, Toggle, inputCls, inputClass } from "@/components/ui";
import type { CompareContext } from "./compare-stage";

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD.MM.YYYY", "DD-MMM-YYYY", "D/M/YYYY"];

export function ColumnSettings({ open, onClose, ctx, target }: { open: boolean; onClose: () => void; ctx: CompareContext; target: TargetColumn | null }) {
  if (!open || !target) return null;
  return <Inner onClose={onClose} ctx={ctx} col={target} />;
}

function Inner({ onClose, ctx, col }: { onClose: () => void; ctx: CompareContext; col: TargetColumn }) {
  const t = useT();
  const { config, update, detail } = ctx;
  const analysis = detail.import.analysis!;
  const m = config.mappings.find((x) => x.target === col.index)!;
  const rule = m.rule;
  const setMapping = (patch: Partial<ColumnMapping>) => update({ ...config, mappings: config.mappings.map((x) => (x.target === col.index ? { ...x, ...patch } : x)) });
  const setRule = (patch: Partial<ColumnRule>) => setMapping({ rule: { ...rule, ...patch } });
  const source = m.source !== null ? analysis.sources[m.source] : null;
  const evidence = analysis.dateOrderDetected[col.index];
  const [allowedText, setAllowedText] = useState(rule.allowedValues.join(", "));

  return (
    <Drawer open onClose={onClose} title={col.label} subtitle={t("Template column {c} · rules for the final file", { c: col.letter })}>
      <div className="space-y-6">
        <section className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span className="text-slate-500">{t("Exact header")}</span>
            <span className="font-mono text-xs text-slate-800">“{col.header}”</span>
            <span className="text-slate-500">{t("Original column")}</span>
            <span className="text-slate-800">{source ? `${source.letter}: ${source.label}` : t("— none —")}</span>
            {col.example && (
              <>
                <span className="text-slate-500">{t("Template example")}</span>
                <span className="text-slate-800">{col.example}</span>
              </>
            )}
            {col.allowedValues && (
              <>
                <span className="text-slate-500">{t("Template list")}</span>
                <span className="text-slate-800">{col.allowedValues.join(", ")}</span>
              </>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <Field label={t("Data type")} hint={t("Decides how values are checked and written.")}>
            <select className={inputCls} value={rule.type} onChange={(e) => setRule({ type: e.target.value as ColumnType })}>
              {Object.entries(COLUMN_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          <Toggle checked={rule.required} onChange={(v) => setRule({ required: v })} label={t("Mandatory")} description={t("Rows without a value in this column are not imported.")} />
          <Toggle
            checked={rule.unique}
            onChange={(v) => setRule({ unique: v })}
            label={t("Must be unique")}
            description={t("Rows with the same value (e.g. the same Member ID or phone) are flagged as duplicates.")}
          />
        </section>

        {rule.type === "date" && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">{t("Dates")}</h3>
            <Field label={t("Date format in the final file")}>
              <input className={inputCls} value={rule.dateFormat} onChange={(e) => setRule({ dateFormat: e.target.value.toUpperCase() })} list={`fmts-${col.index}`} />
              <datalist id={`fmts-${col.index}`}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
            <Field label={t("Write dates as")}>
              <select className={inputCls} value={rule.dateOutput} onChange={(e) => setRule({ dateOutput: e.target.value as "date" | "text" })}>
                <option value="date">{t("Real Excel dates (shown as {f})", { f: rule.dateFormat })}</option>
                <option value="text">{t("Text exactly like {f}", { f: rule.dateFormat })}</option>
              </select>
            </Field>
            <Field
              label={t("Read dates in the original file as")}
              hint={evidence ? t("Detected: {order} — {_why}", { order: evidence.order ?? t("not sure"), _why: t.msg(evidence.evidence) }) : undefined}
            >
              <select className={inputCls} value={rule.dateOrder} onChange={(e) => setRule({ dateOrder: e.target.value as ColumnRule["dateOrder"] })}>
                <option value="auto">{evidence?.order ? t("Automatic ({order})", { order: evidence.order }) : t("Automatic (Settings default)")}</option>
                <option value="DMY">{t("Day / Month / Year (31/12/1990)")}</option>
                <option value="MDY">{t("Month / Day / Year (12/31/1990)")}</option>
                <option value="YMD">{t("Year - Month - Day (1990-12-31)")}</option>
              </select>
            </Field>
            {evidence?.ambiguous && (
              <Alert tone="warning">{t("Dates in this column could be read as day/month or month/day. Please choose the correct order above.")}</Alert>
            )}
          </section>
        )}

        {rule.type === "phone" && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">{t("Phone numbers")}</h3>
            <Field label={t("Phone format in the final file")} hint={t("Country code and number length are set in Settings.")}>
              <select className={inputCls} value={rule.phoneFormat} onChange={(e) => setRule({ phoneFormat: e.target.value as ColumnRule["phoneFormat"] })}>
                <option value="local">{t("Local, with leading 0 (0912345678)")}</option>
                <option value="international">{t("International with + (+251912345678)")}</option>
                <option value="international_no_plus">{t("International without + (251912345678)")}</option>
                <option value="keep">{t("Keep as written (only remove spaces)")}</option>
              </select>
            </Field>
          </section>
        )}

        {["amount", "number", "integer"].includes(rule.type) && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">{t("Numbers")}</h3>
            <Toggle
              checked={rule.allowNegative}
              onChange={(v) => setRule({ allowNegative: v })}
              label={t("Allow negative values")}
              description={t("When off, negative values are reported as errors.")}
            />
            {rule.type === "amount" && (
              <Alert tone="info">{t("Money amounts are never rounded or changed. Values with more than 2 decimals are only flagged as a warning.")}</Alert>
            )}
          </section>
        )}

        {(rule.type === "gender" || rule.type === "enum") && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">{t("Allowed values")}</h3>
            <Field label={t("Values allowed by the template")} hint={t("Separate with commas.")}>
              <input
                className={inputCls}
                value={allowedText}
                onChange={(e) => setAllowedText(e.target.value)}
                onBlur={() => setRule({ allowedValues: allowedText.split(",").map((x) => x.trim()).filter(Boolean) })}
              />
            </Field>
            {source && <ValueMapping ctx={ctx} sourceIndex={source.index} rule={rule} onChange={(valueMap) => setRule({ valueMap })} />}
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">{t("Default value")}</h3>
          <Field
            label={source ? t("Value for blank cells") : t("Value for every row")}
            hint={source ? t("Only used when the switch below is on.") : t("Used because this column is not in the original file.")}
          >
            <input className={inputCls} value={m.defaultValue} onChange={(e) => setMapping({ defaultValue: e.target.value, defaultApproved: false })} placeholder={t("No default")} />
          </Field>
          {source && (
            <Toggle
              checked={m.fillBlanks}
              onChange={(v) => setMapping({ fillBlanks: v, defaultApproved: false })}
              label={t("Fill blank cells with the default value")}
              description={t("Blank cells in the original file get this value. This is shown as a change in the reports.")}
            />
          )}
          {m.defaultValue !== "" && (rule.type === "amount" || rule.type === "identifier") && (m.source === null || m.fillBlanks) && (
            <label className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <input type="checkbox" checked={m.defaultApproved} onChange={(e) => setMapping({ defaultApproved: e.target.checked })} className="mt-1 accent-amber-600" />
              {rule.type === "amount"
                ? t("I approve writing “{v}” into this money column. It is not in the original file.", { v: m.defaultValue })
                : t("I approve writing “{v}” into this ID column. It is not in the original file.", { v: m.defaultValue })}
            </label>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function ValueMapping({ ctx, sourceIndex, rule, onChange }: { ctx: CompareContext; sourceIndex: number; rule: ColumnRule; onChange: (m: Record<string, string>) => void }) {
  const t = useT();
  const values = useApi<{ values: { value: string; count: number }[] }>(`/api/imports/${ctx.importId}/values?source=${sourceIndex}`);
  const list = values.data?.values ?? [];
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-700">{t("Values found in the original file")}</div>
      <p className="mb-2 text-xs text-slate-500">{t("Choose what each value becomes. “Automatic” uses the standard rules (e.g. Male → M).")}</p>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {list.map(({ value, count }) => {
          const key = value.toLowerCase();
          const current = rule.valueMap[key] ?? "";
          const inList = rule.allowedValues.includes(value);
          return (
            <div key={value} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                “{value}” <span className="text-xs text-slate-400">× {count}</span>
              </span>
              {inList && !current && <Badge tone="green">{t("allowed")}</Badge>}
              <select
                className={inputClass({ h: "h-8", w: "w-44 shrink-0" })}
                value={current}
                onChange={(e) => {
                  const next = { ...rule.valueMap };
                  if (e.target.value === "") delete next[key];
                  else next[key] = e.target.value;
                  onChange(next);
                }}
                aria-label={t("Map value {v}", { v: value })}
              >
                <option value="">{t("Automatic")}</option>
                {rule.allowedValues.map((a) => (
                  <option key={a} value={a}>
                    → {a}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        {values.loading && <div className="px-3 py-2 text-sm text-slate-500">{t("Loading values…")}</div>}
        {!values.loading && list.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">{t("No values in this column.")}</div>}
      </div>
    </div>
  );
}
