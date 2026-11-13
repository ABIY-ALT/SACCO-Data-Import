import { connection } from "next/server";
import { handle, idParam } from "@/lib/server/http";
import { listEvents } from "@/lib/server/repo";

export async function GET(_req: Request, ctx: RouteContext<"/api/imports/[id]/events">) {
  await connection();
  return handle(async () => ({ events: await listEvents(await idParam(ctx)) }));
}
