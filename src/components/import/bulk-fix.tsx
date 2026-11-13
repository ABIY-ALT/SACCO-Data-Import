"use client";

import { useState } from "react";
import { Ban, ChevronDown, ChevronRight, FileSpreadsheet, Replace } from "lucide-react";
import type { IssueStat, ProcessSummary } from "@/lib/types";
import { apiSend } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Button, Card, Field, Modal, inputCls, inputClass } from "@/components/ui";
import type { CompareContext } from "./compare-stage";

type Op = "exclude" | "set" | "template" | "replace";

/** Send a bulk fix to the server; returns how many rows changed. */
function useBulk(ctx: CompareContext) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const t = useT();
  async function run(body: { op: Op; code?: string; col?: number; value?: string; find?: string }) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await apiSend<{ summary: ProcessSummary; changed: number }>("POST", `/api/imports/${ctx.importId}/bulk`, body);
      ctx.setSummary(r.summary);
      setMessage({ tone: "success", text: r.changed === 1 ? t("{n} row changed.", { n: 1 }) : t("{n} rows changed.", { n: r.changed }) });
      return true;
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, run };
}

/** Under a selected problem: fix every row with that problem at once. */
export function ProblemFix({ ctx, issue }: { ctx: CompareContext; issue: IssueStat }) {
  const t = useT();
  const targets = ctx.detail.import.analysis!.targets;
  const fill = ctx.config.mode === "fill" ? ctx.config.fill : null;
  const col = issue.col >= 0 ? targets.find((x) => x.index === issue.col) : undefined;
  const memberCol = Boolean(fill && (issue.col === fill.keyTarget || issue.col === fill.nameTarget));
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<Op | null>(null);
  const { busy, message, run } = useBulk(ctx);
  const n = issue.count;

  return (
    <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
      <div className="text-sm font-medium text-slate-800">{t("Fix all {n} rows with this problem at once:", { n })}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setPending("exclude")}>
          {t("Exclude these rows")}
        </Button>
        {col && !memberCol && (
          <>
            <span className="text-xs text-slate-400">{t("or")}</span>
            <input
              className={inputClass({ h: "h-8", w: "w-44" })}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("New value")}
              aria-label={t("New value for {col}", { col: col.label })}
            />
            <Button size="sm" variant="secondary" onClick={() => setPending("set")}>
              {t("Use this value for all")}
            </Button>
            {fill && (
              <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => setPending("template")}>
                {t("Use the template's value")}
              </Button>
            )}
          </>
        )}
      </div>
      {message && (
        <Alert tone={message.tone} className="mt-2">
          {message.text}
        </Alert>
      )}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={n === 1 ? t("Change {n} row?", { n: 1 }) : t("Change {n} rows?", { n })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                await run({ op: pending!, code: issue.code, col: issue.col, value });
                setPending(null);
              }}
            >
              {t("Change")}
            </Button>
          </>
        }
      >
        {pending === "exclude" && t("The {n} rows with this problem will be left out of the final file.", { n })}
        {pending === "set" && t("Column “{col}” of the {n} rows gets the value “{v}”.", { col: col?.label ?? "", n, v: value || t("(blank)") })}
        {pending === "template" && t("Column “{col}” of the {n} rows gets the template's value.", { col: col?.label ?? "", n })}{" "}
        {t("You can undo each row later in the row inspector.")}
      </Modal>
    </div>
  );
}

/** Replace one original value with another in a whole column (e.g. "-" → 0); empty "find" fills empty cells. */
export function FindReplace({ ctx }: { ctx: CompareContext }) {
  const t = useT();
  const targets = ctx.detail.import.analysis!.targets;
  const fill = ctx.config.mode === "fill" ? ctx.config.fill : null;
  const columns = targets.filter((x) => !(fill && (x.index === fill.keyTarget || x.index === fill.nameTarget)));
  const [open, setOpen] = useState(false);
  const [col, setCol] = useState<number>(columns[0]?.index ?? 0);
  const [find, setFind] = useState("");
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { busy, message, run } = useBulk(ctx);
  const label = targets.find((x) => x.index === col)?.label ?? "";

  return (
    <Card padded={false}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        <Replace className="h-4 w-4 text-slate-400" />
        <span className="text-base font-semibold text-slate-900">{t("Find and replace")}</span>
        <span className="text-sm text-slate-500">— {t("change the same value in many rows at once")}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-200 px-5 py-4">
          <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end">
            <Field label={t("Column")}>
              <select className={inputCls} value={col} onChange={(e) => setCol(Number(e.target.value))}>
                {columns.map((x) => (
                  <option key={x.index} value={x.index}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Find (value in the original file)")}>
              <input className={inputCls} value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("empty cells")} />
            </Field>
            <Field label={t("Replace with")}>
              <input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Button variant="secondary" icon={<Replace className="h-4 w-4" />} onClick={() => setConfirm(true)}>
              {t("Replace all")}
            </Button>
          </div>
          <p className="text-xs text-slate-500">{t("Not case-sensitive. Leave “Find” empty to fill the empty cells of the column. Each changed cell can be undone in the row inspector.")}</p>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
        </div>
      )}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("Replace in column “{col}”?", { col: label })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                await run({ op: "replace", col, find, value });
                setConfirm(false);
              }}
            >
              {t("Replace all")}
            </Button>
          </>
        }
      >
        {find.trim() === ""
          ? t("Every empty cell of column “{col}” gets “{v}”.", { col: label, v: value || t("(blank)") })
          : t("Every row whose original value in column “{col}” is “{find}” gets “{v}”.", { col: label, find, v: value || t("(blank)") })}
      </Modal>
    </Card>
  );
}
