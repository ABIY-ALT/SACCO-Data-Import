"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Pencil, Trash2, Workflow } from "lucide-react";
import type { MappingTemplate } from "@/lib/types";
import { COLUMN_TYPE_LABELS } from "@/lib/types";
import { apiSend, fmtDateTime, useApi } from "@/lib/client/api";
import { useT } from "@/components/i18n";
import { Alert, Badge, Button, Card, CardTitle, EmptyState, LoadingBlock, Modal, PageHeader, inputClass } from "@/components/ui";

interface Alias {
  targetKey: string;
  sourceKey: string;
  targetLabel: string;
  sourceLabel: string;
  timesConfirmed: number;
  lastConfirmedAt: string;
}

export default function MappingsPage() {
  const t = useT();
  const mappings = useApi<{ mappings: MappingTemplate[] }>("/api/mappings");
  const aliases = useApi<{ aliases: Alias[] }>("/api/aliases");
  const [toDelete, setToDelete] = useState<MappingTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title={t("Mapping Templates")}
        description={t("Saved column mappings are applied automatically when the same SACCO template is uploaded again, so repeat imports take only a few clicks.")}
      />
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="space-y-6">
        {!mappings.data ? (
          <LoadingBlock />
        ) : mappings.data.mappings.length === 0 ? (
          <Card>
            <EmptyState icon={<Workflow className="h-10 w-10" />} title={t("No saved mappings yet")}>
              {t("When you generate a final file, tick “Remember this mapping” and it will appear here.")}
            </EmptyState>
          </Card>
        ) : (
          mappings.data.mappings.map((m) => <MappingCard key={m.id} m={m} onChanged={mappings.reload} onDelete={() => setToDelete(m)} onError={setError} />)
        )}

        <Card>
          <CardTitle sub={t("Column names you matched by hand. The next time these names appear, they are matched automatically.")}>{t("Remembered column names")}</CardTitle>
          {!aliases.data ? (
            <LoadingBlock />
          ) : aliases.data.aliases.length === 0 ? (
            <p className="text-sm text-slate-500">{t("Nothing remembered yet.")}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {aliases.data.aliases.map((a) => (
                <div key={`${a.targetKey}|${a.sourceKey}`} className="flex items-center gap-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{a.targetLabel}</span>
                  <ArrowLeft className="h-4 w-4 text-slate-300" />
                  <span className="text-slate-700">{a.sourceLabel}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {t("confirmed {n}× · {date}", { n: a.timesConfirmed, date: fmtDateTime(a.lastConfirmedAt) })}
                  </span>
                  <button
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={t("Forget")}
                    title={t("Forget this match")}
                    onClick={async () => {
                      try {
                        await apiSend("DELETE", `/api/aliases?target=${encodeURIComponent(a.targetKey)}&source=${encodeURIComponent(a.sourceKey)}`);
                        aliases.reload();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title={t("Delete saved mapping?")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              {t("Keep")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await apiSend("DELETE", `/api/mappings/${toDelete!.id}`);
                  mappings.reload();
                } catch (e) {
                  setError((e as Error).message);
                }
                setToDelete(null);
              }}
            >
              {t("Delete")}
            </Button>
          </>
        }
      >
        {t("“{name}” will no longer be applied automatically. Past imports are not affected.", { name: toDelete?.name ?? "" })}
      </Modal>
    </div>
  );
}

function MappingCard({ m, onChanged, onDelete, onError }: { m: MappingTemplate; onChanged: () => void; onDelete: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const mapped = m.entries.filter((e) => e.sourceHeader).length;
  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          {open ? <ChevronDown className="mt-1 h-4 w-4 text-slate-400" /> : <ChevronRight className="mt-1 h-4 w-4 text-slate-400" />}
          <div className="min-w-0">
            {editing ? null : <div className="truncate font-semibold text-slate-900">{m.name}</div>}
            <div className="mt-0.5 text-sm text-slate-500">
              {t("{a} template columns · {b} mapped · used {n}× · last used {date}", {
                a: m.templateHeaders.length,
                b: mapped,
                n: m.timesUsed,
                date: fmtDateTime(m.lastUsedAt),
              })}
            </div>
          </div>
        </button>
        {editing && (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiSend("PATCH", `/api/mappings/${m.id}`, { name });
                setEditing(false);
                onChanged();
              } catch (err) {
                onError((err as Error).message);
              }
            }}
          >
            <input className={inputClass({ h: "h-9" })} value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label={t("Mapping name")} />
            <Button size="sm" variant="primary" type="submit" className="h-9">
              {t("Save")}
            </Button>
          </form>
        )}
        {!editing && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} icon={<Pencil className="h-3.5 w-3.5" />}>
              {t("Rename")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} icon={<Trash2 className="h-3.5 w-3.5" />}>
              {t("Delete")}
            </Button>
          </div>
        )}
      </div>
      {open && (
        <div className="scroll-thin overflow-x-auto border-t border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2">{t("Template column")}</th>
                <th className="px-5 py-2">{t("Original column")}</th>
                <th className="px-5 py-2">{t("Type")}</th>
                <th className="px-5 py-2">{t("Rules")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {m.entries.map((e, i) => (
                <tr key={i}>
                  <td className="px-5 py-2 font-medium text-slate-800">{e.targetHeader}</td>
                  <td className="px-5 py-2 text-slate-700">
                    {e.useTemplate ? (
                      <span className="text-indigo-700">{t("From the template")}</span>
                    ) : (
                      (e.sourceLabel ?? <span className="text-slate-400">{e.defaultValue ? t("Default: “{v}”", { v: e.defaultValue }) : "—"}</span>)
                    )}
                  </td>
                  <td className="px-5 py-2">
                    <Badge tone="slate">{t(COLUMN_TYPE_LABELS[e.rule.type])}</Badge>
                  </td>
                  <td className="px-5 py-2 text-xs text-slate-500">
                    {[
                      e.rule.required && t("mandatory"),
                      e.rule.unique && t("unique"),
                      e.rule.type === "date" && e.rule.dateFormat,
                      e.rule.type === "phone" && t("phone: {f}", { f: e.rule.phoneFormat }),
                      e.rule.allowedValues.length > 0 && e.rule.allowedValues.join("/"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
