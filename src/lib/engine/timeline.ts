import { COOLDOWN_BY_ID, cooldownsForComp } from "@/data/cooldowns";
import { HEALER_SPECS, SPEC_LABEL, killKey, type HealerSpec, type KillRecord } from "@/lib/types";
import { toPhaseTime } from "./cluster";
import type { Plan } from "./plan";

export interface TimelinePhase {
  id: number;
  /** Where the phase starts on the fight axis, and its typical length. */
  startMs: number;
  lengthMs: number;
  /** The same, as percentages of the whole fight. */
  leftPct: number;
  widthPct: number;
}

/** One slice of a phase, times measured from the start of the phase. */
export interface HeatSlice {
  startMs: number;
  endMs: number;
  /**
   * Share of the kill weight that reached this phase and pressed the cooldown in or near this slice, in [0, 1].
   * Zero when under the floor.
   */
  share: number;
  /** Kills that pressed it in or near this slice. */
  kills: number;
}

export interface HeatOptions {
  /** Slices where fewer than this share of kills pressed the cooldown stay blank, so stray presses don't tint the row. */
  floor: number;
  /** Presses this close to a slice count toward it too, so one press spread over a few seconds reads as one hot spot. */
  nearMs: number;
}

export const DEFAULT_HEAT_OPTIONS: HeatOptions = { floor: 0.1, nearMs: 4_000 };

export interface TimelineRow {
  spellId: number;
  spellName: string;
  spec: HealerSpec | null;
  /** Slices per phase, in the same order as `Timeline.phases`. */
  phases: HeatSlice[][];
  /** The consensus presses from the plan, used for "most common" times. */
  common: { phaseId: number; tPhaseMs: number }[];
}

/** The cooldowns one class or healer spec brings, e.g. "Resto Druid" or "Warrior". */
export interface TimelineGroup {
  label: string;
  /** How many of this healer spec are in the comp; 0 for raid-wide cooldowns from other classes. */
  count: number;
  rows: TimelineRow[];
}

/** All cooldowns together: how many get pressed per kill in each slice. */
export interface AllSlice {
  startMs: number;
  endMs: number;
  perKill: number;
}

export interface Timeline {
  phases: TimelinePhase[];
  totalMs: number;
  bucketMs: number;
  killCount: number;
  groups: TimelineGroup[];
  all: AllSlice[][];
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

/** Cuts a phase into slices of `bucketMs` from the phase start. A leftover under half a slice joins the last one. */
const sliceBounds = (lengthMs: number, bucketMs: number) => {
  const count = Math.max(1, Math.round(lengthMs / bucketMs));
  return Array.from({ length: count }, (_, i) => ({
    startMs: i * bucketMs,
    endMs: i === count - 1 ? lengthMs : (i + 1) * bucketMs,
  }));
};

/**
 * Lays a plan out on one fight-long axis, phases end to end at their typical
 * length, and counts for every cooldown in the comp how much of the kill
 * weight pressed it in each slice of each phase.
 */
export function buildTimeline(plan: Plan, bucketMs = 4_000, opts: Partial<HeatOptions> = {}): Timeline {
  const { floor, nearMs } = { ...DEFAULT_HEAT_OPTIONS, ...opts };
  const reach = Math.floor(nearMs / bucketMs);
  const kills = plan.killsUsed;
  const lengths = phaseLengths(kills.map((w) => w.kill));
  if (lengths.length === 0) lengths.push({ id: 1, lengthMs: bucketMs });
  const totalMs = lengths.reduce((sum, p) => sum + p.lengthMs, 0);
  const pct = (ms: number) => Math.round((ms / totalMs) * 10_000) / 100;

  let at = 0;
  const phases = lengths.map((p) => {
    const phase = { id: p.id, startMs: at, lengthMs: p.lengthMs, leftPct: pct(at), widthPct: pct(p.lengthMs) };
    at += p.lengthMs;
    return phase;
  });
  const phaseIndex = new Map(phases.map((p, i) => [p.id, i]));
  const bounds = phases.map((p) => sliceBounds(p.lengthMs, bucketMs));

  // Kill weight that reached each phase, so a phase only some kills saw isn't judged against all of them.
  const reached = phases.map(() => 0);
  for (const { kill, weight } of kills) {
    for (const id of new Set([1, ...kill.phases.map((p) => p.id)])) {
      const i = phaseIndex.get(id);
      if (i !== undefined) reached[i] += weight;
    }
  }

  // spellId -> phase -> slice -> kill key -> weight. A kill counts once per slice even if it pressed twice.
  const pressed = new Map<number, Map<string, number>[][]>();
  const spells = new Set(cooldownsForComp(plan.comp).map((c) => c.spellId));
  for (const { kill, weight } of kills) {
    const key = killKey(kill);
    for (const c of kill.casts) {
      if (!spells.has(c.spellId)) continue;
      const { phaseId, tPhaseMs } = toPhaseTime(c.timestampMs, kill.phases);
      const pi = phaseIndex.get(phaseId);
      if (pi === undefined) continue;
      // Presses past the typical phase length land in its last slice.
      const si = Math.min(bounds[pi].length - 1, Math.floor(tPhaseMs / bucketMs));
      if (!pressed.has(c.spellId)) pressed.set(c.spellId, bounds.map((b) => b.map(() => new Map())));
      pressed.get(c.spellId)![pi][si].set(key, weight);
    }
  }

  const rows: TimelineRow[] = [...pressed].map(([spellId, perPhase]) => {
    const cd = COOLDOWN_BY_ID.get(spellId);
    return {
      spellId,
      spellName: cd?.name ?? `Spell ${spellId}`,
      spec: cd?.spec ?? null,
      phases: perPhase.map((slices, pi) =>
        slices.map((_, si) => {
          const byKill = new Map<string, number>();
          for (let k = Math.max(0, si - reach); k <= Math.min(slices.length - 1, si + reach); k++) {
            for (const [key, weight] of slices[k]) byKill.set(key, weight);
          }
          const w = [...byKill.values()].reduce((a, b) => a + b, 0);
          const share = reached[pi] > 0 ? Math.min(1, w / reached[pi]) : 0;
          return share < floor ? { ...bounds[pi][si], share: 0, kills: 0 } : { ...bounds[pi][si], share, kills: byKill.size };
        }),
      ),
      common: plan.timings.filter((t) => t.spellId === spellId).map((t) => ({ phaseId: t.phaseId, tPhaseMs: t.tPhaseMs })),
    };
  });

  const all = bounds.map((slices, pi) =>
    slices.map((b, si) => ({ ...b, perKill: rows.reduce((sum, r) => sum + r.phases[pi][si].share, 0) })),
  );

  // One group per healer spec in comp order, then raid-wide cooldowns by the class that casts them.
  const groups = new Map<string, TimelineGroup & { order: number }>();
  for (const row of rows) {
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
    bucketMs,
    killCount: kills.length,
    groups: [...groups.values()]
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map(({ order: _, ...g }) => ({ ...g, rows: g.rows.sort((a, b) => a.spellName.localeCompare(b.spellName)) })),
    all,
  };
}
