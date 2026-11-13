import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import * as repo from "@/lib/server/repo";
import { runRetention } from "@/lib/server/service";

export async function GET() {
  await connection();
  return handle(async () => {
    await runRetention().catch((e) => console.error("[retention]", e));
    const [stats, recent, latest, mappings, settings] = await Promise.all([
      repo.dashboardStats(),
      repo.recentEvents(12),
      repo.listImports({ limit: 6 }),
      repo.listMappings(),
      repo.getSettings(),
    ]);
    return {
      stats,
      recent,
      latest: latest.items,
      savedMappings: mappings.length,
      retentionDays: settings.retentionDays,
      organizationName: settings.organizationName,
    };
  });
}
