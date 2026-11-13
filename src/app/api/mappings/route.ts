import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { listMappings } from "@/lib/server/repo";

export async function GET() {
  await connection();
  return handle(async () => ({ mappings: await listMappings() }));
}
