"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, Pencil, X } from "lucide-react";
import type { AppSettings, ImportDetailResponse } from "@/lib/types";
import { apiGet, apiSend, fmtDateTime, useApi } from "@/lib/client/api";
import { Alert, Button, LoadingBlock, Modal, PageHeader, StatusBadge, buttonClass, inputClass } from "@/components/ui";
import { useT } from "@/components/i18n";
import { Stepper, type Stage } from "./stepper";
import { UploadStage } from "./upload-stage";
import { CompareStage } from "./compare-stage";
import { DownloadStage } from "./download-stage";

function useUploadSettings() {
  const s = useApi<{ settings: AppSettings; uploadMode?: "blob" | "server" }>("/api/settings");
  return { maxUploadMb: s.data?.settings.maxUploadMb ?? 50, uploadMode: s.data?.uploadMode ?? "server" };
}

/** /imports/new — the import record is created when the first file is dropped. */
export function NewImport() {
  const t = useT();
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const creating = useRef<Promise<string> | null>(null);
  const detail = useApi<ImportDetailResponse>(id ? `/api/imports/${id}` : null);
  const { maxUploadMb, uploadMode } = useUploadSettings();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const ensureImport = useCallback(() => {
    if (id) return Promise.resolve(id);
    creating.current ??= apiSend<{ id: string }>("POST", "/api/imports", {})
      .then((r) => {
        setId(r.id);
        return r.id;
      })
      .catch((e) => {
        creating.current = null;
        throw e;
      });
    return creating.current;
  }, [id]);

  async function analyze() {
    if (!id) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      await apiSend("POST", `/api/imports/${id}/analyze`, {});
      router.push(`/imports/${id}`);
      // reset so this page is fresh the next time it is opened
      setId(null);
      creating.current = null;
    } catch (e) {
      setAnalyzeError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("New Data Import")}
        description={t(
          "Upload the official template from your SACCO system and the file with your data. The system compares them and builds a file that matches the template exactly.",
        )}
      />
      <Stepper current="upload" reachable={["upload"]} />
      <UploadStage
        importId={id}
        detail={detail.data ?? null}
        maxUploadMb={maxUploadMb}
        uploadMode={uploadMode}
        ensureImport={ensureImport}
        onChanged={detail.reload}
        onAnalyze={analyze}
        analyzing={analyzing}
        analyzeError={analyzeError}
      />
    </div>
  );
}

/** /imports/[id] — resume or view an import. */
export function ImportWorkspace({ id }: { id: string }) {
  const t = useT();
  const { data: detail, error, reload, setData } = useApi<ImportDetailResponse>(`/api/imports/${id}`);
  const { maxUploadMb, uploadMode } = useUploadSettings();
  const [view, setView] = useState<Stage | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [compareKey, setCompareKey] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  if (error && !detail)
    return (
      <div className="space-y-4">
        <PageHeader title={t("Import")} />
        <Alert tone="error" title={t("This import could not be loaded")}>
          {error}
        </Alert>
        <Link href="/history" className={buttonClass()}>
          {t("Back to Import History")}
        </Link>
      </div>
    );
  if (!detail) return <LoadingBlock label={t("Loading import…")} />;

  const imp = detail.import;
  const status = imp.status;
  const finished = status === "completed" || status === "failed";
  const natural: Stage = status === "draft" || status === "cancelled" ? "upload" : status === "mapping" ? "compare" : "download";
  let stage: Stage = view ?? natural;
  if (finished) stage = "download";
  if (status === "draft" || status === "cancelled") stage = "upload";
  const reachable: Stage[] = finished ? ["download"] : status === "mapping" ? ["upload", "compare", "download"] : ["upload"];

  /** Change stage: save pending edits first and reload, so every stage starts from the latest saved state. */
  async function navigate(next: Stage) {
    await flushRef.current?.();
    const d = await apiGet<ImportDetailResponse>(`/api/imports/${id}`);
    setData(d);
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function analyze(mappingTemplateId?: string) {
    // Files unchanged since the last comparison: just continue (keeps your mapping work).
    if (status === "mapping" && mappingTemplateId === undefined) {
      await navigate("compare");
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      // Save anything pending first, so it cannot land after (and overwrite) the fresh analysis.
      await flushRef.current?.();
      const d = await apiSend<ImportDetailResponse>("POST", `/api/imports/${id}/analyze`, mappingTemplateId ? { mappingTemplateId } : {});
      setData(d);
      setCompareKey((k) => k + 1);
      setView("compare");
    } catch (e) {
      setAnalyzeError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  const goToDownload = () => navigate("download");

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <ImportName id={id} name={imp.name} editable={!finished && status !== "cancelled"} onSaved={setData} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusBadge status={status} />
            <span>{t("Started {date}", { date: fmtDateTime(imp.createdAt) })}</span>
            {imp.template && <span>· {t("Template: {name}", { name: imp.template.originalName })}</span>}
            {imp.source && <span>· {t("Data: {name}", { name: imp.source.originalName })}</span>}
          </div>
        </div>
        {!finished && status !== "cancelled" && (
          <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>
            {t("Cancel import")}
          </Button>
        )}
      </div>

      {status === "cancelled" && (
        <Alert
          tone="warning"
          className="mb-5"
          title={t("This import was cancelled")}
          action={
            <Link href="/imports/new" className={buttonClass("primary", "sm")}>
              {t("Start a new import")}
            </Link>
          }
        >
          {t("The uploaded files are kept for auditing until the retention period ends.")}
        </Alert>
      )}

      <Stepper
        current={stage}
        reachable={reachable}
        allDone={status === "completed"}
        onSelect={(s) => void navigate(s)}
      />

      {stage === "upload" && status !== "cancelled" && (
        <>
          {status === "mapping" && (
            <Alert tone="info" className="mb-4">
              {t("Replacing a file or changing the header row starts the comparison again. If you keep the files, your mapping work is kept.")}
            </Alert>
          )}
          <UploadStage
            importId={id}
            detail={detail}
            maxUploadMb={maxUploadMb}
            uploadMode={uploadMode}
            ensureImport={() => Promise.resolve(id)}
            onChanged={reload}
            onAnalyze={() => analyze()}
            analyzing={analyzing}
            analyzeError={analyzeError}
          />
        </>
      )}
      {stage === "compare" && imp.config && imp.summary && (
        <CompareStage
          key={compareKey}
          detail={detail}
          onContinue={goToDownload}
          onBackToUpload={() => void navigate("upload")}
          onReanalyze={(m) => analyze(m)}
          flushRef={flushRef}
        />
      )}
      {stage === "download" && (
        <DownloadStage
          detail={detail}
          onGenerated={(d) => {
            setData(d);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onBack={() => void navigate("compare")}
        />
      )}

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t("Cancel this import?")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              {t("Keep working")}
            </Button>
            <Button
              variant="danger"
              loading={cancelling}
              onClick={async () => {
                setCancelling(true);
                try {
                  setData(await apiSend<ImportDetailResponse>("PATCH", `/api/imports/${id}`, { action: "cancel" }));
                  setCancelOpen(false);
                } finally {
                  setCancelling(false);
                }
              }}
            >
              {t("Cancel import")}
            </Button>
          </>
        }
      >
        {t(
          "No final file will be generated. The import stays in the history as “Cancelled” and the uploaded files are kept for auditing until the retention period ends.",
        )}
      </Modal>
    </div>
  );
}

function ImportName({ id, name, editable, onSaved }: { id: string; name: string; editable: boolean; onSaved: (d: ImportDetailResponse) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  if (!editing)
    return (
      <div className="flex items-center gap-2">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{name}</h1>
        {editable && (
          <button
            onClick={() => {
              setValue(name);
              setEditing(true);
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={t("Rename import")}
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setSaving(true);
        try {
          onSaved(await apiSend<ImportDetailResponse>("PATCH", `/api/imports/${id}`, { name: value }));
          setEditing(false);
        } finally {
          setSaving(false);
        }
      }}
    >
      <input className={inputClass({ w: "w-full max-w-md", text: "text-lg font-semibold" })} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label={t("Import name")} />
      <Button type="submit" size="sm" variant="primary" loading={saving} icon={<Check className="h-4 w-4" />}>
        {t("Save")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} icon={<X className="h-4 w-4" />}>
        {t("Cancel")}
      </Button>
    </form>
  );
}
