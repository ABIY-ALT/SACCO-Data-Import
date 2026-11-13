import { connection } from "next/server";
import { handle, jsonBody } from "@/lib/server/http";
import * as repo from "@/lib/server/repo";
import { runRetention } from "@/lib/server/service";

export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    await runRetention().catch((e) => console.error("[retention]", e));
    const url = new URL(req.url);
    return repo.listImports({
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await jsonBody<{ name?: string }>(req).catch(() => ({}) as { name?: string });
    const name = (body.name ?? "").trim().slice(0, 120) || `Import ${new Date().toLocaleString("en-GB")}`;
    const imp = await repo.createImport(name);
    return { id: imp.id };
  });
}
