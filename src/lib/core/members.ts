// Matching rows of an original file to the members already listed in a template (fill mode),
// plus detection of total / repeated-header rows.
import type { MemberCandidate, MemberMatchInfo, RawCell } from "../types";
import type { SheetData } from "./analyze";
import { foldEthiopic, personNameKey } from "./ethiopic";
import { isBlank, rawToText } from "./text";
import { identifierText } from "./values";

export interface MemberRecord {
  row: number; // template data-row index (0 = first row under the header)
  id: string;
  idKey: string;
  name: string;
  key: string;
  tokens: string[];
  expanded: string[]; // tokens with Ethiopic syllables split into consonant + vowel
  prefix: string; // letters at the start of the ID, e.g. "BT"
}

export interface MemberIndex {
  members: MemberRecord[];
  byId: Map<string, MemberRecord[]>;
  byKey: Map<string, MemberRecord[]>;
  byInitial: Map<string, MemberRecord[]>;
  duplicateIds: number;
}

export function idKey(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

export function idPrefix(id: string): string {
  return (id.trim().toUpperCase().match(/^[A-Z]+/) ?? [""])[0];
}

/** "ጅሮኛ" → "ጀ6ረ6ኘ3": each Ethiopic syllable becomes its consonant plus a vowel digit, so one vowel change is one edit. */
function expand(token: string): string {
  let out = "";
  for (const ch of token) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x1200 && c <= 0x137f) out += String.fromCodePoint(c & ~7) + String(c & 7);
    else out += ch;
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function tokenSim(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

function initialOf(expandedToken: string | undefined): string {
  return expandedToken ? [...expandedToken][0] ?? "" : "";
}

export function buildMemberIndex(sheet: SheetData, headerRow: number, keyCol: number, nameCol: number | null): MemberIndex {
  const members: MemberRecord[] = [];
  const byId = new Map<string, MemberRecord[]>();
  const byKey = new Map<string, MemberRecord[]>();
  const byInitial = new Map<string, MemberRecord[]>();
  let duplicateIds = 0;
  for (let r = headerRow; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const idCell = row?.[keyCol] ?? null;
    if (isBlank(idCell)) continue;
    const id = identifierText(idCell).trim();
    const name = nameCol === null ? "" : rawToText(row?.[nameCol] ?? null).trim();
    const key = personNameKey(name);
    const tokens = key ? key.split(" ") : [];
    const rec: MemberRecord = { row: r - headerRow, id, idKey: idKey(id), name, key, tokens, expanded: tokens.map(expand), prefix: idPrefix(id) };
    members.push(rec);
    const ids = byId.get(rec.idKey);
    if (ids) {
      ids.push(rec);
      duplicateIds++;
    } else byId.set(rec.idKey, [rec]);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), rec]);
    for (const t of rec.expanded.slice(0, 2)) {
      const ini = initialOf(t);
      if (ini) byInitial.set(ini, [...(byInitial.get(ini) ?? []), rec]);
    }
  }
  return { members, byId, byKey, byInitial, duplicateIds };
}

const cand = (m: MemberRecord, score: number): MemberCandidate => ({ row: m.row, id: m.id, name: m.name, score: Math.round(score * 1000) / 1000 });

/** Score how well an original name fits a member's name (0..1). Original names often have fewer parts (name + father). */
function nameScore(srcExpanded: string[], m: MemberRecord): number {
  if (srcExpanded.length === 0 || m.expanded.length === 0) return 0;
  const n = Math.min(srcExpanded.length, m.expanded.length);
  const weights = [0.5, 0.35, 0.15];
  let total = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 0.1;
    total += w * tokenSim(srcExpanded[i], m.expanded[i]);
    wsum += w;
  }
  let score = total / wsum;
  if (srcExpanded.length > m.expanded.length) score -= 0.1 * (srcExpanded.length - m.expanded.length);
  if (srcExpanded.length === 1) score -= 0.2; // a single name is never enough
  return score;
}

export interface SourceMemberRow {
  i: number;
  name: string;
  key: string; // member ID written in the original file, if any
}

export interface LearnedMember {
  nameKey: string;
  memberId: string;
}

/**
 * Match original rows to template members. Order of trust: member ID → name you confirmed before →
 * identical name (one member) → suggestions that you must confirm. Several members with the same name are never
 * picked automatically; the members' ID prefix (their group, e.g. "BT") is only used to rank suggestions.
 */
export function matchMembers(
  index: MemberIndex,
  rows: SourceMemberRow[],
  learned: LearnedMember[],
  overrides: Record<string, string | null>,
): Map<number, MemberMatchInfo> {
  const learnedByName = new Map<string, string[]>();
  for (const l of learned) learnedByName.set(l.nameKey, [...(learnedByName.get(l.nameKey) ?? []), idKey(l.memberId)]);

  // Pass 1: which ID prefix (group) do confidently matched members share?
  const prefixCount = new Map<string, number>();
  let confident = 0;
  for (const r of rows) {
    const byId = r.key ? index.byId.get(idKey(r.key)) : undefined;
    const exact = index.byKey.get(personNameKey(r.name));
    const m = byId?.length === 1 ? byId[0] : exact?.length === 1 ? exact[0] : null;
    if (m) {
      confident++;
      prefixCount.set(m.prefix, (prefixCount.get(m.prefix) ?? 0) + 1);
    }
  }
  let dominant: string | null = null;
  for (const [p, c] of prefixCount) if (p && confident >= 3 && c / confident >= 0.6) dominant = p;
  const groupNote = (m: MemberRecord) => (dominant && m.prefix !== dominant ? ` Note: this member's ID starts with ${m.prefix}, most members in this file start with ${dominant}.` : "");

  const out = new Map<number, MemberMatchInfo>();
  for (const r of rows) {
    const auto = autoMatch(r);
    const ov = overrides[String(r.i)];
    if (ov === undefined) {
      out.set(r.i, auto);
      continue;
    }
    if (ov === null) {
      out.set(r.i, { ...auto, status: "skipped", member: null, reason: "You marked this row as not a member — it is not imported." });
      continue;
    }
    const chosen = index.byId.get(idKey(ov))?.[0];
    if (!chosen) {
      out.set(r.i, { ...auto, status: "not_found", member: null, reason: `The member ID ${ov} you chose is no longer in the template's member list.` });
      continue;
    }
    const same = auto.member?.id === chosen.id;
    out.set(r.i, {
      ...auto,
      status: same ? "confirmed" : "manual",
      member: cand(chosen, same ? (auto.member?.score ?? 1) : 1),
      reason: same ? "Suggestion confirmed by you." : "Member chosen by you.",
    });
  }
  return out;

  function autoMatch(r: SourceMemberRow): MemberMatchInfo {
    const base = { sourceName: r.name, sourceKey: r.key, candidates: [] as MemberCandidate[] };
    let idNote = "";
    if (r.key) {
      const hits = index.byId.get(idKey(r.key));
      if (hits?.length === 1) return { ...base, status: "id", member: cand(hits[0], 1), reason: "Same member ID." };
      idNote = hits && hits.length > 1 ? `Member ID ${r.key} appears ${hits.length} times in the member list. ` : `Member ID ${r.key} is not in the member list. `;
    }
    const key = personNameKey(r.name);
    if (!key) return { ...base, status: "not_found", member: null, reason: idNote + "The row has no name." };

    const remembered = (learnedByName.get(key) ?? []).map((id) => index.byId.get(id)?.[0]).filter(Boolean) as MemberRecord[];
    if (remembered.length === 1)
      return { ...base, status: "remembered", member: cand(remembered[0], 1), reason: idNote + "You matched this name to this member before." };

    const srcTokens = key.split(" ");
    const srcExpanded = srcTokens.map(expand);
    const exact = index.byKey.get(key) ?? [];
    if (exact.length === 1) {
      const m = exact[0];
      if (dominant && m.prefix !== dominant)
        return { ...base, status: "suggested", member: cand(m, 0.97), candidates: [cand(m, 0.97)], reason: idNote + "Same name, but the member belongs to another group." + groupNote(m) };
      return { ...base, status: "exact", member: cand(m, 1), reason: idNote + "Same name — no other member has it." };
    }
    if (exact.length > 1) {
      const candidates = exact.map((m) => cand(m, 1));
      const inGroup = dominant ? exact.filter((m) => m.prefix === dominant) : [];
      if (inGroup.length === 1)
        return {
          ...base,
          status: "suggested",
          member: cand(inGroup[0], 0.98),
          candidates,
          reason: idNote + `${exact.length} members have this name; suggested the one in the same group (${dominant}).`,
        };
      return { ...base, status: "ambiguous", member: null, candidates, reason: idNote + `${exact.length} members have exactly this name. Choose the right one.` };
    }

    // Original name is the first part of a longer member name (e.g. name + father vs name + father + grandfather).
    if (srcTokens.length >= 2) {
      const prefixHits = (index.byInitial.get(initialOf(srcExpanded[0])) ?? []).filter(
        (m) => m.tokens.length > srcTokens.length && srcTokens.every((t, k) => m.tokens[k] === t),
      );
      if (prefixHits.length >= 1) {
        const inGroup = dominant ? prefixHits.filter((m) => m.prefix === dominant) : [];
        const pick = prefixHits.length === 1 ? prefixHits[0] : inGroup.length === 1 ? inGroup[0] : null;
        const candidates = prefixHits.slice(0, 8).map((m) => cand(m, 0.95));
        if (pick) return { ...base, status: "suggested", member: cand(pick, 0.95), candidates, reason: idNote + "The name matches the first names of this member." + groupNote(pick) };
        return { ...base, status: "ambiguous", member: null, candidates, reason: idNote + "Several members' names start with this name. Choose the right one." };
      }
    }

    // Similar spelling (one or two letters different).
    const pool = new Set<MemberRecord>();
    for (const t of srcExpanded.slice(0, 2)) for (const m of index.byInitial.get(initialOf(t)) ?? []) pool.add(m);
    const scored = [...pool]
      .map((m) => ({ m, s: nameScore(srcExpanded, m) + (dominant && m.prefix === dominant ? 0.03 : 0) }))
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
    const candidates = scored.map((x) => cand(x.m, Math.min(1, x.s)));
    const best = scored[0];
    if (best && best.s >= 0.82 && tokenSim(srcExpanded[0], best.m.expanded[0]) >= 0.75) {
      const second = scored[1];
      if (!second || best.s - second.s >= 0.04)
        return {
          ...base,
          status: "suggested",
          member: cand(best.m, Math.min(1, best.s)),
          candidates,
          reason: idNote + `Similar spelling: “${best.m.name}”. Please check it is the same person.` + groupNote(best.m),
        };
      return { ...base, status: "ambiguous", member: null, candidates, reason: idNote + "Several members have a similar name. Choose the right one." };
    }
    return {
      ...base,
      status: "not_found",
      member: null,
      candidates,
      reason: idNote + (candidates.length ? "No member with this name. Similar names are listed — choose one if it is the same person." : "No member with this name in the template's member list."),
    };
  }
}

// ------------------------------------------------------------------ row kinds

const TOTAL_WORDS = ["ድምር", "ጠቅላላ", "ጠቅላላ ድምር", "ንዑስ ድምር", "ጠቅላላ ገቢ", "ጠቅላላ ብር", "total", "totals", "grand total", "sub total", "subtotal", "sum"].map((w) =>
  foldEthiopic(w).toLowerCase(),
);

export function isTotalText(text: string): boolean {
  const t = foldEthiopic(text).toLowerCase().replace(/[:：.\s]+$/g, "").replace(/\s+/g, " ").trim();
  return TOTAL_WORDS.includes(t);
}

export function isGrandTotalText(text: string): boolean {
  const t = foldEthiopic(text).toLowerCase();
  return t.includes(foldEthiopic("ጠቅላላ")) || t.includes("grand");
}

const norm = (c: RawCell | undefined) => foldEthiopic(rawToText(c ?? null)).replace(/\s+/g, " ").trim();

/**
 * Classify a data row: a repeated header or repeated title rows (a new page), a total row (ድምር / Total) or real data.
 * `titleRows` are the rows above the header (sheet title, month…).
 */
export function classifyRow(
  row: RawCell[] | undefined,
  headerCells: RawCell[],
  titleRows: RawCell[][] = [],
): { kind: "data" | "total" | "header"; text: string } {
  if (!row) return { kind: "data", text: "" };
  for (const c of row) {
    if (typeof c === "string" && c.trim() && isTotalText(c)) return { kind: "total", text: c.trim() };
  }
  const filled = row.map((c, k) => [k, norm(c)] as const).filter(([, t]) => t !== "");
  if (filled.length > 0 && filled.length <= 3 && filled.every(([, t]) => !/^-?[\d,.\s]+$/.test(t))) {
    for (const tr of titleRows)
      if (filled.every(([k, t]) => norm(tr[k]) === t))
        return { kind: "header", text: `Repeated title row “${filled.map(([k]) => rawToText(row[k] ?? null).replace(/\s+/g, " ").trim()).join(" ")}”` };
  }
  let named = 0;
  let same = 0;
  headerCells.forEach((h, k) => {
    const ht = foldEthiopic(rawToText(h)).replace(/\s+/g, " ").trim();
    if (!ht) return;
    named++;
    if (foldEthiopic(rawToText(row[k] ?? null)).replace(/\s+/g, " ").trim() === ht) same++;
  });
  if (named >= 2 && same >= Math.max(2, Math.ceil(named * 0.6))) return { kind: "header", text: "Repeated header row" };
  return { kind: "data", text: "" };
}
