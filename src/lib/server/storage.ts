import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";

// Where uploaded originals, parsed caches and generated files are kept:
// - on your own computer/server: the folder STORAGE_DIR (default ./storage)
// - on Vercel: a Vercel Blob store (when BLOB_READ_WRITE_TOKEN is set). Every file is stored as PRIVATE, so it can only be read
//   through this application, never by its URL.
// Files are addressed by keys like "imports/<id>/uploads/<name>" in both cases.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function assertId(id: string): string {
  if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid import id.");
  return id.toLowerCase();
}

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** True when files are kept in Vercel Blob instead of the local folder. */
export function blobEnabled(): boolean {
  return blobUploadMode() !== "server";
}

export function blobUploadMode(): "server" | "blob" | "blob-presigned" {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID) return "blob-presigned";
  return "server";
}

// ------------------------------------------------------------------ backends

interface Backend {
  /** `once`: the file is written once and never overwritten (uploaded originals). */
  write(key: string, data: Buffer | string, once?: boolean): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  open(key: string): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; size: number } | null>;
  remove(keys: string[]): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export function storageRoot(): string {
  // Runtime data folder: excluded from build tracing so uploads are never bundled into the build output.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR || "./storage");
}

const local: Backend = {
  async write(key, data, once) {
    const p = localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, once ? { flag: "wx" } : undefined); // "wx": never overwrite an original
    if (once) await fs.chmod(p, 0o444).catch(() => {});
  },
  async read(key) {
    return fs.readFile(localPath(key)).catch(() => null);
  },
  async open(key) {
    const data = await local.read(key);
    return data ? { body: new Uint8Array(data), size: data.length } : null;
  },
  async remove(keys) {
    for (const key of keys) {
      const p = localPath(key);
      await fs.chmod(p, 0o644).catch(() => {}); // read-only files must be made writable before removal on Windows
      await fs.rm(p, { force: true });
    }
  },
  async list(prefix) {
    const root = storageRoot();
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else out.push(path.relative(root, p).split(path.sep).join("/"));
      }
    };
    await walk(localPath(prefix.replace(/\/$/, "")));
    return out.filter((k) => k.startsWith(prefix));
  },
};

function localPath(key: string): string {
  const root = storageRoot();
  const p = path.join(root, ...key.split("/"));
  if (p !== root && !p.startsWith(root + path.sep)) throw new HttpError(400, "Invalid file path.");
  return p;
}

const blob: Backend = {
  async write(key, data, once) {
    await put(key, data, { access: "private", addRandomSuffix: false, allowOverwrite: !once });
  },
  async read(key) {
    const r = await blobGet(key);
    return r ? Buffer.from(await new Response(r.stream).arrayBuffer()) : null;
  },
  async open(key) {
    const r = await blobGet(key);
    return r ? { body: r.stream, size: r.blob.size } : null;
  },
  async remove(keys) {
    for (let i = 0; i < keys.length; i += 500) await del(keys.slice(i, i + 500));
  },
  async list(prefix) {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await list({ prefix, cursor, limit: 1000 });
      out.push(...r.blobs.map((b) => b.pathname));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  },
};

/** Read a private blob; null when it does not exist. Always reads the latest version (caches can be overwritten). */
async function blobGet(key: string) {
  try {
    const r = await get(key, { access: "private", useCache: false });
    return r && r.statusCode === 200 ? r : null;
  } catch (e) {
    if ((e as Error)?.name === "BlobNotFoundError") return null;
    throw e;
  }
}

function backend(): Backend {
  if (blobEnabled()) return blob;
  // Vercel has no permanent disk: refuse clearly instead of losing files.
  if (process.env.VERCEL) throw new HttpError(500, "File storage is not set up. Connect a private Vercel Blob store to this project (Storage tab).");
  return local;
}

// ------------------------------------------------------------------ keys

function importKey(id: string): string {
  return `imports/${assertId(id)}/`;
}

function fileKey(id: string, folder: "uploads" | "cache" | "outputs", name: string): string {
  if (!SAFE_NAME_RE.test(name)) throw new HttpError(400, "Invalid file name.");
  return `${importKey(id)}${folder}/${name}`;
}

// ------------------------------------------------------------------ uploaded originals

/** Store an uploaded original. Every upload gets a new unique name and is never overwritten. */
export async function saveUpload(id: string, role: string, ext: string, data: Buffer): Promise<{ storedName: string; sha256: string }> {
  const storedName = `${role}-${randomUUID()}.${ext}`;
  await backend().write(fileKey(id, "uploads", storedName), data, true);
  return { storedName, sha256: sha256(data) };
}

export async function readUpload(id: string, storedName: string): Promise<Buffer> {
  const data = await backend().read(fileKey(id, "uploads", storedName));
  if (!data) throw new HttpError(410, "The uploaded file is no longer available (it may have been removed by the retention policy).");
  return data;
}

export async function removeUpload(id: string, storedName: string) {
  await backend().remove([fileKey(id, "uploads", storedName)]);
}

export async function copyUpload(fromId: string, storedName: string, toId: string, role: string, ext: string) {
  const data = await readUpload(fromId, storedName);
  return { ...(await saveUpload(toId, role, ext, data)), data };
}

// ------------------------------------------------------------------ files uploaded by the browser straight to Vercel Blob

/** Where the browser may upload a file for an import (Vercel Blob only). The store adds a random suffix to the name. */
export const INCOMING_RE = /^incoming\/([0-9a-f-]{36})\/(template|source)\/[A-Za-z0-9._-]+\.(xlsx|xls|csv)$/i;

/** Read (and then delete) a file the browser uploaded straight to Vercel Blob. */
export async function takeIncoming(id: string, role: string, pathname: string): Promise<Buffer> {
  if (!blobEnabled()) throw new HttpError(400, "Direct uploads are only used with Vercel Blob.");
  const prefix = `incoming/${assertId(id)}/${role}/`;
  if (!pathname.startsWith(prefix) || !/^[A-Za-z0-9._/-]+$/.test(pathname)) throw new HttpError(400, "Invalid upload.");
  const data = await blob.read(pathname);
  if (!data) throw new HttpError(400, "The upload was interrupted or is not a valid file upload.");
  await blob.remove([pathname]).catch((e) => console.error("[storage] could not delete incoming upload", e));
  return data;
}

// ------------------------------------------------------------------ parsed caches

export async function writeCache(id: string, name: string, data: unknown) {
  await backend().write(fileKey(id, "cache", name), JSON.stringify(data));
}

export async function readCache<T>(id: string, name: string): Promise<T | null> {
  try {
    const data = await backend().read(fileKey(id, "cache", name));
    return data ? (JSON.parse(data.toString("utf8")) as T) : null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

export async function clearCache(id: string, prefix: string) {
  const folder = `${importKey(id)}cache/`;
  const keys = await backend().list(folder);
  await backend().remove(keys.filter((k) => k.slice(folder.length).startsWith(prefix)));
}

// ------------------------------------------------------------------ generated files

export async function writeOutput(id: string, name: string, data: Buffer | string) {
  await backend().write(fileKey(id, "outputs", name), data);
}

/** A generated file for download (streamed from Vercel Blob, read from disk otherwise); null when it no longer exists. */
export async function openOutput(id: string, name: string) {
  return backend().open(fileKey(id, "outputs", name));
}

/** Delete everything stored for an import (uploads, cache, outputs). */
export async function removeImportFiles(id: string) {
  const b = backend();
  await b.remove(await b.list(importKey(id)));
  if (b === local) await fs.rm(localPath(importKey(id).replace(/\/$/, "")), { recursive: true, force: true });
}

// ------------------------------------------------------------------ checks

/** Check the file's real content matches its extension. */
export function detectFileType(name: string, data: Buffer): "xlsx" | "xls" | "csv" {
  const ext = path.extname(name).toLowerCase().replace(".", "");
  if (!["xlsx", "xls", "csv"].includes(ext))
    throw new HttpError(415, `"${name}" is not supported. Please upload an Excel (.xlsx, .xls) or CSV (.csv) file.`);
  if (data.length === 0) throw new HttpError(400, `"${name}" is empty.`);
  const zip = data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  const ole = data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const head = data.subarray(0, Math.min(4096, data.length));
  const looksText = !head.includes(0);
  if (ext === "xlsx") {
    if (ole) throw new HttpError(400, `"${name}" is password-protected or is an old .xls file renamed to .xlsx. Remove the password (or save as .xlsx) and try again.`);
    if (!zip) throw new HttpError(400, `"${name}" is not a valid .xlsx file.`);
    return "xlsx";
  }
  if (ext === "xls") {
    // Many systems export HTML/XML tables with an .xls extension; SheetJS reads those too.
    if (!ole && !zip && !looksText) throw new HttpError(400, `"${name}" is not a valid .xls file.`);
    return "xls";
  }
  if (!looksText) throw new HttpError(400, `"${name}" does not look like a CSV text file.`);
  return "csv";
}

export function safeDownloadName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").slice(0, 150);
}
