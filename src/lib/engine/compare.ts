import { COOLDOWN_BY_ID } from "@/data/cooldowns";
import { SPEC_LABEL, type HealerSpec, type ReportPull } from "@/lib/types";
import type { PlannedTiming } from "./plan";

/** A press this close to its planned time counts as on time. */
export const ON_TIME_MS = 5_000;
/** A press further than this from a planned time isn't counted as that planned press at all. */
export const MATCH_MS = 20_000;

/** One planned press: a healer's cooldown at a time in a phase. */
export interface PlanLine {
  spellId: number;
  spellName: string;
  spec: HealerSpec;
  /** The player's number within their spec, e.g. 2 for Druid #2. */
  slot: number;
  /** "Resto Druid #2", or "Resto Druid" when the comp has one. */
  group: string;
  /** The player in the log who took this slot, or null when nobody did. */
  player: string | null;
  phaseId: number;
  tPhaseMs: number;
}

/**
 * How one planned press went in one pull. "unreached": the pull ended, or its phase ended, before the planned time.
 */
export type Verdict = "on" | "early" | "late" | "missed" | "unreached";

export interface Mark {
  verdict: Verdict;
  /** Planned time from the pull, or null when the pull never reached the phase. */
  plannedMs: number | null;
  /** When the matching press happened, from the pull. */
  pressedMs: number | null;
  /** Pressed minus planned: negative is early. */
  deltaMs: number | null;
}

/** A press of a planned cooldown that no planned press accounts for. */
export interface ExtraPress {
  spellId: number;
  spec: HealerSpec;
  slot: number;
  pressedMs: number;
}

export interface PullResult {
  pull: ReportPull;
  /** One per plan line, in the same order as `Comparison.lines`. */
  marks: Mark[];
  extras: ExtraPress[];
  onTime: number;
  /** Planned presses the pull reached: on time, early, late or missed. */
  judged: number;
}

export interface Comparison {
  lines: PlanLine[];
  pulls: PullResult[];
}

const specOf = (spellId: number) => COOLDOWN_BY_ID.get(spellId)?.spec ?? null;

/** Where a phase starts and ends in a pull, or null when the pull never got there. */
function phaseSpan(pull: ReportPull, phaseId: number): { startMs: number; endMs: number } | null {
  const phases = [{ id: 1, startMs: 0 }, ...pull.phases.filter((p) => p.id !== 1)].sort((a, b) => a.startMs - b.startMs);
  const i = phases.findIndex((p) => p.id === phaseId);
  if (i < 0) return null;
  return { startMs: phases[i].startMs, endMs: i + 1 < phases.length ? phases[i + 1].startMs : pull.durationMs };
}

/** Pairs planned times with presses, closest pairs first, each used once. Returns the press index for each planned time. */
function pair(planned: number[], pressed: number[]): (number | null)[] {
  const pairs: { p: number; a: number; d: number }[] = [];
  planned.forEach((t, p) => pressed.forEach((at, a) => Math.abs(at - t) <= MATCH_MS && pairs.push({ p, a, d: Math.abs(at - t) })));
  pairs.sort((x, y) => x.d - y.d || x.p - y.p);
  const out: (number | null)[] = planned.map(() => null);
  const used = new Set<number>();
  for (const { p, a } of pairs) {
    if (out[p] !== null || used.has(a)) continue;
    out[p] = a;
    used.add(a);
  }
  return out;
}

function permutations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)], k - 1).map((rest) => [x, ...rest]));
}

/**
 * Picks which player in the log plays each numbered slot of a spec, e.g. which Resto Druid is #1, keeping one
 * answer for the whole report: the order whose presses line up with the most planned presses across all pulls.
 */
function assignPlayers(timings: PlannedTiming[], pulls: ReportPull[], comp: HealerSpec[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const spec of new Set(comp)) {
    const count = comp.filter((s) => s === spec).length;
    const presses = new Map<string, number>();
    for (const pull of pulls) {
      for (const h of pull.healers) if (h.spec === spec && !presses.has(h.name)) presses.set(h.name, 0);
      for (const c of pull.casts) if (specOf(c.spellId) === spec) presses.set(c.source, (presses.get(c.source) ?? 0) + 1);
    }
    // The most active players, so the search stays small in a report with many swaps.
    const players = [...presses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name]) => name);

    const score = (player: string, slot: number) => {
      let s = 0;
      for (const pull of pulls) {
        for (const t of timings) {
          if (t.spec !== spec || t.slot !== slot) continue;
          const span = phaseSpan(pull, t.phaseId);
          if (!span) continue;
          const at = span.startMs + t.tPhaseMs;
          if (pull.casts.some((c) => c.source === player && c.spellId === t.spellId && Math.abs(c.timestampMs - at) <= MATCH_MS)) s++;
        }
      }
      return s;
    };
    let best: string[] = [];
    let bestScore = -1;
    for (const order of permutations(players, Math.min(count, players.length))) {
      const s = order.reduce((sum, player, i) => sum + score(player, i + 1), 0);
      if (s > bestScore) {
        best = order;
        bestScore = s;
      }
    }
    best.forEach((player, i) => out.set(`${spec}#${i + 1}`, player));
  }
  return out;
}

/** Judges every pull against the plan's healer cooldowns: on time within 5 seconds, early, late, missed or not reached. */
export function comparePulls(timings: PlannedTiming[], comp: HealerSpec[], pulls: ReportPull[]): Comparison {
  const healerTimings = timings
    .filter((t): t is PlannedTiming & { spec: HealerSpec } => t.spec !== null)
    .sort((a, b) => a.phaseId - b.phaseId || a.tPhaseMs - b.tPhaseMs || a.spellName.localeCompare(b.spellName));
  const players = assignPlayers(healerTimings, pulls, comp);
  const doubled = (spec: HealerSpec) => comp.filter((s) => s === spec).length > 1;

  const lines: PlanLine[] = healerTimings.map((t) => ({
    spellId: t.spellId,
    spellName: t.spellName,
    spec: t.spec,
    slot: t.slot,
    group: doubled(t.spec) ? `${SPEC_LABEL[t.spec]} #${t.slot}` : SPEC_LABEL[t.spec],
    player: players.get(`${t.spec}#${t.slot}`) ?? null,
    phaseId: t.phaseId,
    tPhaseMs: t.tPhaseMs,
  }));
  const slotOf = new Map([...players].map(([key, name]) => [name, Number(key.split("#")[1])]));

  const results = pulls.map((pull) => {
    const marks: Mark[] = lines.map(() => ({ verdict: "unreached", plannedMs: null, pressedMs: null, deltaMs: null }));
    const extras: ExtraPress[] = [];
    // Each player's presses of each cooldown, matched against that slot's planned presses of it.
    const rows = new Map<string, number[]>();
    lines.forEach((l, i) => rows.set(`${l.spellId}#${l.slot}`, [...(rows.get(`${l.spellId}#${l.slot}`) ?? []), i]));
    const pressesOf = new Map<string, number[]>();
    for (const c of pull.casts) {
      const spec = specOf(c.spellId);
      const slot = slotOf.get(c.source);
      if (!spec || slot === undefined || players.get(`${spec}#${slot}`) !== c.source) continue;
      const key = `${c.spellId}#${slot}`;
      pressesOf.set(key, [...(pressesOf.get(key) ?? []), c.timestampMs]);
    }

    for (const key of new Set([...rows.keys(), ...pressesOf.keys()])) {
      const lineIdx = rows.get(key) ?? [];
      const pressed = (pressesOf.get(key) ?? []).sort((a, b) => a - b);
      // Planned presses the pull got to, with the end of their phase.
      const reachable = lineIdx.flatMap((i) => {
        const span = phaseSpan(pull, lines[i].phaseId);
        if (!span) return [];
        const at = span.startMs + lines[i].tPhaseMs;
        marks[i].plannedMs = at;
        return at <= span.endMs ? [{ i, at, endMs: span.endMs }] : [];
      });
      const match = pair(reachable.map((r) => r.at), pressed);
      reachable.forEach((r, j) => {
        const a = match[j];
        if (a === null) {
          // Planned too close to the end of its phase to judge a press that never came.
          marks[r.i].verdict = r.at + ON_TIME_MS > r.endMs ? "unreached" : "missed";
          return;
        }
        const delta = pressed[a] - r.at;
        marks[r.i] = {
          verdict: Math.abs(delta) <= ON_TIME_MS ? "on" : delta < 0 ? "early" : "late",
          plannedMs: r.at,
          pressedMs: pressed[a],
          deltaMs: delta,
        };
      });
      const used = new Set(match.filter((a): a is number => a !== null));
      const [spellId, slot] = key.split("#").map(Number);
      pressed.forEach((at, a) => {
        if (!used.has(a)) extras.push({ spellId, spec: specOf(spellId)!, slot, pressedMs: at });
      });
    }

    const judged = marks.filter((m) => m.verdict !== "unreached").length;
    return { pull, marks, extras, onTime: marks.filter((m) => m.verdict === "on").length, judged };
  });

  return { lines, pulls: results };
}
