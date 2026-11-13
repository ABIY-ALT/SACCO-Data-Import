import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, authEnabled, checkPassword, createSession, verifySession } from "@/lib/auth";

/** Is a password set, and is this browser logged in? */
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { enabled: authEnabled(), loggedIn: verifySession(request.cookies.get(SESSION_COOKIE)?.value) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Log in with the password. */
export async function POST(request: NextRequest) {
  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    // treated as a wrong password
  }
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 1000)); // slows down guessing
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  if (authEnabled())
    res.cookies.set({
      name: SESSION_COOKIE,
      value: createSession(),
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
  return res;
}

/** Log out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
