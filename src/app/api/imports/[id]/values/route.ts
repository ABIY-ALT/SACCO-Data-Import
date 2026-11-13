import { connection } from "next/server";
import { handle, idParam } from "@/lib/server/http";
import { distinctValues } from "@/lib/server/service";
import { HttpError } from "@/lib/server/storage";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

export async function GET(req: Request, ctx: RouteContext<"/api/imports/[id]/values">) {
  await connection();
  return handle(async () => {
    const source = Number(new URL(req.url).searchParams.get("source"));
    if (!Number.isInteger(source) || source < 0) throw new HttpError(400, "Invalid column.");
    return { values: await distinctValues(await idParam(ctx), source) };
  });
}
