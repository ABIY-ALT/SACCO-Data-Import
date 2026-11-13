import { randomUUID } from "node:crypto";
import type {
  AppSettings,
  ImportConfig,
  ImportRecord,
  ImportStats,
  ImportStatus,
  MappingTemplate,
  OutputFileInfo,
  ProcessSummary,
  SavedMappingEntry,
  TransformOptions,
  UploadedFile,
  VerificationResult,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { query } from "./db";
import { HttpError } from "./storage";

// ------------------------------------------------------------------ imports

interface ImportRow {
  id: string;
  name: string;
  status: ImportStatus;
  template: UploadedFile | null;
  source: UploadedFile | null;
  analysis: StoredAnalysis | null;
  config: ImportConfig | null;
  stats: ImportStats | null;
  summary: ProcessSummary | null;
  outputs: OutputFileInfo[];
  verification: VerificationResult | null;
  template_signature: string | null;
  source_sha256: string | null;
  repeat_of: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  files_purged_at: Date | null;
}

export type { StoredAnalysis } from "../types";
import type { StoredAnalysis } from "../types";

export interface FullImport extends ImportRecord {
  analysis: StoredAnalysis | null;
  summary: ProcessSummary | null;
}

function toRecord(r: ImportRow): FullImport {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    template: r.template,
    source: r.source,
    config: r.config,
    stats: r.stats,
    outputs: r.outputs ?? [],
    verification: r.verification,
    templateSignature: r.template_signature,
    repeatOf: r.repeat_of,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
    filesPurgedAt: r.files_purged_at?.toISOString() ?? null,
    analysis: r.analysis,
    summary: r.summary,
  };
}

export async function createImport(name: string, repeatOf: string | null = null): Promise<FullImport> {
  const id = randomUUID();
  const rows = await query<ImportRow>(
    `INSERT INTO imports (id, name, status, repeat_of) VALUES ($1, $2, 'draft', $3) RETURNING *`,
    [id, name, repeatOf],
  );
  await logEvent(id, "created", repeatOf ? { repeatOf } : null);
  return toRecord(rows[0]);
}

export async function getImport(id: string): Promise<FullImport> {
  const rows = await query<ImportRow>(`SELECT * FROM imports WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Import not found.");
  return toRecord(rows[0]);
}

export async function listImports(opts: { status?: string; q?: string; limit?: number; offset?: number }): Promise<{ items: FullImport[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status && opts.status !== "all") {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q}%`);
    where.push(`(name ILIKE $${params.length} OR template->>'originalName' ILIKE $${params.length} OR source->>'originalName' ILIKE $${params.length})`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await query<{ n: string }>(`SELECT count(*) AS n FROM imports ${w}`, params))[0].n);
  params.push(Math.min(opts.limit ?? 50, 200), opts.offset ?? 0);
  const rows = await query<ImportRow>(
    `SELECT id, name, status, template, source, NULL::jsonb AS analysis, NULL::jsonb AS config, stats, summary, outputs, verification,
            template_signature, source_sha256, repeat_of, created_at, updated_at, completed_at, files_purged_at
       FROM imports ${w} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.map(toRecord), total };
}

type Patch = Partial<{
  name: string;
  status: ImportStatus;
  template: UploadedFile | null;
  source: UploadedFile | null;
  analysis: StoredAnalysis | null;
  config: ImportConfig | null;
  stats: ImportStats | null;
  summary: ProcessSummary | null;
  outputs: OutputFileInfo[];
  verification: VerificationResult | null;
  template_signature: string | null;
  source_sha256: string | null;
  completed_at: Date | null;
  files_purged_at: Date | null;
}>;

const JSON_COLS = new Set(["template", "source", "analysis", "config", "stats", "summary", "outputs", "verification"]);

export async function updateImport(id: string, patch: Patch): Promise<void> {
  const keys = Object.keys(patch) as (keyof Patch)[];
  if (keys.length === 0) return;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of keys) {
    const v = patch[k];
    params.push(JSON_COLS.has(k) && v !== null ? JSON.stringify(v) : v);
    sets.push(`${k} = $${params.length}${JSON_COLS.has(k) ? "::jsonb" : ""}`);
  }
  params.push(id);
  await query(`UPDATE imports SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
}

export async function findCompletedBySourceHash(sha: string, excludeId: string) {
  return query<{ id: string; name: string; completed_at: Date | null; status: ImportStatus }>(
    `SELECT id, name, completed_at, status FROM imports WHERE source_sha256 = $1 AND id <> $2 AND status = 'completed' ORDER BY completed_at DESC LIMIT 5`,
    [sha, excludeId],
  );
}

export async function expiredImports(retentionDays: number): Promise<{ id: string }[]> {
  return query<{ id: string }>(
    `SELECT id FROM imports WHERE files_purged_at IS NULL AND created_at < now() - make_interval(days => $1)`,
    [retentionDays],
  );
}

// ------------------------------------------------------------------ events (audit log)

export async function logEvent(importId: string, action: string, details: unknown = null) {
  await query(`INSERT INTO import_events (import_id, action, details) VALUES ($1, $2, $3::jsonb)`, [
    importId,
    action,
    details === null ? null : JSON.stringify(details),
  ]);
}

export async function listEvents(importId: string) {
  const rows = await query<{ id: string; action: string; details: unknown; created_at: Date }>(
    `SELECT id, action, details, created_at FROM import_events WHERE import_id = $1 ORDER BY created_at, id`,
    [importId],
  );
  return rows.map((r) => ({ id: r.id, action: r.action, details: r.details, createdAt: r.created_at.toISOString() }));
}

export async function recentEvents(limit: number) {
  const rows = await query<{ id: string; import_id: string; name: string; action: string; details: unknown; created_at: Date }>(
    `SELECT e.id, e.import_id, i.name, e.action, e.details, e.created_at
       FROM import_events e JOIN imports i ON i.id = e.import_id
      WHERE e.action IN ('created','generated','cancelled','files_purged','failed')
      ORDER BY e.created_at DESC, e.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, importId: r.import_id, name: r.name, action: r.action, details: r.details, createdAt: r.created_at.toISOString() }));
}

export async function dashboardStats() {
  const rows = await query<{
    total: string;
    completed: string;
    records: string | null;
    ready: string | null;
    failed: string | null;
    in_progress: string;
  }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'completed') AS completed,
            count(*) FILTER (WHERE status IN ('draft','mapping')) AS in_progress,
            sum((stats->>'totalRows')::bigint) FILTER (WHERE status = 'completed') AS records,
            sum((stats->>'ready')::bigint) FILTER (WHERE status = 'completed') AS ready,
            sum((stats->>'withErrors')::bigint + (stats->>'excluded')::bigint) FILTER (WHERE status = 'completed') AS failed
       FROM imports`,
  );
  const r = rows[0];
  return {
    totalImports: Number(r.total),
    successfulImports: Number(r.completed),
    inProgress: Number(r.in_progress),
    recordsProcessed: Number(r.records ?? 0),
    recordsImported: Number(r.ready ?? 0),
    failedRecords: Number(r.failed ?? 0),
  };
}

// ------------------------------------------------------------------ settings

export async function getSettings(): Promise<AppSettings> {
  const rows = await query<{ value: Partial<AppSettings> }>(`SELECT value FROM settings WHERE key = 'app'`);
  return { ...DEFAULT_SETTINGS, ...(rows[0]?.value ?? {}) };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await query(
    `INSERT INTO settings (key, value) VALUES ('app', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(s)],
  );
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const rows = await query<{ value: T }>(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

// ------------------------------------------------------------------ mapping templates

interface MappingRow {
  id: string;
  name: string;
  template_signature: string;
  template_headers: string[];
  entries: SavedMappingEntry[];
  transforms: TransformOptions;
  times_used: number;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
}

function toMapping(r: MappingRow): MappingTemplate {
  return {
    id: r.id,
    name: r.name,
    templateSignature: r.template_signature,
    templateHeaders: r.template_headers,
    entries: r.entries,
    transforms: r.transforms,
    timesUsed: r.times_used,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
  };
}

export async function listMappings(signature?: string): Promise<MappingTemplate[]> {
  const rows = signature
    ? await query<MappingRow>(`SELECT * FROM mapping_templates WHERE template_signature = $1 ORDER BY last_used_at DESC NULLS LAST, updated_at DESC`, [signature])
    : await query<MappingRow>(`SELECT * FROM mapping_templates ORDER BY last_used_at DESC NULLS LAST, updated_at DESC`);
  return rows.map(toMapping);
}

export async function getMapping(id: string): Promise<MappingTemplate | null> {
  const rows = await query<MappingRow>(`SELECT * FROM mapping_templates WHERE id = $1`, [id]);
  return rows[0] ? toMapping(rows[0]) : null;
}

export async function saveMapping(m: {
  id: string | null;
  name: string;
  signature: string;
  headers: string[];
  entries: SavedMappingEntry[];
  transforms: TransformOptions;
}): Promise<MappingTemplate> {
  if (m.id) {
    const rows = await query<MappingRow>(
      `UPDATE mapping_templates SET name = $2, template_headers = $3::jsonb, entries = $4::jsonb, transforms = $5::jsonb,
              times_used = times_used + 1, updated_at = now(), last_used_at = now()
        WHERE id = $1 AND template_signature = $6 RETURNING *`,
      [m.id, m.name, JSON.stringify(m.headers), JSON.stringify(m.entries), JSON.stringify(m.transforms), m.signature],
    );
    if (rows[0]) return toMapping(rows[0]);
  }
  const rows = await query<MappingRow>(
    `INSERT INTO mapping_templates (id, name, template_signature, template_headers, entries, transforms, times_used, last_used_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, 1, now()) RETURNING *`,
    [randomUUID(), m.name, m.signature, JSON.stringify(m.headers), JSON.stringify(m.entries), JSON.stringify(m.transforms)],
  );
  return toMapping(rows[0]);
}

export async function renameMapping(id: string, name: string) {
  await query(`UPDATE mapping_templates SET name = $2, updated_at = now() WHERE id = $1`, [id, name]);
}

export async function deleteMapping(id: string) {
  await query(`DELETE FROM mapping_templates WHERE id = $1`, [id]);
}

// ------------------------------------------------------------------ learned aliases

export async function listAliases() {
  const rows = await query<{ target_key: string; source_key: string; target_label: string; source_label: string; times_confirmed: number; last_confirmed_at: Date }>(
    `SELECT * FROM learned_aliases ORDER BY last_confirmed_at DESC`,
  );
  return rows.map((r) => ({
    targetKey: r.target_key,
    sourceKey: r.source_key,
    targetLabel: r.target_label,
    sourceLabel: r.source_label,
    timesConfirmed: r.times_confirmed,
    lastConfirmedAt: r.last_confirmed_at.toISOString(),
  }));
}

export async function addAliases(list: { targetKey: string; sourceKey: string; targetLabel: string; sourceLabel: string }[]) {
  for (const a of list) {
    await query(
      `INSERT INTO learned_aliases (target_key, source_key, target_label, source_label) VALUES ($1, $2, $3, $4)
       ON CONFLICT (target_key, source_key) DO UPDATE SET times_confirmed = learned_aliases.times_confirmed + 1, last_confirmed_at = now(),
         target_label = EXCLUDED.target_label, source_label = EXCLUDED.source_label`,
      [a.targetKey, a.sourceKey, a.targetLabel, a.sourceLabel],
    );
  }
}

export async function deleteAlias(targetKey: string, sourceKey: string) {
  await query(`DELETE FROM learned_aliases WHERE target_key = $1 AND source_key = $2`, [targetKey, sourceKey]);
}

// ------------------------------------------------------------------ remembered member matches (name in a group's file → member ID)

export async function listLearnedMembers() {
  const rows = await query<{ name_key: string; member_id: string; member_name: string; source_name: string; times_confirmed: number; last_confirmed_at: Date }>(
    `SELECT * FROM member_aliases ORDER BY last_confirmed_at DESC`,
  );
  return rows.map((r) => ({
    nameKey: r.name_key,
    memberId: r.member_id,
    memberName: r.member_name,
    sourceName: r.source_name,
    timesConfirmed: r.times_confirmed,
    lastConfirmedAt: r.last_confirmed_at.toISOString(),
  }));
}

export async function addLearnedMembers(list: { nameKey: string; memberId: string; memberName: string; sourceName: string }[]) {
  for (const a of list) {
    await query(
      `INSERT INTO member_aliases (name_key, member_id, member_name, source_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name_key, member_id) DO UPDATE SET times_confirmed = member_aliases.times_confirmed + 1, last_confirmed_at = now(),
         member_name = EXCLUDED.member_name, source_name = EXCLUDED.source_name`,
      [a.nameKey, a.memberId, a.memberName, a.sourceName],
    );
  }
}

export async function deleteLearnedMember(nameKey: string, memberId: string) {
  await query(`DELETE FROM member_aliases WHERE name_key = $1 AND member_id = $2`, [nameKey, memberId]);
}
