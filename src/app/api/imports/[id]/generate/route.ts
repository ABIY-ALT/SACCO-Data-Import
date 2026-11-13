import { handle, idParam, jsonBody } from "@/lib/server/http";
import { generate } from "@/lib/server/service";

// Large workbooks can take a while (Vercel stops functions after their maximum duration).
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/imports/[id]/generate">) {
  return handle(async () =>
    generate(
      await idParam(ctx),
      await jsonBody<{
        confirmDuplicate?: boolean;
        approveDefaults?: boolean;
        saveMapping?: { save: boolean; name: string; updateExisting?: boolean };
        lang?: string; // language of the reports ("am" or "en"); the final data file is never translated
      }>(req),
    ),
  );
}
