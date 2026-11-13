"use client";

import { Fragment, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_LANG, LANGS, translate, translateMessage, type Lang, type Vars } from "@/lib/i18n";
import { currentLang, setLang, subscribeLang } from "@/lib/client/lang";

export interface T {
  /** Translate a text written in the code. */
  (text: string, vars?: Vars): string;
  /** Translate a message that was filled in by the server (errors, warnings, reasons). */
  msg: (message: string | null | undefined) => string;
  /** Like t(), but <b>…</b> in the text is shown in bold. */
  rich: (text: string, vars?: Vars) => ReactNode;
  lang: Lang;
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, currentLang, () => DEFAULT_LANG);
}

function makeT(lang: Lang): T {
  const t = ((text: string, vars?: Vars) => translate(lang, text, vars)) as T;
  t.msg = (m) => translateMessage(lang, m);
  t.rich = (text, vars) => bold(translate(lang, text, vars));
  t.lang = lang;
  return t;
}

export function useT(): T {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}

function bold(text: string): ReactNode {
  const parts = text.split(/<b>([\s\S]*?)<\/b>/);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>));
}

/** Keeps <html lang> in step with the chosen language (screen readers, fonts, spelling). */
export function LangEffect() {
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return null;
}

/** አማርኛ | English switch. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const lang = useLang();
  return (
    <div role="radiogroup" aria-label="Language / ቋንቋ" className={`inline-flex rounded-lg bg-slate-100 p-0.5 text-xs ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={lang === l.code}
          onClick={() => setLang(l.code)}
          className={`rounded-md px-3 py-1 font-medium transition-colors ${lang === l.code ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
