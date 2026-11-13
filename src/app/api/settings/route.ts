import { connection } from "next/server";
import { handle, jsonBody } from "@/lib/server/http";
import { getSettings, saveSettings } from "@/lib/server/repo";
import { HttpError, blobUploadMode } from "@/lib/server/storage";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/types";

export async function GET() {
  await connection();
  // uploadMode tells the browser which secure upload flow the configured storage supports.
  return handle(async () => ({ settings: await getSettings(), uploadMode: blobUploadMode() }));
}

export async function PUT(req: Request) {
  return handle(async () => {
    const b = await jsonBody<Partial<AppSettings>>(req);
    const int = (v: unknown, min: number, max: number, name: string) => {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}.`);
      return n;
    };
    const cc = String(b.countryCode ?? DEFAULT_SETTINGS.countryCode).replace(/\D/g, "");
    if (!/^\d{1,4}$/.test(cc)) throw new HttpError(400, "Country calling code must be 1–4 digits, e.g. 251.");
    const dateFormat = String(b.dateFormat ?? DEFAULT_SETTINGS.dateFormat).toUpperCase().trim();
    if (!/^(DD|D|MM|M|YYYY|YY|MMM)([/\-. ](DD|D|MM|M|YYYY|YY|MMM)){2}$/.test(dateFormat))
      throw new HttpError(400, "Date format must look like DD/MM/YYYY, YYYY-MM-DD or DD-MMM-YYYY.");
    const s: AppSettings = {
      organizationName: String(b.organizationName ?? "").trim().slice(0, 120),
      retentionDays: int(b.retentionDays, 1, 3650, "Retention period"),
      maxUploadMb: int(b.maxUploadMb, 1, 500, "Maximum upload size"),
      countryCode: cc,
      nationalNumberLength: int(b.nationalNumberLength, 6, 12, "Phone number length"),
      phoneFormat: b.phoneFormat === "international" || b.phoneFormat === "international_no_plus" ? b.phoneFormat : "local",
      phoneUnique: Boolean(b.phoneUnique),
      dateOrder: b.dateOrder === "MDY" ? "MDY" : "DMY",
      dateFormat,
      genderStyle: b.genderStyle === "Male/Female" ? "Male/Female" : "M/F",
    };
    await saveSettings(s);
    return { settings: s };
  });
}
