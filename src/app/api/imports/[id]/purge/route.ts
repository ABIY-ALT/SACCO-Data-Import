import { handle, idParam } from "@/lib/server/http";
import { getDetail, purgeImportFiles } from "@/lib/server/service";

export async function POST(_req: Request, ctx: RouteContext<"/api/imports/[id]/purge">) {
  return handle(async () => {
    const id = await idParam(ctx);
    await purgeImportFiles(id, "user");
    return getDetail(id);
  });
}
