import { handle } from "@/lib/server/http";
import { runRetention } from "@/lib/server/service";

export async function POST() {
  return handle(async () => runRetention(true));
}
