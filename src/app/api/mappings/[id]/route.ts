import { handle, idParam, jsonBody } from "@/lib/server/http";
import { deleteMapping, renameMapping } from "@/lib/server/repo";
import { HttpError } from "@/lib/server/storage";

export async function PATCH(req: Request, ctx: RouteContext<"/api/mappings/[id]">) {
  return handle(async () => {
    const id = await idParam(ctx);
    const { name } = await jsonBody<{ name: string }>(req);
    if (!name?.trim()) throw new HttpError(400, "Name cannot be empty.");
    await renameMapping(id, name.trim().slice(0, 120));
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/mappings/[id]">) {
  return handle(async () => {
    await deleteMapping(await idParam(ctx));
  });
}
