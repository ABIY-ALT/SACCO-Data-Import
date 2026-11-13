import { connection } from "next/server";
import { handle, idParam } from "@/lib/server/http";
import { downloadOutput } from "@/lib/server/service";
import { HttpError } from "@/lib/server/storage";
import type { OutputKind } from "@/lib/types";

const KINDS: OutputKind[] = ["final", "final_csv", "invalid", "report", "mapping"];

export const maxDuration = 120;

export async function GET(_req: Request, ctx: RouteContext<"/api/imports/[id]/download/[kind]">) {
  await connection();
  return handle(async () => {
    const id = await idParam(ctx);
    const kind = (await ctx.params).kind as OutputKind;
    if (!KINDS.includes(kind)) throw new HttpError(404, "Unknown file.");
    const { body, size, fileName, contentType } = await downloadOutput(id, kind);
    const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    // Streamed straight from storage (private Vercel Blob files are never exposed by URL).
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
