"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import type { TransformOptions, TransformStat } from "@/lib/types";
import { TRANSFORM_INFO } from "@/lib/types";
import { fmtNumber } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Card, Toggle } from "@/components/ui";
import type { CompareContext } from "./compare-stage";
import { TemplateChanges } from "./template-changes";

/** Which change-log tag each cleaning option produces. */
const TAG_OF: Record<keyof TransformOptions, string> = {
  trim: "trim",
  dates: "date",
  numbers: "number",
  phones: "phone",
  codes: "code",
  nameCase: "case",
  emailCase: "case",
};

export function CleaningStep({ ctx }: { ctx: CompareContext }) {
  const t = useT();
  const { config, update, summary, detail } = ctx;
  const targets = detail.import.analysis!.targets;
  const stat = (tag: string) => summary.transforms.find((x) => x.key === tag);
  const keys = Object.keys(TRANSFORM_INFO) as (keyof TransformOptions)[];
  const extraStats = ["calendar", "default", "edit"].map((k) => stat(k)).filter(Boolean) as TransformStat[];
  const cells = (n: number) => (n === 1 ? t("{n} cell", { n }) : t("{n} cells", { n }));

  return (
    <div className="space-y-5">
      <Alert tone="info" title={t("Your original file is never changed")}>
        {t(
          "Cleaning only affects the final file. Every option can be switched off at any time — the values then go back to exactly what is in the original file. All changes are listed in the validation report.",
        )}
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        {keys.map((k) => {
          const info = TRANSFORM_INFO[k];
          const s = stat(TAG_OF[k]);
          const sharedCase = k === "nameCase" || k === "emailCase";
          return (
            <Card key={k} className={config.transforms[k] ? "" : "bg-slate-50"}>
              <div className="flex items-start justify-between gap-4">
                <Toggle
                  checked={config.transforms[k]}
                  onChange={(v) => update({ ...config, transforms: { ...config.transforms, [k]: v } })}
                  label={t(info.label)}
                  description={t(info.description)}
                />
                {config.transforms[k] && s && !sharedCase && <Badge tone="blue">{cells(s.cells)}</Badge>}
                {config.transforms[k] && !s && <Badge tone="slate">{t("No changes needed")}</Badge>}
                {!config.transforms[k] && <Badge tone="slate">{t("Off")}</Badge>}
              </div>
              {config.transforms[k] && s && !sharedCase && <Samples stat={s} targets={targets} />}
            </Card>
          );
        })}
      </div>

      {stat("case") && (config.transforms.nameCase || config.transforms.emailCase) && (
        <Card>
          <div className="text-sm font-medium text-slate-800">{t("Capitalization changes: {n} cells", { n: stat("case")!.cells })}</div>
          <Samples stat={stat("case")!} targets={targets} />
        </Card>
      )}

      {extraStats.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {extraStats.map((s) => (
            <Card key={s.key}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-800">{t(s.label)}</div>
                <Badge tone="violet">{cells(s.cells)}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {s.key === "calendar"
                  ? t("Change the calendar in the column rules (⚙) on the Column mapping step.")
                  : s.key === "default"
                    ? t("Change or remove default values on the Column mapping step.")
                    : t("Undo corrections in the row inspector on the Validation step.")}
              </p>
              <Samples stat={s} targets={targets} />
            </Card>
          ))}
        </div>
      )}

      <TemplateChanges s={summary.template} targets={targets} />

      <Card className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div className="text-sm text-slate-600">
          <div className="font-medium text-slate-800">{t("What is never changed automatically")}</div>
          {t(
            "Money amounts are never rounded. Member IDs, account numbers and other IDs keep their leading zeros and are only trimmed of spaces at the ends. Values that cannot be converted safely are reported as errors instead of being guessed.",
          )}
        </div>
      </Card>
    </div>
  );
}

function Samples({ stat, targets }: { stat: TransformStat; targets: { index: number; label: string }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = (i: number) => targets.find((x) => x.index === i)?.label ?? "";
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap gap-1.5">
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
                <th className="px-3 py-1.5 font-medium">{t("Before (original)")}</th>
                <th className="px-3 py-1.5 font-medium">{t("After (final file)")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stat.samples.map((s, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 text-slate-400">{s.row}</td>
                  <td className="px-3 py-1.5 text-slate-600">{label(s.target)}</td>
                  <td className="px-3 py-1.5 font-mono whitespace-pre text-red-700/80">{s.before === "" ? t("(blank)") : `“${s.before}”`}</td>
                  <td className="px-3 py-1.5 font-mono whitespace-pre text-emerald-700">“{s.after}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
