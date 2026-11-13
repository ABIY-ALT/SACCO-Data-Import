import { connection } from "next/server";
import { handle, idParam, jsonBody } from "@/lib/server/http";
import { editRow, getRows, type RowFilter } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

const FILTERS: RowFilter[] = ["all", "ready", "errors", "warnings", "duplicates", "excluded", "changed", "template"];

export async function GET(req: Request, ctx: RouteContext<"/api/imports/[id]/rows">) {
  await connection();
  return handle(async () => {
    const url = new URL(req.url);
    const f = url.searchParams.get("filter") as RowFilter;
    const col = url.searchParams.get("col");
    return getRows(await idParam(ctx), {
      filter: FILTERS.includes(f) ? f : "all",
      page: Number(url.searchParams.get("page") ?? 1) || 1,
      size: Number(url.searchParams.get("size") ?? 50) || 50,
      q: url.searchParams.get("q") ?? undefined,
      code: url.searchParams.get("code") || undefined,
      col: col === null || col === "" ? undefined : Number(col),
    });
  });
}

export async function POST(req: Request, ctx: RouteContext<"/api/imports/[id]/rows">) {
  return handle(async () =>
    editRow(
      await idParam(ctx),
      await jsonBody<{ action: "edit" | "revert" | "exclude" | "include" | "source"; row: number; target?: number; value?: string }>(req),
    ),
  );
}
