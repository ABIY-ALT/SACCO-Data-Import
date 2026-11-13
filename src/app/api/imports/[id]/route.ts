import { connection } from "next/server";
import { handle, idParam, jsonBody } from "@/lib/server/http";
import * as repo from "@/lib/server/repo";
import { cancelImport, getDetail } from "@/lib/server/service";
import { HttpError } from "@/lib/server/storage";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

export async function GET(_req: Request, ctx: RouteContext<"/api/imports/[id]">) {
  await connection();
  return handle(async () => getDetail(await idParam(ctx)));
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/imports/[id]">) {
  return handle(async () => {
    const id = await idParam(ctx);
    const body = await jsonBody<{ name?: string; action?: "cancel" }>(req);
    if (body.action === "cancel") await cancelImport(id);
    if (body.name !== undefined) {
      const name = body.name.trim().slice(0, 120);
      if (!name) throw new HttpError(400, "Name cannot be empty.");
      await repo.updateImport(id, { name });
    }
    return getDetail(id);
  });
}
