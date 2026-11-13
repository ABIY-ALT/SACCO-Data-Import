import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { handle, jsonBody } from "@/lib/server/http";
import { getImport, getSettings } from "@/lib/server/repo";
import { HttpError, INCOMING_RE, blobEnabled } from "@/lib/server/storage";

/**
 * Vercel Blob client uploads: gives the browser a short-lived permission to upload ONE file for an import straight to the
 * private Blob store. (Requests to a Vercel function may be at most 4.5 MB; member files are often larger.)
 * The file is then read by POST /api/imports/[id]/files/[role], checked like any upload, and deleted from this temporary place.
 */
export async function POST(req: Request) {
  return handle(async () => {
    if (!blobEnabled()) throw new HttpError(400, "Direct uploads are only used with Vercel Blob.");
    const body = await jsonBody<HandleUploadBody>(req);
    return handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const m = INCOMING_RE.exec(pathname);
        if (!m) throw new HttpError(400, "Invalid upload.");
        const imp = await getImport(m[1].toLowerCase());
        if (imp.status === "completed") throw new HttpError(409, 'This import is already completed. Use "Repeat import" to make changes.');
        if (imp.status === "cancelled") throw new HttpError(409, "This import was cancelled.");
        const settings = await getSettings();
        return {
          maximumSizeInBytes: settings.maxUploadMb * 1024 * 1024,
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: Date.now() + 15 * 60 * 1000,
        };
      },
    });
  });
}
