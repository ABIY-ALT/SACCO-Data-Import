import { issueSignedToken } from "@vercel/blob";
import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { handle, jsonBody } from "@/lib/server/http";
import { getImport, getSettings } from "@/lib/server/repo";
import { HttpError, INCOMING_RE, blobUploadMode } from "@/lib/server/storage";

async function getUploadLimit(pathname: string): Promise<number> {
  const m = INCOMING_RE.exec(pathname);
  if (!m) throw new HttpError(400, "Invalid upload.");
  const imp = await getImport(m[1].toLowerCase());
  if (imp.status === "completed") throw new HttpError(409, 'This import is already completed. Use "Repeat import" to make changes.');
  if (imp.status === "cancelled") throw new HttpError(409, "This import was cancelled.");
  const settings = await getSettings();
  return settings.maxUploadMb * 1024 * 1024;
}

function uploadExpiry(): number {
  return Date.now() + 15 * 60 * 1000;
}

/**
 * Vercel Blob client uploads: gives the browser a short-lived permission to upload ONE file for an import straight to the
 * private Blob store. (Requests to a Vercel function may be at most 4.5 MB; member files are often larger.)
 * The file is then read by POST /api/imports/[id]/files/[role], checked like any upload, and deleted from this temporary place.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const mode = blobUploadMode();
    if (mode === "server") throw new HttpError(400, "Direct uploads are only used with Vercel Blob.");

    if (mode === "blob") {
      const body = await jsonBody<HandleUploadBody>(req);
      return handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname) => ({
          maximumSizeInBytes: await getUploadLimit(pathname),
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: uploadExpiry(),
        }),
      });
    }

    if (!process.env.BLOB_WEBHOOK_PUBLIC_KEY)
      throw new HttpError(500, "Vercel Blob OIDC uploads require BLOB_WEBHOOK_PUBLIC_KEY. Reconnect the private Blob store to this project.");

    const body = await jsonBody<HandleUploadPresignedBody>(req);
    return handleUploadPresigned({
      body,
      request: req,
      getSignedToken: async (pathname) => {
        const maximumSizeInBytes = await getUploadLimit(pathname);
        const validUntil = uploadExpiry();
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          maximumSizeInBytes,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            maximumSizeInBytes,
            addRandomSuffix: true,
            allowOverwrite: false,
            validUntil,
          },
        };
      },
    });
  });
}
