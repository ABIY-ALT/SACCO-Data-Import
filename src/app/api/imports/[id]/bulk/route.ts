import { handle, idParam, jsonBody } from "@/lib/server/http";
import { bulkFix } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

/** Fix many rows at once: exclude them, give them one value, take the template's value, or find & replace. */
export async function POST(req: Request, ctx: RouteContext<"/api/imports/[id]/bulk">) {
  return handle(async () =>
    bulkFix(await idParam(ctx), await jsonBody<{ op?: string; code?: string; col?: number; value?: string; find?: string }>(req)),
  );
}
