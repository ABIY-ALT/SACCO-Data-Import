import { handle, idParam, jsonBody } from "@/lib/server/http";
import { processConfig } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/imports/[id]/process">) {
  return handle(async () => {
    const body = await jsonBody<{ config: unknown }>(req);
    return processConfig(await idParam(ctx), body.config);
  });
}
