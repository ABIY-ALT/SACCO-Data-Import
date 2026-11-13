// Translation engine shared by the browser and the server.
//
// Texts are written in English in the code and looked up in the Amharic dictionary (./am.ts), which is keyed by the
// English text. `{name}` marks a value that is filled in, e.g. t("{n} records", { n: 5 }).
// Messages that the server already filled in (errors, warnings, reasons) are translated with translateMessage():
// it finds the dictionary entry whose `{…}` pattern matches the whole message and fills the values back in.
// A text without an Amharic entry is shown in English, so nothing ever disappears.

import { AM } from "./am";

export type Lang = "am" | "en";
export const DEFAULT_LANG: Lang = "am";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "am", label: "አማርኛ" },
  { code: "en", label: "English" },
];

export type Vars = Record<string, string | number | null | undefined>;

/** Marks a text for translation where it is defined (e.g. in a constant); it is translated where it is shown. */
export const tk = (text: string) => text;

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 10 });

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in vars)) return m;
    const v = vars[k];
    return v === null || v === undefined ? "" : typeof v === "number" ? NUMBER.format(v) : v;
  });
}

/** Translate a text written in the code. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  if (lang === "am") {
    const hit = AM[text];
    if (hit !== undefined) return fill(hit, vars);
  }
  return fill(text, vars);
}

// ------------------------------------------------------------------ messages that were filled in by the server

interface Pattern {
  re: RegExp;
  names: string[];
  am: string;
}

let patterns: Pattern[] | null = null;

function compile(): Pattern[] {
  const list: Pattern[] = [];
  for (const [en, am] of Object.entries(AM)) {
    if (!en.includes("{")) continue;
    const names: string[] = [];
    let src = "";
    let last = 0;
    for (const m of en.matchAll(/\{(\w+)\}/g)) {
      src += escapeRe(en.slice(last, m.index)) + "([\\s\\S]*?)";
      names.push(m[1]);
      last = m.index! + m[0].length;
    }
    src += escapeRe(en.slice(last));
    list.push({ re: new RegExp(`^${src}$`), names, am });
  }
  // Longer (more specific) patterns first.
  return list.sort((a, b) => b.re.source.length - a.re.source.length);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const cache = new Map<string, string>();

/** Translate one message (one sentence or a whole text) from the dictionary or its patterns; null when unknown. */
function matchOne(msg: string): string | null {
  const exact = AM[msg];
  if (exact !== undefined) return exact;
  patterns ??= compile();
  for (const p of patterns) {
    const m = p.re.exec(msg);
    if (!m) continue;
    const vars: Vars = {};
    // {_name}: the value is itself a message (e.g. a reason) and is translated too. Other values (names, columns,
    // numbers) are kept exactly as they are.
    p.names.forEach((n, i) => (vars[n] = n.startsWith("_") ? deep(m[i + 1]) : m[i + 1]));
    return fill(p.am, vars);
  }
  return null;
}

const SENTENCE = /(?<=[.!?])\s+(?=[A-Z“"(])/;

/** Whole message first; otherwise sentence by sentence. */
function deep(msg: string): string {
  const one = matchOne(msg);
  if (one !== null) return one;
  const parts = msg.split(SENTENCE);
  return parts.length > 1 ? parts.map((p) => matchOne(p) ?? p).join(" ") : msg;
}

/**
 * Translate a message that was already filled in, e.g. an error from the server.
 * Unknown messages are split into sentences and translated sentence by sentence; anything still unknown stays English.
 */
export function translateMessage(lang: Lang, msg: string | null | undefined): string {
  if (!msg) return msg ?? "";
  if (lang === "en") return msg;
  const hit = cache.get(msg);
  if (hit !== undefined) return hit;
  const out = deep(msg.trim());
  if (cache.size > 5000) cache.clear();
  cache.set(msg, out);
  return out;
}
