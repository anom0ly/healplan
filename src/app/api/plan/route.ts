import { loadKills } from "@/lib/db";
import { buildPlan } from "@/lib/engine/plan";
import { parsePlanRequest } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const r = parsePlanRequest(params);
  if (!r) return Response.json({ error: "encounter and at least one healer spec are required" }, { status: 400 });
  const kills = await loadKills(r.encounterId, r.difficulty);
  const plan = buildPlan(kills, r.comp, { weight: { now: Date.now(), firstKillsOnly: r.firstKillsOnly } });
  return Response.json({
    ...plan,
    killsUsed: plan.killsUsed.map((k) => ({
      guild: k.kill.guildName,
      report: `https://www.warcraftlogs.com/reports/${k.kill.reportCode}#fight=${k.kill.fightId}`,
      killIndex: k.kill.killIndex,
      weight: k.weight,
    })),
  });
}
