import { connection } from "next/server";
import { handle, idParam, jsonBody } from "@/lib/server/http";
import { listMembers, updateMemberMatch, type MemberFilter } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

const FILTERS: MemberFilter[] = ["all", "attention", "matched", "not_found", "skipped"];

export async function GET(req: Request, ctx: RouteContext<"/api/imports/[id]/members">) {
  await connection();
  return handle(async () => {
    const url = new URL(req.url);
    const f = url.searchParams.get("filter") as MemberFilter;
    return listMembers(await idParam(ctx), {
      filter: FILTERS.includes(f) ? f : "all",
      q: url.searchParams.get("q") ?? undefined,
      page: Number(url.searchParams.get("page") ?? 1) || 1,
      size: Number(url.searchParams.get("size") ?? 50) || 50,
    });
  });
}

export async function POST(req: Request, ctx: RouteContext<"/api/imports/[id]/members">) {
  return handle(async () =>
    updateMemberMatch(
      await idParam(ctx),
      await jsonBody<{ action: "set" | "skip" | "reset" | "confirm_suggested"; row?: number; memberId?: string }>(req),
    ),
  );
}
