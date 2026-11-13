import { connection } from "next/server";
import { handle, idParam } from "@/lib/server/http";
import { searchMembers } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

export async function GET(req: Request, ctx: RouteContext<"/api/imports/[id]/members/search">) {
  await connection();
  return handle(async () => searchMembers(await idParam(ctx), new URL(req.url).searchParams.get("q") ?? ""));
}
