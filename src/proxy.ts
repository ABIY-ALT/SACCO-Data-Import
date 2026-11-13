import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifySession } from "@/lib/auth";

/**
 * Password protection (only when APP_PASSWORD is set): every page and API needs a valid login cookie.
 * Pages without one go to /login; API calls get 401 so the browser can send the user to the login page.
 */
export function proxy(request: NextRequest) {
  if (!authEnabled() || verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please log in first.", details: { code: "login" } }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, the login API and static files.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
