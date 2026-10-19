import { listBosses, loadKills, type BossOption } from "@/lib/db";
import { buildPlan, type Plan } from "@/lib/engine/plan";
import { toNote } from "@/lib/engine/note";
import { buildTimeline } from "@/lib/engine/timeline";
import { parseComp, parsePlanRequest } from "@/lib/request";
import { Heatmap } from "./heatmap";
import { Picker } from "./picker";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const req = parsePlanRequest(params);
  let plan: Plan | null = null;
  let error: string | null = null;
  if (req) {
    try {
      plan = buildPlan(await loadKills(req.encounterId, req.difficulty), req.comp, {
        weight: { now: Date.now(), firstKillsOnly: req.firstKillsOnly },
      });
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const val = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  // Falls back to typing an encounter id when the boss list can't be read or the crawler hasn't saved it yet.
  const bosses: BossOption[] = await listBosses().catch(() => []);

  return (
    <main>
      <h1>Healplan</h1>
      <p className="muted">
        When guilds with your healing comp used their cooldowns, weighted toward first kills and recent kills.
      </p>

      <Picker
        bosses={bosses}
        initial={{
          encounter: val("encounter"),
          difficulty: val("difficulty") === "heroic" ? "heroic" : "mythic",
          comp: parseComp(params),
          firstKillsOnly: val("firstKillsOnly") === "1",
        }}
      />

      {error && <p>Couldn&apos;t load kills: {error}</p>}
      {plan && <PlanView plan={plan} logsHref={`/logs?${queryString(params)}`} />}
    </main>
  );
}

/** The page's own query, for links to pages about the same boss and comp. */
function queryString(params: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string") q.set(k, v);
  return q.toString();
}

function PlanView({ plan, logsHref }: { plan: Plan; logsHref: string }) {
  if (plan.killsUsed.length === 0) return <p>No matching kills yet. Try a looser comp or turn off first kills only.</p>;
  return (
    <section>
      <p className="muted">
        Based on {plan.killsUsed.length} kills, {plan.killsUsed.filter((k) => k.kill.killIndex === 1).length} of them
        first kills.{" "}
        <a className="see-logs" href={logsHref}>
          See the logs →
        </a>
      </p>
      <Heatmap desktop={buildTimeline(plan, 4_000)} phone={buildTimeline(plan, 8_000)} />
      <h2>Note</h2>
      <pre>{toNote(plan.timings)}</pre>
    </section>
  );
}
