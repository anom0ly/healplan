import { COOLDOWN_BY_ID } from "@/data/cooldowns";
import { HEALER_SPECS, SPEC_LABEL, type HealerSpec, type KillRecord } from "@/lib/types";
import type { Plan } from "./plan";

export interface TimelinePhase {
  id: number;
  /** Where the phase starts and how wide it is, as percentages of the whole fight. */
  leftPct: number;
  widthPct: number;
  lengthMs: number;
}

export interface TimelineMark {
  /** The consensus press, and the spread of presses around it, as percentages of the whole fight. */
  atPct: number;
  fromPct: number;
  toPct: number;
  phaseId: number;
  tPhaseMs: number;
  earliestMs: number;
  latestMs: number;
  support: number;
  killCount: number;
}

export interface TimelineRow {
  spellId: number;
  spellName: string;
  spec: HealerSpec | null;
  marks: TimelineMark[];
}

/** The cooldowns one class or healer spec brings, e.g. "Resto Druid" or "Warrior". */
export interface TimelineGroup {
  label: string;
  /** How many of this healer spec are in the comp; 0 for raid-wide cooldowns from other classes. */
  count: number;
  rows: TimelineRow[];
}

export interface Timeline {
  phases: TimelinePhase[];
  totalMs: number;
  groups: TimelineGroup[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Typical length of each phase across kills, in fight order. A phase ends where the next one starts, or at the kill. */
export function phaseLengths(kills: KillRecord[]): { id: number; lengthMs: number }[] {
  const lengths = new Map<number, number[]>();
  const starts = new Map<number, number[]>();
  for (const k of kills) {
    const phases = [{ id: 1, startMs: 0 }, ...k.phases.filter((p) => p.id !== 1)].sort((a, b) => a.startMs - b.startMs);
    phases.forEach((p, i) => {
      const end = i + 1 < phases.length ? phases[i + 1].startMs : k.durationMs;
      if (end <= p.startMs) return;
      lengths.set(p.id, [...(lengths.get(p.id) ?? []), end - p.startMs]);
      starts.set(p.id, [...(starts.get(p.id) ?? []), p.startMs]);
    });
  }
  return [...lengths.keys()]
    .sort((a, b) => median(starts.get(a)!) - median(starts.get(b)!))
    .map((id) => ({ id, lengthMs: median(lengths.get(id)!) }));
}

/** Lays a plan out on one fight-long axis: phases end to end at their typical length, one row per cooldown. */
export function buildTimeline(plan: Plan): Timeline {
  const lengths = phaseLengths(plan.killsUsed.map((w) => w.kill));
  // A timing can fall in a phase none of the used kills reached in full; give it room to its latest press.
  for (const t of plan.timings) {
    if (!lengths.some((p) => p.id === t.phaseId)) lengths.push({ id: t.phaseId, lengthMs: t.latestMs });
  }
  const totalMs = lengths.reduce((sum, p) => sum + p.lengthMs, 0) || 1;
  const pct = (ms: number) => Math.round((ms / totalMs) * 10_000) / 100;

  const offset = new Map<number, number>();
  let at = 0;
  const phases = lengths.map((p) => {
    offset.set(p.id, at);
    const phase = { id: p.id, leftPct: pct(at), widthPct: pct(p.lengthMs), lengthMs: p.lengthMs };
    at += p.lengthMs;
    return phase;
  });
  const lengthOf = new Map(lengths.map((p) => [p.id, p.lengthMs]));
  // Times past the typical phase length are pinned to its end so marks stay inside their phase.
  const place = (phaseId: number, ms: number) => pct(offset.get(phaseId)! + Math.min(ms, lengthOf.get(phaseId)!));

  const rows = new Map<number, TimelineRow>();
  for (const t of plan.timings) {
    const row = rows.get(t.spellId) ?? { spellId: t.spellId, spellName: t.spellName, spec: t.spec, marks: [] };
    row.marks.push({
      atPct: place(t.phaseId, t.tPhaseMs),
      fromPct: place(t.phaseId, t.earliestMs),
      toPct: place(t.phaseId, t.latestMs),
      phaseId: t.phaseId,
      tPhaseMs: t.tPhaseMs,
      earliestMs: t.earliestMs,
      latestMs: t.latestMs,
      support: t.support,
      killCount: t.killCount,
    });
    rows.set(t.spellId, row);
  }
  for (const row of rows.values()) row.marks.sort((a, b) => a.atPct - b.atPct);

  // One group per healer spec in comp order, then raid-wide cooldowns by the class that casts them.
  const groups = new Map<string, TimelineGroup & { order: number }>();
  for (const row of rows.values()) {
    const label = row.spec ? SPEC_LABEL[row.spec] : (COOLDOWN_BY_ID.get(row.spellId)?.className ?? "Other");
    const order = row.spec ? HEALER_SPECS.indexOf(row.spec) : HEALER_SPECS.length;
    const count = row.spec ? plan.comp.filter((s) => s === row.spec).length : 0;
    const group = groups.get(label) ?? { label, count, rows: [], order };
    group.rows.push(row);
    groups.set(label, group);
  }

  return {
    phases,
    totalMs,
    groups: [...groups.values()]
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map(({ order: _, ...g }) => ({ ...g, rows: g.rows.sort((a, b) => a.spellName.localeCompare(b.spellName)) })),
  };
}
