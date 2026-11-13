// Simple password protection for the whole app.
//
// Off unless the APP_PASSWORD setting is set (e.g. in .env.local, or in the Vercel project's Environment Variables).
// After a correct password the browser gets a signed cookie that is valid for SESSION_DAYS. Changing APP_PASSWORD (or
// AUTH_SECRET) signs everyone out.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sacco_session";
export const SESSION_DAYS = 7;

function password(): string {
  return process.env.APP_PASSWORD ?? "";
}

/** True when a password protects the app. */
export function authEnabled(): boolean {
  return password() !== "";
}

function sign(value: string): string {
  const key = createHmac("sha256", "sacco-import-session").update(`${password()}|${process.env.AUTH_SECRET ?? ""}`).digest();
  return createHmac("sha256", key).update(value).digest("hex");
}

/** A new session token: "<expiry ms>.<signature>". */
export function createSession(now = Date.now()): string {
  const expires = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${expires}.${sign(expires)}`;
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  if (!authEnabled()) return true;
  if (!token) return false;
  const [expires, mac] = token.split(".");
  if (!expires || !mac || !/^\d+$/.test(expires) || Number(expires) < now) return false;
  const expected = sign(expires);
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

/** Compare a typed password with APP_PASSWORD in constant time. */
export function checkPassword(input: string): boolean {
  if (!authEnabled()) return true;
  const digest = (s: string) => createHmac("sha256", "sacco-import-password").update(s).digest();
  return timingSafeEqual(digest(input), digest(password()));
}
