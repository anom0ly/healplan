import { loadKills } from "@/lib/db";
import { buildPlan, type Plan } from "@/lib/engine/plan";
import { formatTime, toNote } from "@/lib/engine/note";
import { parsePlanRequest } from "@/lib/request";
import { HEALER_SPECS } from "@/lib/types";

export const dynamic = "force-dynamic";

const SPEC_LABEL: Record<(typeof HEALER_SPECS)[number], string> = {
  RestorationDruid: "Resto Druid",
  HolyPaladin: "Holy Paladin",
  DisciplinePriest: "Disc Priest",
  HolyPriest: "Holy Priest",
  RestorationShaman: "Resto Shaman",
  MistweaverMonk: "Mistweaver",
  PreservationEvoker: "Preservation",
};

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

  return (
    <main>
      <h1>Healplan</h1>
      <p className="muted">
        When guilds with your healing comp used their cooldowns, weighted toward first kills and recent kills.
      </p>

      <form method="get">
        <label>
          Encounter id
          <input name="encounter" type="number" defaultValue={val("encounter")} required />
        </label>
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

function PlanView({ plan }: { plan: Plan }) {
  if (plan.killsUsed.length === 0) return <p>No matching kills yet. Try a looser comp or turn off first kills only.</p>;
  return (
    <section>
      <p className="muted">
        Based on {plan.killsUsed.length} kills, {plan.killsUsed.filter((k) => k.kill.killIndex === 1).length} of them
        first kills.
      </p>
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
    </section>
  );
}
