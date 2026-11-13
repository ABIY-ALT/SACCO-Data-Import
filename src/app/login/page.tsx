"use client";

import { useState } from "react";
import { FileSpreadsheet, LogIn } from "lucide-react";
import { apiSend } from "@/lib/client/api";
import { LangSwitch, useT } from "@/components/i18n";
import { Alert, Button, inputCls } from "@/components/ui";

export default function LoginPage() {
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", { password });
      // Back to the page that asked for the login (only pages of this app).
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  // Covers the whole window, including the menu.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">{t("SACCO Data Import")}</div>
            <div className="text-xs text-slate-500">{t("Please log in to continue.")}</div>
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{t("Password")}</span>
          <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && (
          <Alert tone="error" className="mt-3">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy} icon={<LogIn className="h-4 w-4" />}>
          {t("Log in")}
        </Button>
        <div className="mt-5 flex justify-center">
          <LangSwitch />
        </div>
      </form>
    </div>
  );
}
