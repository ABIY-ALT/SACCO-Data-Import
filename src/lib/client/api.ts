"use client";

import { useCallback, useEffect, useState } from "react";
import { translate, translateMessage } from "@/lib/i18n";
import { currentLang } from "./lang";

/** Server messages are shown in the chosen language. */
const msg = (m: string) => translateMessage(currentLang(), m);
const tr = (text: string, vars?: Record<string, string | number>) => translate(currentLang(), text, vars);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: { code?: string; [k: string]: unknown },
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; details?: ApiError["details"] };
    throw new ApiError(b.error ? msg(b.error) : tr("Request failed ({status})", { status: res.status }), res.status, b.details);
  }
  return body as T;
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  return parse<T>(await fetch(url, { cache: "no-store", signal }));
}

export async function apiSend<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(tr("Cannot reach the server. Check that the application is running."), 0);
  }
  return parse<T>(res);
}

/** Upload a file with progress reporting; returns a handle that can cancel the upload. */
export function uploadFile<T>(url: string, file: File, onProgress: (fraction: number) => void) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => onProgress(1);
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { error?: string; details?: ApiError["details"] };
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else reject(new ApiError(body.error ? msg(body.error) : tr("Upload failed ({status})", { status: xhr.status }), xhr.status, body.details));
    };
    xhr.onerror = () => reject(new ApiError(tr("The upload failed. Check your connection and try again."), 0));
    xhr.onabort = () => reject(new ApiError(tr("Upload cancelled."), 499));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}

/**
 * Upload a file straight from the browser to the private Vercel Blob store (used on Vercel, where a request to the server may
 * be at most 4.5 MB), then let the server read and check it. Same handle as uploadFile: a promise and a way to cancel.
 */
export function uploadFileViaBlob<T>(url: string, importId: string, role: "template" | "source", file: File, onProgress: (fraction: number) => void) {
  const ctrl = new AbortController();
  const promise = (async () => {
    // Only letters, digits, dots, dashes and underscores in the temporary name; the server adds a random suffix.
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const base = file.name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "file";
    let pathname: string;
    try {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(`incoming/${importId}/${role}/${base}.${ext}`, file, {
        access: "private",
        handleUploadUrl: "/api/uploads",
        multipart: file.size > 8 * 1024 * 1024,
        abortSignal: ctrl.signal,
        onUploadProgress: (e) => onProgress(e.percentage / 100),
      });
      pathname = blob.pathname;
    } catch (e) {
      if (ctrl.signal.aborted) throw new ApiError(tr("Upload cancelled."), 499);
      const m = (e as Error).message ?? "";
      // The server's own refusal (e.g. file too large) comes back inside the Blob error message.
      throw new ApiError(m.includes("token") || !m ? tr("The upload failed. Check your connection and try again.") : msg(m), 0);
    }
    onProgress(1);
    return apiSend<T>("POST", url, { pathname, name: file.name });
  })();
  return { promise, abort: () => ctrl.abort() };
}

/** Load JSON from the API. `reload()` fetches again; `data` stays visible while reloading. */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean; url: string | null }>({ loading: true, url });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    apiGet<T>(url, ctrl.signal)
      .then((data) => setState({ data, loading: false, url }))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setState((s) => ({ ...s, error: (e as Error).message, loading: false }));
      });
    return () => ctrl.abort();
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data })), []);
  return { data: state.data, error: state.error, loading: state.loading && !state.data, reload, setData };
}

// ------------------------------------------------------------------ formatting

export function fmtNumber(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Amharic: numbers only (13/11/2026, 07:49), so no English month names appear.
  const month = currentLang() === "am" ? "2-digit" : "short";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month, year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return tr("just now");
  const m = Math.round(s / 60);
  if (m < 60) return tr("{m} min ago", { m });
  const h = Math.round(m / 60);
  if (h < 24) return tr("{h} h ago", { h });
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? tr("{d} day ago", { d }) : tr("{d} days ago", { d });
  return fmtDateTime(iso);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
