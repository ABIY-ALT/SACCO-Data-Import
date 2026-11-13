// The language chosen in this browser. Amharic unless the user switched to English.

import { DEFAULT_LANG, type Lang } from "@/lib/i18n";

const KEY = "sacco-import-lang";
const listeners = new Set<() => void>();
let memory: Lang | null = null; // used when the browser does not allow storage

function stored(): Lang | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "am" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

/** Current language (Amharic on the server and before the browser has loaded). */
export function currentLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  return memory ?? stored() ?? DEFAULT_LANG;
}

export function setLang(lang: Lang) {
  memory = lang;
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
  for (const l of listeners) l();
}

export function subscribeLang(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
