"use client";

import { useEffect, useState } from "react";
import { Ban, Check, ChevronLeft, ChevronRight, Search, Undo2, UserSearch, Users } from "lucide-react";
import type { Issue, MemberCandidate, MemberMatchInfo, MemberMatchStatus, ProcessSummary, RowStatus } from "@/lib/types";
import { MEMBER_STATUS_LABELS } from "@/lib/types";
import { apiGet, apiSend, fmtNumber, useApi } from "@/lib/client/api";
import { Alert, Badge, Button, Card, LoadingBlock, inputClass, type BadgeTone } from "@/components/ui";
import { useT } from "@/components/i18n";
import type { CompareContext } from "./compare-stage";

type Filter = "attention" | "all" | "matched" | "not_found" | "skipped";

interface MemberRow extends MemberMatchInfo {
  i: number;
  excelRow: number;
  rowStatus: RowStatus;
  amount: number | null;
  issues: Issue[];
}

interface MembersResponse {
  rows: MemberRow[];
  total: number;
  page: number;
  pages: number;
  counts: Partial<Record<MemberMatchStatus, number>>;
}

const TONE: Record<MemberMatchStatus, BadgeTone> = {
  id: "green",
  exact: "green",
  remembered: "green",
  confirmed: "green",
  manual: "blue",
  suggested: "amber",
  ambiguous: "amber",
  not_found: "red",
  skipped: "slate",
};

const MATCHED: MemberMatchStatus[] = ["id", "exact", "remembered", "confirmed", "manual"];

export function membersAttention(summary: ProcessSummary): number {
  const c = summary.members ?? {};
  return (c.suggested ?? 0) + (c.ambiguous ?? 0) + (c.not_found ?? 0);
}

export function MembersStep({ ctx }: { ctx: CompareContext }) {
  const t = useT();
  const { importId, summary, version, setSummary, detail } = ctx;
  const counts = summary.members ?? {};
  const attention = membersAttention(summary);
  const [filter, setFilter] = useState<Filter>(attention > 0 ? "attention" : "all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const list = useApi<MembersResponse>(`/api/imports/${importId}/members?filter=${filter}&page=${page}&size=50&q=${encodeURIComponent(query)}&v=${version}`);
  const matched = MATCHED.reduce((a, s) => a + (counts[s] ?? 0), 0);
  const memberCount = detail.import.analysis?.fill.members ?? 0;

  async function act(body: { action: "set" | "skip" | "reset" | "confirm_suggested"; row?: number; memberId?: string }, key: string) {
    setBusy(key);
    setError(null);
    try {
      const r = await apiSend<{ summary: ProcessSummary }>("POST", `/api/imports/${importId}/members`, body);
      setSummary(r.summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const filters: { key: Filter; label: string; n: number }[] = [
    { key: "attention", label: t("Needs your decision"), n: attention },
    { key: "all", label: t("All rows"), n: summary.totalRows },
    { key: "matched", label: t("Matched"), n: matched },
    { key: "not_found", label: t("Not found"), n: counts.not_found ?? 0 },
    { key: "skipped", label: t("Not imported"), n: counts.skipped ?? 0 },
  ];
  const byYou = (counts.confirmed ?? 0) + (counts.manual ?? 0);

  return (
    <div className="space-y-5">
      <Alert tone="info" title={t("Matching each row to a member of the system")}>
        {t(
          "The template already lists {n} members. Each row of the original file is matched to one of them, so the final file uses the system’s own Member ID and name. Identical names are matched automatically; similar spellings and names shared by several members are only suggested — you decide. Your decisions are remembered for next month.",
          { n: memberCount },
        )}
      </Alert>

      {(counts.not_found ?? 0) >= 5 && (counts.not_found ?? 0) * 2 > summary.totalRows && (
        <Alert tone="warning" title={t("Most rows are not in this template’s member list — is it the right template?")}>
          {t.rich(
            "{n} of {total} rows have no member in “{file}”, which lists only {members} members. The template is probably for another group or branch. Go back to <b>Upload Files</b> and upload the template that lists these members — their IDs and names are then taken from it automatically.",
            { n: counts.not_found ?? 0, total: summary.totalRows, file: detail.import.template?.originalName ?? "", members: memberCount },
          )}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label={t("Matched")}
          value={matched}
          tone="text-emerald-700"
          hint={
            t("{a} same name · {b} remembered · {c} by you", { a: counts.exact ?? 0, b: counts.remembered ?? 0, c: byYou }) +
            (counts.id ? ` · ${t("{n} by ID", { n: counts.id })}` : "")
          }
        />
        <Stat label={t("Please confirm")} value={counts.suggested ?? 0} tone={counts.suggested ? "text-amber-700" : undefined} hint={t("similar spelling or same name")} />
        <Stat label={t("Several possible")} value={counts.ambiguous ?? 0} tone={counts.ambiguous ? "text-amber-700" : undefined} hint={t("choose the right member")} />
        <Stat label={t("Not in member list")} value={counts.not_found ?? 0} tone={counts.not_found ? "text-red-700" : undefined} hint={t("not imported until matched")} />
        <Stat label={t("Not imported (by you)")} value={counts.skipped ?? 0} hint={t("marked as not a member")} />
      </div>

      {(counts.suggested ?? 0) > 1 && (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 text-sm text-slate-600">
            {t.rich("<b>{n} suggestions</b> are waiting. Check them in the list below, or confirm all of them at once if you have reviewed them.", { n: counts.suggested ?? 0 })}
          </div>
          <Button variant="subtle" loading={busy === "all"} icon={<Check className="h-4 w-4" />} onClick={() => act({ action: "confirm_suggested" }, "all")}>
            {t("Confirm all {n} suggestions", { n: counts.suggested ?? 0 })}
          </Button>
        </Card>
      )}

      {error && <Alert tone="error">{error}</Alert>}

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
                <span className={`ml-1.5 tabular-nums ${filter === f.key ? "text-white/80" : "text-slate-400"}`}>{fmtNumber(f.n)}</span>
              </button>
            ))}
          </div>
          <div className="relative lg:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={inputClass({ px: "pl-9 pr-3" })}
              placeholder={t("Search name or member ID")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        {!list.data ? (
          <LoadingBlock label={t("Loading members…")} />
        ) : list.data.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-slate-500">
            <Users className="h-8 w-8 text-slate-300" />
            {filter === "attention" ? t("Nothing needs your decision — every row is matched or marked.") : t("No rows in this list.")}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {list.data.rows.map((r) => (
              <MemberRowView key={r.i} r={r} importId={importId} busy={busy} onAct={act} />
            ))}
          </div>
        )}
        {list.data && list.data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>{t("{n} rows · page {p} of {pages}", { n: list.data.total, p: list.data.page, pages: list.data.pages })}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={list.data.page <= 1} onClick={() => setPage(list.data!.page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
                {t("Previous")}
              </Button>
              <Button size="sm" disabled={list.data.page >= list.data.pages} onClick={() => setPage(list.data!.page + 1)}>
                {t("Next")} <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>{fmtNumber(value)}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function MemberRowView({
  r,
  importId,
  busy,
  onAct,
}: {
  r: MemberRow;
  importId: string;
  busy: string | null;
  onAct: (body: { action: "set" | "skip" | "reset"; row: number; memberId?: string }, key: string) => void;
}) {
  const t = useT();
  const [choosing, setChoosing] = useState(r.status === "ambiguous" || r.status === "not_found");
  const isMatched = MATCHED.includes(r.status);
  const overridden = r.status === "confirmed" || r.status === "manual" || r.status === "skipped";
  return (
    <div className={`px-4 py-3 ${r.status === "suggested" || r.status === "ambiguous" ? "bg-amber-50/40" : r.status === "not_found" ? "bg-red-50/30" : ""}`} data-testid="member-row">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="w-14 shrink-0 pt-0.5 text-xs text-slate-400">{t("Row {n}", { n: r.excelRow })}</div>
        <div className="min-w-0 lg:w-64">
          <div className="text-xs text-slate-500">{t("In the original file")}</div>
          <div className="truncate font-medium text-slate-900">{r.sourceName || <span className="italic text-slate-400">{t("(no name)")}</span>}</div>
          {r.sourceKey && <div className="text-xs text-slate-500">{t("ID: {id}", { id: r.sourceKey })}</div>}
          {r.amount !== null && <div className="text-xs text-slate-500">{t("Amount: {n}", { n: r.amount })}</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[r.status]}>{t(MEMBER_STATUS_LABELS[r.status])}</Badge>
            {r.member && (
              <span className="text-sm">
                <span className="font-mono text-slate-600">{r.member.id}</span> <span className="font-medium text-slate-900">{r.member.name}</span>
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500">{t.msg(r.reason)}</div>
          {choosing && <Chooser r={r} importId={importId} busy={busy} onPick={(id) => onAct({ action: "set", row: r.i, memberId: id }, `set-${r.i}`)} />}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {r.status === "suggested" && r.member && (
            <Button size="sm" variant="primary" loading={busy === `set-${r.i}`} icon={<Check className="h-3.5 w-3.5" />} onClick={() => onAct({ action: "set", row: r.i, memberId: r.member!.id }, `set-${r.i}`)}>
              {t("Confirm")}
            </Button>
          )}
          {r.status !== "skipped" && !choosing && (
            <Button size="sm" variant="secondary" icon={<UserSearch className="h-3.5 w-3.5" />} onClick={() => setChoosing(true)}>
              {isMatched ? t("Change") : t("Choose member")}
            </Button>
          )}
          {overridden && (
            <Button size="sm" variant="ghost" loading={busy === `reset-${r.i}`} icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => onAct({ action: "reset", row: r.i }, `reset-${r.i}`)}>
              {r.status === "skipped" ? t("Include again") : t("Undo")}
            </Button>
          )}
          {r.status !== "skipped" && (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === `skip-${r.i}`}
              icon={<Ban className="h-3.5 w-3.5" />}
              onClick={() => onAct({ action: "skip", row: r.i }, `skip-${r.i}`)}
              title={t("This row is not a member — do not import it")}
            >
              {t("Not a member")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Chooser({ r, importId, busy, onPick }: { r: MemberRow; importId: string; busy: string | null; onPick: (id: string) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const timer = setTimeout(() => {
      apiGet<{ members: { id: string; name: string }[] }>(`/api/imports/${importId}/members/search?q=${encodeURIComponent(q)}`)
        .then((d) => setResults(d.members))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, importId]);
  const options: MemberCandidate[] = r.candidates.filter((c) => c.id !== r.member?.id || r.status !== "suggested");
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
      {options.length > 0 && (
        <>
          <div className="mb-1.5 text-xs font-medium text-slate-500">{t("Possible members")}</div>
          <div className="flex flex-wrap gap-1.5">
            {options.map((c) => (
              <button
                key={c.id}
                disabled={busy !== null}
                onClick={() => onPick(c.id)}
                className="rounded-md border border-slate-200 px-2 py-1 text-left text-xs hover:border-brand-400 hover:bg-brand-50"
              >
                <span className="font-mono text-slate-500">{c.id}</span> <span className="font-medium text-slate-800">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-2">
        <input
          className={inputClass({ h: "h-9" })}
          placeholder={t("Search the member list by name or ID…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("Search members")}
        />
        {q.trim().length >= 2 && results && (
          <div className="mt-1.5 max-h-48 overflow-y-auto">
            {results.length === 0 && <div className="px-1 py-1 text-xs text-slate-500">{t("No member found.")}</div>}
            {results.map((m) => (
              <button key={m.id} disabled={busy !== null} onClick={() => onPick(m.id)} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-brand-50">
                <span className="font-mono text-slate-500">{m.id}</span> <span className="font-medium text-slate-800">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
