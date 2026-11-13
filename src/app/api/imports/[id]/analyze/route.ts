import { handle, idParam, jsonBody } from "@/lib/server/http";
import { analyze } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/imports/[id]/analyze">) {
  return handle(async () => {
    const body = await jsonBody<{ mappingTemplateId?: string }>(req).catch(() => ({}) as { mappingTemplateId?: string });
    // "none" = automatic suggestions only; absent = pick the best saved mapping automatically
    const choice = body.mappingTemplateId === "none" ? null : body.mappingTemplateId || undefined;
    return analyze(await idParam(ctx), { mappingTemplateId: choice });
  });
}
