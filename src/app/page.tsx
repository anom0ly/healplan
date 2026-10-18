import { listBosses, loadKills, type BossOption } from "@/lib/db";
import { buildPlan, type Plan } from "@/lib/engine/plan";
import { formatTime, toNote } from "@/lib/engine/note";
import { buildTimeline, type Timeline } from "@/lib/engine/timeline";
import { parsePlanRequest } from "@/lib/request";
import { HEALER_SPECS, SPEC_LABEL } from "@/lib/types";

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

      <form method="get">
        {bosses.length > 0 ? (
          <label>
            Boss
            <select name="encounter" defaultValue={val("encounter") || String(bosses[0].id)} required>
              {groupByZone(bosses).map(([zoneName, zoneBosses]) => (
                <optgroup key={zoneName} label={zoneName}>
                  {zoneBosses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.kills.mythic.toLocaleString("en-US")} Mythic, {b.kills.heroic.toLocaleString("en-US")} Heroic kills)
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Encounter id
            <input name="encounter" type="number" defaultValue={val("encounter")} required />
          </label>
        )}
        <label>
          Difficulty
          <select name="difficulty" defaultValue={val("difficulty") || "mythic"}>
            <option value="mythic">Mythic</option>
            <option value="heroic">Heroic</option>
          </select>
        </label>
        <fieldset>
          <legend>Healing comp</legend>
          {HEALER_SPECS.map((spec) => (
            <label key={spec}>
              {SPEC_LABEL[spec]}
              <input name={spec} type="number" min={0} max={6} defaultValue={val(spec) || "0"} />
            </label>
          ))}
        </fieldset>
        <label>
          <input name="firstKillsOnly" type="checkbox" value="1" defaultChecked={val("firstKillsOnly") === "1"} />
          First kills only
        </label>
        <button type="submit">Show cooldowns</button>
      </form>

      {error && <p>Couldn&apos;t load kills: {error}</p>}
      {plan && <PlanView plan={plan} />}
    </main>
  );
}

function groupByZone(bosses: BossOption[]): [string, BossOption[]][] {
  const zones = new Map<string, BossOption[]>();
  for (const b of bosses) zones.set(b.zoneName, [...(zones.get(b.zoneName) ?? []), b]);
  return [...zones];
}

function PlanView({ plan }: { plan: Plan }) {
  if (plan.killsUsed.length === 0) return <p>No matching kills yet. Try a looser comp or turn off first kills only.</p>;
  return (
    <section>
      <p className="muted">
        Based on {plan.killsUsed.length} kills, {plan.killsUsed.filter((k) => k.kill.killIndex === 1).length} of them
        first kills.
      </p>
      <TimelineView timeline={buildTimeline(plan)} />
      <h2>Timings</h2>
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Time</th>
            <th>Cooldown</th>
            <th>Agreement</th>
          </tr>
        </thead>
        <tbody>
          {plan.timings.map((t) => (
            <tr key={`${t.spellId}-${t.phaseId}-${t.tPhaseMs}`}>
              <td>P{t.phaseId}</td>
              <td>
                {formatTime(t.tPhaseMs)} <span className="muted">({formatTime(t.earliestMs)} to {formatTime(t.latestMs)})</span>
              </td>
              <td>{t.spellName}</td>
              <td>
                {Math.round(t.support * 100)}% <span className="muted">({t.killCount} kills)</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Note</h2>
      <pre>{toNote(plan.timings)}</pre>
      <h2>Logs used</h2>
      <ul>
        {[...plan.killsUsed]
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 15)
          .map(({ kill }) => (
            <li key={`${kill.reportCode}-${kill.fightId}`}>
              <a href={`https://www.warcraftlogs.com/reports/${kill.reportCode}#fight=${kill.fightId}`}>{kill.guildName}</a>{" "}
              <span className="muted">
                {kill.killIndex === 1 ? "first kill" : kill.killIndex ? `kill ${kill.killIndex}` : "kill"},{" "}
                {new Date(kill.killDate).toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

function TimelineView({ timeline }: { timeline: Timeline }) {
  const phaseGrid = timeline.phases.map((p) => (
    <div key={p.id} className="tl-phase" style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }} />
  ));
  return (
    <section className="timeline" aria-label="Cooldown timeline">
      <div className="tl-row tl-head">
        <div className="tl-label" />
        <div className="tl-track">
          {timeline.phases.map((p) => (
            <div key={p.id} className="tl-phase tl-phase-name" style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }}>
              P{p.id} <span className="muted">{formatTime(p.lengthMs)}</span>
            </div>
          ))}
        </div>
      </div>
      {timeline.groups.map((g) => (
        <div key={g.label} className="tl-group">
          <div className="tl-group-name">
            {g.label}
            {g.count > 1 && <span className="muted"> ×{g.count}</span>}
          </div>
          {g.rows.map((row) => (
            <div key={row.spellId} className="tl-row">
              <div className="tl-label">{row.spellName}</div>
              <div className="tl-track">
                {phaseGrid}
                {row.marks.map((m) => (
                  <div
                    key={`${m.phaseId}-${m.tPhaseMs}`}
                    title={`P${m.phaseId} ${formatTime(m.tPhaseMs)} (${formatTime(m.earliestMs)} to ${formatTime(m.latestMs)}), ${Math.round(m.support * 100)}% of ${m.killCount} kills`}
                  >
                    <div className="tl-spread" style={{ left: `${m.fromPct}%`, width: `${Math.max(m.toPct - m.fromPct, 0.5)}%`, opacity: 0.25 + m.support * 0.5 }} />
                    <div className="tl-mark" style={{ left: `${m.atPct}%` }} />
                    <span className="tl-time" style={{ left: `${m.toPct}%` }}>
                      {formatTime(m.tPhaseMs)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <p className="muted tl-legend">Each mark is when guilds with your comp usually press the cooldown, timed from the start of its phase. The band shows the spread, and a darker band means more guilds agree.</p>
    </section>
  );
}
