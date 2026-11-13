import { HttpError, assertId } from "./storage";

const DB_ERRORS = new Set(["ECONNREFUSED", "ENOTFOUND", "28P01", "28000", "3D000", "57P03"]);

/** Run a route handler and convert errors into friendly JSON responses. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    if (out instanceof Response) return out;
    return Response.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) {
      return Response.json({ error: e.message, ...(e.details ? { details: e.details } : {}) }, { status: e.status });
    }
    const code = (e as { code?: string })?.code;
    if (code && DB_ERRORS.has(code)) {
      console.error("[db]", e);
      return Response.json(
        { error: "Cannot connect to the database. Check that PostgreSQL is running and that DATABASE_URL is correct." },
        { status: 503 },
      );
    }
    console.error("[api]", e);
    return Response.json({ error: "Something went wrong on the server. Please try again." }, { status: 500 });
  }
}

export async function jsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

export async function idParam(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  return assertId((await ctx.params).id);
}

export function role(value: string): "template" | "source" {
  if (value !== "template" && value !== "source") throw new HttpError(404, "Unknown file role.");
  return value;
}
