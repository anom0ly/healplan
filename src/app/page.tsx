import { redirect } from "next/navigation";
import { listBosses, loadKills, type BossOption } from "@/lib/db";
import { comparePulls } from "@/lib/engine/compare";
import { buildPlan, type Plan } from "@/lib/engine/plan";
import { buildTimeline } from "@/lib/engine/timeline";
import { compOf, loadReport, parseReportLink, ReportError, type LoadedReport } from "@/lib/reports";
import { parseComp, parsePlanRequest } from "@/lib/request";
import { HEALER_SPECS } from "@/lib/types";
import { Heatmap } from "./heatmap";
import { Picker } from "./picker";
import { PullDetail, PullsOverview } from "./pulls";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type View = "guild" | "overview" | "pull";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const val = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");

  // A pasted log: its pulls, and the boss and healers to fill in.
  const pasted = val("log");
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
  // A freshly pasted link fills in the boss and healers from the log, then the page keeps just the report code.
  if (report && pasted !== report.code) {
    const q = new URLSearchParams({ log: report.code, encounter: String(report.encounterId), difficulty: report.difficulty, view: "overview" });
    const comp = compOf(report.pulls);
    for (const spec of HEALER_SPECS) if (comp.includes(spec)) q.set(spec, String(comp.filter((s) => s === spec).length));
    redirect(`/?${q}`);
  }

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
  // Falls back to typing an encounter id when the boss list can't be read or the crawler hasn't saved it yet.
  const bosses: BossOption[] = await listBosses().catch(() => []);

  const view: View = report && (val("view") === "pull" || val("view") === "overview") ? (val("view") as View) : report ? (val("view") === "guild" ? "guild" : "overview") : "guild";
  const base = queryString(params, ["view", "pull"]);
  const keep: Record<string, string> = report ? { log: report.code, view } : {};

  return (
    <main>
      <h1>Healplan</h1>
      <p className="muted">
        When guilds with your healing comp used their cooldowns, weighted toward first kills and recent kills.
      </p>

      <form method="get" className="pv-paste">
        <label className="pk-field pv-paste-field">
          Check your pulls: paste a Warcraft Logs link
          <input name="log" type="url" inputMode="url" placeholder="https://www.warcraftlogs.com/reports/…" defaultValue={report ? `https://www.warcraftlogs.com/reports/${report.code}` : pasted} />
        </label>
        <button type="submit">Check pulls</button>
        {reportError && <p className="pv-error">{reportError}</p>}
        {report && <p className="muted pv-paste-note">{report.title}</p>}
      </form>

      <Picker
        bosses={bosses}
        keep={keep}
        initial={{
          encounter: val("encounter"),
          difficulty: val("difficulty") === "heroic" ? "heroic" : "mythic",
          comp: parseComp(params),
          firstKillsOnly: val("firstKillsOnly") === "1",
        }}
      />

      {error && <p>Couldn&apos;t load kills: {error}</p>}
      {report && plan && (
        <nav className="pv-tabs" aria-label="Views">
          {(
            [
              ["guild", "Guild timings"],
              ["overview", "Overview"],
              ["pull", "Pull by pull"],
            ] as const
          ).map(([v, label]) => (
            <a key={v} href={`/?${base}&view=${v}`} className={view === v ? "pv-tab-on" : undefined} aria-current={view === v ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      )}
      {plan && view === "guild" && <PlanView plan={plan} logsHref={`/logs?${queryString(params)}`} />}
      {plan && report && view !== "guild" && <PullsView plan={plan} report={report} view={view} base={base} selected={Number(val("pull"))} />}
    </main>
  );
}

/** The page's own query, for links to pages about the same boss and comp, leaving out `drop`. */
function queryString(params: Record<string, string | string[] | undefined>, drop: string[] = []) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && !drop.includes(k)) q.set(k, v);
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
    return <p className="muted">Your log has no pulls on this boss and difficulty. Pick the boss you pulled to compare.</p>;
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
