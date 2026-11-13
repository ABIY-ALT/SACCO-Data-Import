import { connection } from "next/server";
import { handle, idParam, jsonBody, role } from "@/lib/server/http";
import { filePreview, selectSheet, uploadFile } from "@/lib/server/service";
import { HttpError, takeIncoming } from "@/lib/server/storage";

type Ctx = RouteContext<"/api/imports/[id]/files/[role]">;

// Reading a large workbook can take a while.
export const maxDuration = 300;

export async function GET(_req: Request, ctx: Ctx) {
  await connection();
  return handle(async () => filePreview(await idParam(ctx), role((await ctx.params).role)));
}

/**
 * Upload a file. Two ways:
 * - JSON { pathname, name }: the browser already uploaded the file straight to Vercel Blob (used on Vercel, where a request
 *   to this server may be at most 4.5 MB);
 * - multipart form with "file": the file is sent to this server (own computer / server).
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const id = await idParam(ctx);
    const r = role((await ctx.params).role);
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await jsonBody<{ pathname?: string; name?: string }>(req);
      if (!body.pathname || !body.name) throw new HttpError(400, "No file was uploaded.");
      return uploadFile(id, r, { name: String(body.name).slice(0, 255), data: await takeIncoming(id, r, body.pathname) });
    }
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 512 * 1024 * 1024) throw new HttpError(413, "The file is too large.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "The upload was interrupted or is not a valid file upload.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No file was uploaded.");
    return uploadFile(id, r, { name: file.name, data: Buffer.from(await file.arrayBuffer()) });
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const id = await idParam(ctx);
    const r = role((await ctx.params).role);
    return selectSheet(id, r, await jsonBody<{ sheet?: string; headerRow?: number }>(req));
  });
}
