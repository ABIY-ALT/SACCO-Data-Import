import { handle, idParam, jsonBody } from "@/lib/server/http";
import { repeatImport } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/imports/[id]/repeat">) {
  return handle(async () => {
    const body = await jsonBody<{ withSource?: boolean }>(req).catch(() => ({}) as { withSource?: boolean });
    return repeatImport(await idParam(ctx), Boolean(body.withSource));
  });
}
