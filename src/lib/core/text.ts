import type { RawCell } from "../types";
import { foldEthiopic } from "./ethiopic";

/** 0 -> A, 25 -> Z, 26 -> AA */
export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Text of a raw cell as the user would see it in Excel. */
export function rawToText(cell: RawCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  return cell.w;
}

export function isBlank(cell: RawCell | undefined): boolean {
  if (cell === null || cell === undefined) return true;
  if (typeof cell === "string") return cell.trim() === "";
  return false;
}

const ABBREVIATIONS: Record<string, string[]> = {
  no: ["number"],
  num: ["number"],
  nbr: ["number"],
  nr: ["number"],
  dob: ["date", "of", "birth"],
  acc: ["account"],
  acct: ["account"],
  ac: ["account"],
  amt: ["amount"],
  bal: ["balance"],
  dt: ["date"],
  mem: ["member"],
  mbr: ["member"],
  addr: ["address"],
  tel: ["telephone"],
  fname: ["first", "name"],
  lname: ["last", "name"],
  mname: ["middle", "name"],
  txn: ["transaction"],
  trx: ["transaction"],
  trans: ["transaction"],
  ref: ["reference"],
  qty: ["quantity"],
  int: ["interest"],
  dep: ["deposit"],
  reg: ["registration"],
  nok: ["next", "of", "kin"],
  mob: ["mobile"],
  email: ["email"],
  e: ["e"],
};

const STOP_WORDS = new Set(["the", "of", "s"]);

/** Strip hints like "(DD/MM/YYYY)", "*" and "(required)" from a header, returning the cleaned label. */
export function cleanHeader(header: string): string {
  return header
    .replace(/\s+/g, " ")
    .replace(/\*/g, "")
    .replace(/\((required|mandatory|optional)\)/gi, "")
    .trim();
}

/** Tokens of a header after lower-casing, removing punctuation and expanding common abbreviations. */
export function headerTokens(header: string): string[] {
  const base = foldEthiopic(header)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ") // drop bracketed hints
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/&/g, " and ")
    .replace(/#/g, " number ")
    .replace(/%/g, " percent ")
    .replace(/a\/c/gi, " account ")
    .replace(/e-mail/gi, "email")
    // split camelCase: MemberID -> Member ID
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9ሀ-፿]+/g, " ")
    .trim();
  if (!base) return [];
  const out: string[] = [];
  for (const t of base.split(" ")) {
    const exp = ABBREVIATIONS[t];
    if (exp) out.push(...exp);
    else out.push(t);
  }
  return out;
}

/** Compact comparable key: "Member No." and "member_number" both become "membernumber". */
export function headerKey(header: string): string {
  return headerTokens(header)
    .filter((t) => !STOP_WORDS.has(t))
    .join("");
}

/**
 * All comparable keys of a header: the main key plus the text in brackets, e.g.
 * "Regular saving (ቁጠባ)" → ["regularsaving", "ቁጠባ"]. Format hints like (DD/MM/YYYY) or (M/F) are ignored.
 */
export function headerKeys(header: string): string[] {
  const keys = [headerKey(header)];
  // Only a bracket at the END names the whole column: "AIB share (እጣ)" yes, "Regular saving (ቁጠባ) Interest" no.
  const m = header.replace(/\*+\s*$/, "").match(/[([]([^)\]]*)[)\]]\s*$/);
  const inner = m?.[1]?.trim() ?? "";
  if (inner && !/\/|^(required|mandatory|optional|months?|etb|birr|%)$/i.test(inner)) {
    const k = headerKey(inner);
    if (k && k.length >= 2 && !keys.includes(k)) keys.push(k);
  }
  return keys.filter(Boolean);
}

/** Similarity between two headers (0..1) using token overlap and character bigrams. */
export function headerSimilarity(a: string, b: string): number {
  const ta = new Set(headerTokens(a).filter((t) => !STOP_WORDS.has(t)));
  const tb = new Set(headerTokens(b).filter((t) => !STOP_WORDS.has(t)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const dice = bigramDice(headerKey(a), headerKey(b));
  return Math.max(jaccard, dice * 0.95);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const [g, c] of ga) inter += Math.min(c, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** Header hints: "*" or "(required)" → required; "(DD/MM/YYYY)" → date format; "(M/F)" → allowed values. */
export function parseHeaderHints(header: string): {
  required: boolean;
  dateFormat?: string;
  allowedValues?: string[];
} {
  const required = /\*/.test(header) || /\((required|mandatory)\)/i.test(header);
  let dateFormat: string | undefined;
  let allowedValues: string[] | undefined;
  const brackets = [...header.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => (m[1] ?? m[2] ?? "").trim());
  for (const b of brackets) {
    const upper = b.toUpperCase().replace(/\s+/g, "");
    if (/^(DD|D|MM|M|YYYY|YY|MMM)([/\-. ](DD|D|MM|M|YYYY|YY|MMM)){2}$/.test(upper)) {
      dateFormat = upper;
      continue;
    }
    // e.g. (M/F), (Male/Female), (Yes/No), (Single, Married)
    const parts = b.split(/\s*[/,|]\s*|\s+or\s+/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 12 && parts.every((p) => p.length <= 30) && !/required|mandatory|optional/i.test(b)) {
      allowedValues = parts;
    }
  }
  return { required, dateFormat, allowedValues };
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'’.])([a-zà-ÿ])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
