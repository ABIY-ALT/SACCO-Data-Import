"use client";

import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import type { AppSettings } from "@/lib/types";
import { apiSend, useApi } from "@/lib/client/api";
import { LangSwitch, useT } from "@/components/i18n";
import { Alert, Button, Card, CardTitle, Field, LoadingBlock, PageHeader, Toggle, inputCls } from "@/components/ui";

export default function SettingsPage() {
  const { data, error } = useApi<{ settings: AppSettings }>("/api/settings");
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <LoadingBlock />;
  return <SettingsForm initial={data.settings} />;
}

function SettingsForm({ initial }: { initial: AppSettings }) {
  const t = useT();
  const [s, setS] = useState<AppSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setS((x) => ({ ...x, [k]: v }));

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const r = await apiSend<{ settings: AppSettings }>("PUT", "/api/settings", s);
      setS(r.settings);
      setMessage({ tone: "success", text: t("Settings saved. They apply to new comparisons.") });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("Settings")}
        description={t("Defaults used when comparing and validating files. Each import can still override them per column.")}
        actions={
          <Button variant="primary" loading={saving} onClick={save} icon={<Save className="h-4 w-4" />}>
            {t("Save settings")}
          </Button>
        }
      />
      {message && (
        <Alert tone={message.tone} className="mb-5">
          {message.text}
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4">
          <CardTitle sub={t("The language of the screens, messages and reports in this browser. Your data is never translated.")}>{t("Language")}</CardTitle>
          <LangSwitch />
        </Card>

        <Card className="space-y-4">
          <CardTitle sub={t("Shown on reports.")}>{t("Organization")}</CardTitle>
          <Field label={t("SACCO / organization name")}>
            <input
              className={inputCls}
              value={s.organizationName}
              onChange={(e) => set("organizationName", e.target.value)}
              placeholder={t("e.g. ABC Savings & Credit Cooperative")}
            />
          </Field>
        </Card>

        <Card className="space-y-4">
          <CardTitle sub={t("Uploaded originals and generated files are deleted after this period. Import history and statistics are kept.")}>
            {t("Files & retention")}
          </CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Keep files for (days)")}>
              <input type="number" min={1} max={3650} className={inputCls} value={s.retentionDays} onChange={(e) => set("retentionDays", Number(e.target.value))} />
            </Field>
            <Field label={t("Maximum upload size (MB)")}>
              <input type="number" min={1} max={500} className={inputCls} value={s.maxUploadMb} onChange={(e) => set("maxUploadMb", Number(e.target.value))} />
            </Field>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={cleaning}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={async () => {
              setCleaning(true);
              try {
                const r = await apiSend<{ purged: number }>("POST", "/api/maintenance/retention");
                setMessage({ tone: "success", text: r.purged ? t("Deleted the files of {n} expired import(s).", { n: r.purged }) : t("No expired files to delete.") });
              } catch (e) {
                setMessage({ tone: "error", text: (e as Error).message });
              } finally {
                setCleaning(false);
              }
            }}
          >
            {t("Delete expired files now")}
          </Button>
        </Card>

        <Card className="space-y-4">
          <CardTitle sub={t("Used to check and standardize phone numbers.")}>{t("Phone numbers")}</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Country calling code")} hint={t("e.g. 251 Ethiopia, 254 Kenya, 256 Uganda, 255 Tanzania")}>
              <input className={inputCls} value={s.countryCode} onChange={(e) => set("countryCode", e.target.value)} />
            </Field>
            <Field label={t("Digits after the leading 0")} hint={t("9 for 0912345678")}>
              <input type="number" min={6} max={12} className={inputCls} value={s.nationalNumberLength} onChange={(e) => set("nationalNumberLength", Number(e.target.value))} />
            </Field>
          </div>
          <Field label={t("Default phone format in the final file")}>
            <select className={inputCls} value={s.phoneFormat} onChange={(e) => set("phoneFormat", e.target.value as AppSettings["phoneFormat"])}>
              <option value="local">{t("Local, with leading 0 (0912345678)")}</option>
              <option value="international">{t("International with + (+{cc}912345678)", { cc: s.countryCode })}</option>
              <option value="international_no_plus">{t("International without + ({cc}912345678)", { cc: s.countryCode })}</option>
            </select>
          </Field>
          <Toggle
            checked={s.phoneUnique}
            onChange={(v) => set("phoneUnique", v)}
            label={t("Phone numbers must be unique")}
            description={t("Two members with the same phone number are reported as duplicates.")}
          />
        </Card>

        <Card className="space-y-4">
          <CardTitle sub={t("Used when the template does not say which format it expects.")}>{t("Dates & gender")}</CardTitle>
          <Field label={t("Default date format in the final file")} hint={t("e.g. DD/MM/YYYY, YYYY-MM-DD, DD-MMM-YYYY")}>
            <input className={inputCls} value={s.dateFormat} onChange={(e) => set("dateFormat", e.target.value.toUpperCase())} />
          </Field>
          <Field label={t("When a date like 03/04/1990 is unclear, read it as")} hint={t("Used only when the file itself does not make the order clear.")}>
            <select className={inputCls} value={s.dateOrder} onChange={(e) => set("dateOrder", e.target.value as AppSettings["dateOrder"])}>
              <option value="DMY">{t("Day / Month / Year (3 April 1990)")}</option>
              <option value="MDY">{t("Month / Day / Year (March 4, 1990)")}</option>
            </select>
          </Field>
          <Field label={t("Gender values when the template does not specify")}>
            <select className={inputCls} value={s.genderStyle} onChange={(e) => set("genderStyle", e.target.value as AppSettings["genderStyle"])}>
              <option value="M/F">M / F</option>
              <option value="Male/Female">Male / Female</option>
            </select>
          </Field>
        </Card>
      </div>
    </div>
  );
}
