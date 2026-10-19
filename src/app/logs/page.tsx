import { listBosses, loadKills } from "@/lib/db";
import { buildPlan, type Plan } from "@/lib/engine/plan";
import { formatTime } from "@/lib/engine/note";
import { parsePlanRequest } from "@/lib/request";
import { SPEC_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

const SHOWN = 15;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Every kill behind one heat map, heaviest first, each linked to its log. */
export default async function Logs({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const req = parsePlanRequest(params);
  const back = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && k !== "all") back.set(k, v);
  const backHref = `/?${back.toString()}`;

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
  const boss = req ? (await listBosses().catch(() => [])).find((b) => b.id === req.encounterId) : undefined;
  const kills = plan ? [...plan.killsUsed].sort((a, b) => b.weight - a.weight) : [];
  const showAll = params.all === "1";
  const shown = showAll ? kills : kills.slice(0, SHOWN);
  const maxWeight = Math.max(...kills.map((k) => k.weight), 0.0001);

  return (
    <main className="lg">
      <a className="muted lg-back" href={backHref}>
        ← Back to cooldowns
      </a>
      <h1>Logs used</h1>
      {req && (
        <p className="muted lg-sub">
          {boss?.name ?? `Encounter ${req.encounterId}`} · {req.difficulty === "heroic" ? "Heroic" : "Mythic"} ·{" "}
          {req.comp.map((s) => SPEC_LABEL[s]).join(", ")}
        </p>
      )}
      {!req && <p>Pick a boss and healing comp first.</p>}
      {error && <p>Couldn&apos;t load kills: {error}</p>}
      {plan && kills.length === 0 && <p>No matching kills yet.</p>}
      {kills.length > 0 && (
        <>
          <p className="muted">
            {kills.length} kills, {kills.filter((k) => k.kill.killIndex === 1).length} of them first kills. Kills nearer
            the top count for more.
          </p>
          <table className="lg-table">
            <thead>
              <tr>
                <th>Guild</th>
                <th>Kill</th>
                <th>Date</th>
                <th>Length</th>
                <th title="How much this kill counts toward the heat map">Counts for</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ kill, weight }) => (
                <tr key={`${kill.reportCode}-${kill.fightId}`}>
                  <td className="lg-guild">{kill.guildName}</td>
                  <td>
                    {kill.killIndex === 1 ? (
                      <span className="lg-first">First kill</span>
                    ) : kill.killIndex ? (
                      `Kill ${kill.killIndex}`
                    ) : (
                      "Kill"
                    )}
                  </td>
                  <td className="muted">{new Date(kill.killDate).toISOString().slice(0, 10)}</td>
                  <td className="hm-mono">{formatTime(kill.durationMs)}</td>
                  <td>
                    <span className="lg-weight" title={`${Math.round((weight / maxWeight) * 100)}% of the top kill`}>
                      <span style={{ width: `${(weight / maxWeight) * 100}%` }} />
                    </span>
                  </td>
                  <td className="lg-open">
                    <a href={`https://www.warcraftlogs.com/reports/${kill.reportCode}#fight=${kill.fightId}`} target="_blank" rel="noopener noreferrer">
                      Open log ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {kills.length > SHOWN && (
            <p className="muted">
              {showAll ? (
                <>
                  Showing all {kills.length} · <a href={`/logs?${back.toString()}`}>Show fewer</a>
                </>
              ) : (
                <>
                  Showing {SHOWN} of {kills.length} · <a href={`/logs?${back.toString()}&all=1`}>Show all</a>
                </>
              )}
            </p>
          )}
        </>
      )}
    </main>
  );
}
