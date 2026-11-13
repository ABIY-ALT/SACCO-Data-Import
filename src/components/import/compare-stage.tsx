"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ImportConfig, ImportDetailResponse, ProcessSummary } from "@/lib/types";
import { apiSend } from "@/lib/client/api";
import { Alert, Button } from "@/components/ui";
import { MappingStep } from "./mapping-step";
import { CleaningStep } from "./cleaning-step";
import { ValidationStep } from "./validation-step";
import { MembersStep, membersAttention } from "./members-step";
import { useT } from "@/components/i18n";

export type SubStep = "mapping" | "members" | "cleaning" | "validation";

export interface CompareContext {
  importId: string;
  detail: ImportDetailResponse;
  config: ImportConfig;
  summary: ProcessSummary;
  version: number; // increments every time the server re-validates
  update: (next: ImportConfig) => void;
  setSummary: (s: ProcessSummary) => void;
}

export function mappingAttention(config: ImportConfig, summary: ProcessSummary): number {
  const pending = config.mappings.filter((m) => m.status === "possible" && !m.confirmed && m.source !== null && !(config.mode === "fill" && m.useTemplate)).length;
  // Fill mode: columns without original data keep the template's values, so nothing mandatory is missing.
  const missingRequired = config.mode === "fill" ? 0 : config.mappings.filter((m) => m.rule.required && m.source === null && m.defaultValue === "").length;
  return pending + missingRequired + summary.approvalsNeeded.length;
}

export function CompareStage({
  detail,
  onContinue,
  onBackToUpload,
  onReanalyze,
  flushRef,
}: {
  detail: ImportDetailResponse;
  onContinue: () => void;
  onBackToUpload: () => void;
  onReanalyze: (mappingTemplateId: string) => Promise<void>;
  /** Lets the parent save pending changes before navigating away (e.g. via the stepper). */
  flushRef?: React.RefObject<(() => Promise<void>) | null>;
}) {
  const t = useT();
  const imp = detail.import;
  const id = imp.id;
  const [config, setConfig] = useState<ImportConfig>(imp.config!);
  const [summary, setSummaryState] = useState<ProcessSummary>(imp.summary!);
  const [version, setVersion] = useState(0);
  const [step, setStep] = useState<SubStep>("mapping");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ImportConfig | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const send = useCallback(
    (next: ImportConfig) => {
      const my = ++seq.current;
      const p = apiSend<{ summary: ProcessSummary }>("POST", `/api/imports/${id}/process`, { config: next })
        .then((r) => {
          if (my !== seq.current) return;
          setSummaryState(r.summary);
          setVersion((v) => v + 1);
          setSaveState("saved");
          setError(null);
        })
        .catch((e: Error) => {
          if (my !== seq.current) return;
          setSaveState("error");
          setError(e.message);
        });
      inflight.current = p;
      return p;
    },
    [id],
  );

  const update = useCallback(
    (next: ImportConfig) => {
      setConfig(next);
      setSaveState("saving");
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const cfg = pending.current;
        pending.current = null;
        if (cfg) void send(cfg);
      }, 350);
    },
    [send],
  );

  /** Make sure the latest changes are saved and validated. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) {
      const cfg = pending.current;
      pending.current = null;
      await send(cfg);
    } else if (inflight.current) await inflight.current;
  }, [send]);

  useEffect(() => {
    if (flushRef) flushRef.current = flush;
  }, [flush, flushRef]);

  // Leaving the page: never drop a change that is still waiting to be saved.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) {
        void apiSend("POST", `/api/imports/${id}/process`, { config: pending.current }).catch(() => {});
        pending.current = null;
      }
    },
    [id],
  );

  const setSummary = useCallback((s: ProcessSummary) => {
    setSummaryState(s);
    setVersion((v) => v + 1);
  }, []);

  const ctx: CompareContext = { importId: id, detail, config, summary, version, update, setSummary };
  const attention = mappingAttention(config, summary);
  const changed = summary.transforms.filter((x) => x.key !== "edit" && x.key !== "default").reduce((a, x) => a + x.cells, 0);

  // Fill mode: the template lists the members, so each row is matched to (and corrected from) that list.
  const fillMode = config.mode === "fill";
  const memberAttention = membersAttention(summary);
  const allTabs: { key: SubStep; label: string; badge: React.ReactNode }[] = [
    {
      key: "mapping",
      label: t("Column mapping"),
      badge: attention ? <Count tone="amber" n={attention} title={t("Items need your attention")} /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    },
    {
      key: "members",
      label: t("Members"),
      badge: memberAttention ? <Count tone="amber" n={memberAttention} title={t("Rows need your decision")} /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    },
    { key: "cleaning", label: t("Cleaning"), badge: <Count tone="slate" n={changed} title={t("Cells changed by cleaning")} /> },
    {
      key: "validation",
      label: t("Validation & preview"),
      badge: summary.withErrors ? <Count tone="red" n={summary.withErrors} title={t("Records with errors")} /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    },
  ];
  const tabs = allTabs.filter((tab) => tab.key !== "members" || fillMode).map((tab, i) => ({ ...tab, label: `${i + 1}. ${tab.label}` }));
  const order: SubStep[] = tabs.map((tab) => tab.key);
  const idx = Math.max(0, order.indexOf(step));
  const nextLabel = idx < order.length - 1 ? allTabs.find((tab) => tab.key === order[idx + 1])!.label : "";

  async function go(next: SubStep) {
    await flush();
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={step === tab.key}
              onClick={() => void go(tab.key)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                step === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
              {tab.badge}
            </button>
          ))}
        </div>
        <SaveIndicator state={saveState} />
      </div>

      {error && (
        <Alert tone="error" className="mb-4" title={t("Your last change could not be checked")}>
          {error}
        </Alert>
      )}

      {step === "mapping" && <MappingStep ctx={ctx} onReanalyze={onReanalyze} />}
      {step === "members" && fillMode && <MembersStep ctx={ctx} />}
      {step === "cleaning" && <CleaningStep ctx={ctx} />}
      {step === "validation" && <ValidationStep ctx={ctx} />}

      <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => (idx === 0 ? onBackToUpload() : void go(order[idx - 1]))}>
          {idx === 0 ? t("Back to files") : t("Back")}
        </Button>
        {idx < order.length - 1 ? (
          <Button variant="primary" size="lg" icon={<ArrowRight className="h-5 w-5" />} onClick={() => void go(order[idx + 1])}>
            {t("Continue to {step}", { step: nextLabel })}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={<ArrowRight className="h-5 w-5" />}
            onClick={async () => {
              await flush();
              onContinue();
            }}
          >
            {t("Continue to download")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Count({ n, tone, title }: { n: number; tone: "amber" | "red" | "slate"; title: string }) {
  const cls = { amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-700", slate: "bg-slate-200 text-slate-700" }[tone];
  return (
    <span title={title} className={`min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${cls}`}>
      {n.toLocaleString("en-US")}
    </span>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const t = useT();
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("Checking data…")}
      </span>
    );
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> {t("Saved & checked")}
      </span>
    );
  if (state === "error")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-red-700">
        <XCircle className="h-4 w-4" /> {t("Not saved")}
      </span>
    );
  return <span className="text-sm text-slate-400">{t("All changes are saved automatically")}</span>;
}
