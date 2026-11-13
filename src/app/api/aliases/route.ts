import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { deleteAlias, listAliases } from "@/lib/server/repo";

export async function GET() {
  await connection();
  return handle(async () => ({ aliases: await listAliases() }));
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    await deleteAlias(url.searchParams.get("target") ?? "", url.searchParams.get("source") ?? "");
  });
}
