import { Pool, type PoolClient, type QueryResultRow } from "pg";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS imports (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  template JSONB,
  source JSONB,
  analysis JSONB,
  config JSONB,
  stats JSONB,
  summary JSONB,
  outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification JSONB,
  template_signature TEXT,
  source_sha256 TEXT,
  repeat_of UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  files_purged_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS imports_source_sha_idx ON imports (source_sha256);
CREATE INDEX IF NOT EXISTS imports_created_idx ON imports (created_at DESC);

CREATE TABLE IF NOT EXISTS import_events (
  id BIGSERIAL PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_events_import_idx ON import_events (import_id, created_at);

CREATE TABLE IF NOT EXISTS mapping_templates (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  template_signature TEXT NOT NULL,
  template_headers JSONB NOT NULL,
  entries JSONB NOT NULL,
  transforms JSONB NOT NULL,
  times_used INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mapping_templates_sig_idx ON mapping_templates (template_signature);

CREATE TABLE IF NOT EXISTS learned_aliases (
  target_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  target_label TEXT NOT NULL,
  source_label TEXT NOT NULL,
  times_confirmed INT NOT NULL DEFAULT 1,
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_key, source_key)
);

CREATE TABLE IF NOT EXISTS member_aliases (
  name_key TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  times_confirmed INT NOT NULL DEFAULT 1,
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (name_key, member_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

interface DbGlobal {
  pool?: Pool;
  ready?: Promise<void>;
}
const g = globalThis as unknown as { __saccoDb?: DbGlobal };
const state: DbGlobal = (g.__saccoDb ??= {});

function connectionString(): string {
  // POSTGRES_URL: the name some Vercel database integrations use.
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example), or to the project's Environment Variables on Vercel.");
  return url;
}

/** Create the database if it does not exist yet (needs a role allowed to create databases). */
async function ensureDatabase(url: string) {
  const probe = new Pool({ connectionString: url, max: 1 });
  try {
    await probe.query("SELECT 1");
    return;
  } catch (e) {
    if ((e as { code?: string }).code !== "3D000") throw e; // 3D000 = database does not exist
  } finally {
    await probe.end().catch(() => {});
  }
  const u = new URL(url);
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`Refusing to create database with unusual name "${dbName}".`);
  u.pathname = "/postgres";
  const admin = new Pool({ connectionString: u.toString(), max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${dbName}`);
  } catch (e) {
    if ((e as { code?: string }).code !== "42P04") throw e; // already exists (race)
  } finally {
    await admin.end().catch(() => {});
  }
}

export function getPool(): Pool {
  if (!state.pool) {
    // On Vercel many small server instances run at once: each keeps only a few connections, and closes idle ones quickly.
    state.pool = process.env.VERCEL
      ? new Pool({ connectionString: connectionString(), max: 3, idleTimeoutMillis: 10_000 })
      : new Pool({ connectionString: connectionString(), max: 10 });
    state.pool.on("error", (err) => console.error("[db] idle client error", err));
  }
  return state.pool;
}

async function ready(): Promise<void> {
  if (!state.ready) {
    state.ready = (async () => {
      await ensureDatabase(connectionString());
      await getPool().query(SCHEMA);
    })().catch((e) => {
      state.ready = undefined; // retry on next request
      throw e;
    });
  }
  return state.ready;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
