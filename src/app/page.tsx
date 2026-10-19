import { redirect } from "next/navigation";
import { listBosses, loadKills, type BossOption } from "@/lib/db";
import { comparePulls } from "@/lib/engine/compare";
import { buildPlan, type Plan } from "@/lib/engine/plan";
import { compShifts, type CompShift } from "@/lib/engine/shift";
import { buildTimeline } from "@/lib/engine/timeline";
import { compOf, loadReport, parseReportLink, ReportError, type LoadedReport } from "@/lib/reports";
import { parseComp, parsePlanRequest } from "@/lib/request";
import { HEALER_SPECS, type HealerSpec } from "@/lib/types";
import { Heatmap } from "./heatmap";
import { Badge, Picker } from "./picker";
import { PullDetail, PullsOverview } from "./pulls";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Tab = "guild" | "compare";
type View = "overview" | "pull";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const val = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  const tab: Tab = val("tab") === "compare" ? "compare" : "guild";
  // A pasted log, read only on the compare tab: its pulls, and the boss and healers to fill in.
  const pasted = tab === "compare" ? val("log") : "";
  const link = pasted ? parseReportLink(pasted) : null;
  let report: LoadedReport | null = null;
  let reportError: string | null = pasted && !link ? "That doesn't look like a Warcraft Logs report link." : null;
  if (link) {
    try {
      report = await loadReport(link, {
        encounterId: Number(val("encounter")) || undefined,
        difficulty: val("difficulty") === "heroic" ? "heroic" : val("difficulty") === "mythic" ? "mythic" : undefined,
      });
    } catch (e) {
      reportError = e instanceof ReportError ? e.message : "Couldn't read that log. Try again in a minute.";
    }
  }
  // A freshly pasted link, or a pick of another boss in the log, fills in the boss and healers from the log, then the page keeps just the report code.
  const stale = report && (pasted !== report.code || Number(val("encounter")) !== report.encounterId || val("difficulty") !== report.difficulty || parseComp(params).length === 0);
  if (report && stale) {
    const q = new URLSearchParams({ tab: "compare", log: report.code, encounter: String(report.encounterId), difficulty: report.difficulty });
    const comp = compOf(report.pulls);
    for (const spec of HEALER_SPECS) if (comp.includes(spec)) q.set(spec, String(comp.filter((s) => s === spec).length));
    redirect(`/?${q}`);
  }

  const req = parsePlanRequest(params);
  // A pasted log is checked against its own comp, so any comp only applies without one.
  const anyComp = !!req?.anyComp && !report;
  let plan: Plan | null = null;
  let shifts = new Map<number, CompShift>();
  let error: string | null = null;
  if (req) {
    try {
      const kills = await loadKills(req.encounterId, req.difficulty);
      const weight = { now: Date.now(), firstKillsOnly: req.firstKillsOnly };
      if (anyComp) {
        // Every spec, so turning specs on and off in the picker only hides rows.
        plan = buildPlan(kills, [...HEALER_SPECS], { weight, anyComp: true });
      } else {
        plan = buildPlan(kills, req.comp, { weight });
        shifts = compShifts(plan, buildPlan(kills, [...new Set(req.comp)], { weight, anyComp: true }));
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }
  // Falls back to typing an encounter id when the boss list can't be read or the crawler hasn't saved it yet.
  const bosses: BossOption[] = await listBosses().catch(() => []);

  const view: View = val("view") === "pull" ? "pull" : "overview";
  const tabHref = (t: Tab) => `/?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(queryString(params, ["tab", "view", "pull"]))), tab: t })}`;
  // The guild tab carries a pasted log along, so going back to compare keeps it.
  const keep: Record<string, string> = val("log") ? { log: val("log") } : {};

  return (
    <main>
      <h1>Healplan</h1>
      <p className="muted">
        When guilds with your healing comp used their cooldowns, weighted toward first kills and recent kills.
      </p>

      <nav className="pv-tabs pv-top" aria-label="Views">
        {(
          [
            ["guild", "Guild timings"],
            ["compare", "Compare your pulls"],
          ] as const
        ).map(([t, label]) => (
          <a key={t} href={tabHref(t)} className={tab === t ? "pv-tab-on" : undefined} aria-current={tab === t ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>

      {tab === "guild" && (
        <>
          <Picker
            bosses={bosses}
            keep={keep}
            initial={{
              encounter: val("encounter"),
              difficulty: val("difficulty") === "heroic" ? "heroic" : "mythic",
              comp: parseComp(params),
              firstKillsOnly: val("firstKillsOnly") === "1",
              anyComp,
            }}
            live={anyComp && plan !== null}
          />
          {error && <p>Couldn&apos;t load kills: {error}</p>}
          {plan && (
            <PlanView
              plan={plan}
              shifts={shifts}
              hidden={anyComp ? HEALER_SPECS.filter((s) => !req!.comp.includes(s)) : []}
              // Any comp's heat map is built from every kill, whichever specs are shown.
              logsHref={`/logs?${queryString(params, anyComp ? [...HEALER_SPECS, "tab", "log"] : ["tab", "log"])}`}
            />
          )}
        </>
      )}

      {tab === "compare" && !report && (
        <form method="get" className="pv-paste">
          <input type="hidden" name="tab" value="compare" />
          <h2>See how your pulls line up with other guilds</h2>
          <label className="pk-field pv-paste-field">
            Warcraft Logs link
            <input name="log" type="url" inputMode="url" placeholder="https://www.warcraftlogs.com/reports/…" defaultValue={pasted} />
          </label>
          <button type="submit">Compare pulls</button>
          {reportError ? <p className="pv-error">{reportError}</p> : <p className="muted">Boss and healers are read from your log.</p>}
        </form>
      )}

      {tab === "compare" && report && (
        <>
          <LogBar report={report} bosses={bosses} plan={plan} params={params} />
          {error && <p>Couldn&apos;t load kills: {error}</p>}
          {plan && (
            <>
              <nav className="pv-sub" aria-label="Compare views">
                {(
                  [
                    ["overview", "Overview"],
                    ["pull", "Pull by pull"],
                  ] as const
                ).map(([v, label]) => (
                  <a key={v} href={`/?${queryString(params, ["view", "pull"])}&view=${v}`} className={view === v ? "pv-sub-on" : undefined} aria-current={view === v ? "page" : undefined}>
                    {label}
                  </a>
                ))}
              </nav>
              <PullsView plan={plan} report={report} view={view} base={queryString(params, ["view", "pull"])} selected={Number(val("pull"))} />
            </>
          )}
        </>
      )}
    </main>
  );
}

/** The pasted log at the top of the compare tab: which boss, how many pulls and the comp it's checked against. */
function LogBar({ report, bosses, plan, params }: { report: LoadedReport; bosses: BossOption[]; plan: Plan | null; params: Record<string, string | string[] | undefined> }) {
  const name = (id: number) => bosses.find((b) => b.id === id)?.name ?? `Boss ${id}`;
  const diff = (d: string) => (d === "heroic" ? "Heroic" : "Mythic");
  const others = report.bosses.filter((b) => b.encounterId !== report.encounterId || b.difficulty !== report.difficulty);
  const bossHref = (b: { encounterId: number; difficulty: string }) => `/?${new URLSearchParams({ tab: "compare", log: report.code, encounter: String(b.encounterId), difficulty: b.difficulty })}`;
  return (
    <div className="pv-log">
      <strong>{report.title}</strong>
      <span className="muted">
        {name(report.encounterId)} · {diff(report.difficulty)} · {report.pulls.length} {report.pulls.length === 1 ? "pull" : "pulls"}
      </span>
      <span className="pk-badges">
        {compOf(report.pulls).map((s, i) => (
          <Badge key={i} spec={s} />
        ))}
      </span>
      {plan && <span className="muted pv-log-vs">vs {plan.killsUsed.length} guild kills with this comp</span>}
      {others.length > 0 && (
        <span className="pv-log-others">
          Also in this log:{" "}
          {others.map((b, i) => (
            <span key={`${b.encounterId}-${b.difficulty}`}>
              {i > 0 && ", "}
              <a href={bossHref(b)}>
                {name(b.encounterId)} {diff(b.difficulty)}
              </a>
            </span>
          ))}
        </span>
      )}
      <a className="pv-log-new" href={`/?${queryString(params, ["log", "view", "pull"])}`}>
        Paste a different log
      </a>
    </div>
  );
}

/** The page's own query, for links to pages about the same boss and comp, leaving out `drop`. */
function queryString(params: Record<string, string | string[] | undefined>, drop: string[] = []) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && !drop.includes(k)) q.set(k, v);
  return q.toString();
}

function PlanView({ plan, shifts, hidden, logsHref }: { plan: Plan; shifts: Map<number, CompShift>; hidden: HealerSpec[]; logsHref: string }) {
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
      <Heatmap
        desktop={buildTimeline(plan, 4_000, {}, shifts)}
        phone={buildTimeline(plan, 8_000, {}, shifts)}
        hidden={hidden}
        live={plan.anyComp}
      />
    </section>
  );
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

function PullsView({ plan, report, view, base, selected }: { plan: Plan; report: LoadedReport; view: View; base: string; selected: number }) {
  const req = plan.comp;
  const params = new URLSearchParams(base);
  if (Number(params.get("encounter")) !== report.encounterId || params.get("difficulty") !== report.difficulty) {
    return <p className="muted">Your log has no pulls on this boss and difficulty. Pick one of the bosses above to compare.</p>;
  }
  if (plan.killsUsed.length === 0) return <p>No matching kills to build a plan from yet. Try a looser comp or turn off first kills only.</p>;
  const comparison = comparePulls(plan.timings, req, report.pulls);
  const single = comparison.lines.every((l) => l.phaseId === 1);
  const pullHref = `/?${base}&view=pull&pull=`;
  return (
    <>
      {report.missing > 0 && (
        <p className="muted">
          {report.missing} {report.missing === 1 ? "pull" : "pulls"} couldn&apos;t be fetched yet because Warcraft Logs is busy. Reload later to add them.
        </p>
      )}
      {view === "overview" ? (
        <PullsOverview comparison={comparison} pullHref={pullHref} single={single} />
      ) : (
        <PullDetail
          comparison={comparison}
          selected={selected || report.pulls[report.pulls.length - 1].number}
          pullHref={pullHref}
          axisMs={median(plan.killsUsed.map((k) => k.kill.durationMs))}
          single={single}
        />
      )}
    </>
  );
}
