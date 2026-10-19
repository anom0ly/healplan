import { COOLDOWN_BY_ID, cooldownsForComp, pressedByItsSpec } from "@/data/cooldowns";
import { HEALER_SPECS, SPEC_CLASS, SPEC_LABEL, killKey, type HealerSpec, type KillRecord } from "@/lib/types";
import { toPhaseTime } from "./cluster";
import type { Plan } from "./plan";
import { assignSlots, compPools, poolOf } from "./slots";

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
  /** Unique per row: the spell id, plus the player number when a spec is doubled, e.g. "740#2". */
  key: string;
  spellId: number;
  spellName: string;
  spec: HealerSpec | null;
  /** The player's number within their spec, e.g. 2 for Druid #2; 1 for raid-wide cooldowns. */
  slot: number;
  /** Kills this row is judged against: all of them for #1, kills with at least two of the spec for #2. */
  killCount: number;
  /** Slices per phase, in the same order as `Timeline.phases`. */
  phases: HeatSlice[][];
  /** The consensus presses from the plan, used for "most common" times. */
  common: { phaseId: number; tPhaseMs: number }[];
}

/** The cooldowns one class or healer spec brings, e.g. "Resto Druid" or "Warrior". */
export interface TimelineGroup {
  /** Unique per group, e.g. "Resto Druid #2". */
  label: string;
  /** The spec or class alone, e.g. "Resto Druid". */
  name: string;
  /** The player number when the comp has more than one of this spec, else null. */
  slot: number | null;
  /** The class that brings these cooldowns, e.g. "Druid", for its class color. */
  wowClass: string;
  /** How many of this healer spec are in the comp; 0 for raid-wide cooldowns from other classes. Each player gets a group. */
  count: number;
  rows: TimelineRow[];
}

/** All cooldowns together: how many get pressed per kill in each slice. */
export interface AllSlice {
  startMs: number;
  endMs: number;
  perKill: number;
}

/** Raid damage taken in one slice, averaged over the kills that have damage. */
export interface DamageSlice {
  startMs: number;
  endMs: number;
  /** Damage here against the fight's average, e.g. 2.8. null when no kill with damage covers the slice. */
  ratio: number | null;
  /** The ability behind the most damage here, one of its spell ids, and its share of the slice's damage. */
  top: { id: number; name: string; share: number } | null;
}

export interface Timeline {
  phases: TimelinePhase[];
  totalMs: number;
  bucketMs: number;
  killCount: number;
  groups: TimelineGroup[];
  all: AllSlice[][];
  /** Slices per phase like `all`, or null when none of the kills have damage stored. */
  damage: DamageSlice[][] | null;
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
 * Averages the raid's damage taken into the timeline's slices. Each kill is scaled to its own average first, so
 * a kill counts for the shape of its damage rather than its raid's size or gear, then kills are combined by weight.
 * Abilities are matched by name, since one boss ability can have different ids on Heroic and Mythic.
 */
function damageSlices(
  kills: Plan["killsUsed"],
  phaseIndex: Map<number, number>,
  bounds: { startMs: number; endMs: number }[][],
  bucketMs: number,
): DamageSlice[][] | null {
  const acc = bounds.map((b) => b.map(() => ({ weight: 0, value: 0, byName: new Map<string, number>() })));
  // One id per ability name, for linking it.
  const ids = new Map<string, number>();
  let any = false;
  for (const { kill, weight } of kills) {
    const d = kill.damage;
    if (!d || d.total.length === 0) continue;
    const mean = d.total.reduce((a, b) => a + b, 0) / d.total.length;
    if (!(mean > 0)) continue;
    any = true;
    // Second by second, so damage slices and timeline slices of different lengths line up.
    const own = bounds.map((b) => b.map(() => ({ seconds: 0, value: 0, byName: new Map<string, number>() })));
    const end = Math.min(kill.durationMs, d.total.length * d.bucketMs);
    for (let t = 0; t < end; t += 1_000) {
      const di = Math.floor(t / d.bucketMs);
      const { phaseId, tPhaseMs } = toPhaseTime(t + 500, kill.phases);
      const pi = phaseIndex.get(phaseId);
      if (pi === undefined) continue;
      const slot = own[pi][Math.min(bounds[pi].length - 1, Math.floor(tPhaseMs / bucketMs))];
      slot.seconds++;
      slot.value += d.total[di] / mean;
      for (const [id, amount] of d.top[di] ?? []) {
        const name = d.names[id] ?? `Ability ${id}`;
        if (!ids.has(name)) ids.set(name, id);
        slot.byName.set(name, (slot.byName.get(name) ?? 0) + amount / mean);
      }
    }
    own.forEach((slices, pi) =>
      slices.forEach((slot, si) => {
        if (slot.seconds === 0) return;
        const a = acc[pi][si];
        a.weight += weight;
        a.value += (weight * slot.value) / slot.seconds;
        for (const [name, v] of slot.byName) a.byName.set(name, (a.byName.get(name) ?? 0) + (weight * v) / slot.seconds);
      }),
    );
  }
  if (!any) return null;

  // The fight's average, weighting each slice by its length.
  let sum = 0;
  let ms = 0;
  acc.forEach((slices, pi) =>
    slices.forEach((a, si) => {
      if (a.weight === 0) return;
      const len = bounds[pi][si].endMs - bounds[pi][si].startMs;
      sum += (a.value / a.weight) * len;
      ms += len;
    }),
  );
  const avg = ms > 0 ? sum / ms : 0;

  return acc.map((slices, pi) =>
    slices.map((a, si) => {
      if (a.weight === 0 || avg <= 0) return { ...bounds[pi][si], ratio: null, top: null };
      const best = [...a.byName].sort((x, y) => y[1] - x[1])[0];
      return {
        ...bounds[pi][si],
        ratio: a.value / a.weight / avg,
        top: best && a.value > 0 ? { id: ids.get(best[0])!, name: best[0], share: Math.min(1, best[1] / a.value) } : null,
      };
    }),
  );
}

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

  // Kill weight that reached each phase, per pool of kills, so a phase only some kills saw isn't judged against all of them.
  const slots = assignSlots(kills);
  const pools = compPools(plan.comp, slots);
  const reached = new Map(pools.map(({ pool }) => [pool, phases.map(() => 0)]));
  const poolKills = new Map(pools.map(({ pool }) => [pool, 0]));
  for (const { kill, weight } of kills) {
    for (const { pool, has } of pools) {
      if (!has(kill)) continue;
      poolKills.set(pool, poolKills.get(pool)! + 1);
      for (const id of new Set([1, ...kill.phases.map((p) => p.id)])) {
        const i = phaseIndex.get(id);
        if (i !== undefined) reached.get(pool)![i] += weight;
      }
    }
  }
  const compCount = (spec: HealerSpec) => plan.comp.filter((s) => s === spec).length;

  // Row key -> phase -> slice -> kill key -> weight. A kill counts once per slice even if it pressed twice.
  const pressed = new Map<string, { spellId: number; slot: number; slices: Map<string, number>[][] }>();
  const spells = new Set(cooldownsForComp(plan.comp).map((c) => c.spellId));
  for (const { kill, weight } of kills) {
    const key = killKey(kill);
    for (const c of kill.casts) {
      if (!spells.has(c.spellId) || !pressedByItsSpec(c)) continue;
      const spec = COOLDOWN_BY_ID.get(c.spellId)?.spec ?? null;
      const slot = slots.of(kill, c);
      if (spec !== null && slot > compCount(spec)) continue;
      const { phaseId, tPhaseMs } = toPhaseTime(c.timestampMs, kill.phases);
      const pi = phaseIndex.get(phaseId);
      if (pi === undefined) continue;
      // Presses past the typical phase length land in its last slice.
      const si = Math.min(bounds[pi].length - 1, Math.floor(tPhaseMs / bucketMs));
      // Only a doubled spec numbers its rows, so a single Resto Druid keeps the plain "740" key.
      const rowKey = spec !== null && compCount(spec) > 1 ? `${c.spellId}#${slot}` : String(c.spellId);
      if (!pressed.has(rowKey)) pressed.set(rowKey, { spellId: c.spellId, slot, slices: bounds.map((b) => b.map(() => new Map())) });
      pressed.get(rowKey)!.slices[pi][si].set(key, weight);
    }
  }

  const reachedAll = reached.get("")!;
  const rowReach = new Map<string, number[]>();
  const rows: TimelineRow[] = [...pressed].map(([rowKey, { spellId, slot, slices: perPhase }]) => {
    const cd = COOLDOWN_BY_ID.get(spellId);
    const pool = poolOf(cd?.spec ?? null, slot);
    const weightIn = reached.get(pool) ?? reachedAll;
    rowReach.set(rowKey, weightIn);
    return {
      key: rowKey,
      spellId,
      spellName: cd?.name ?? `Spell ${spellId}`,
      spec: cd?.spec ?? null,
      slot,
      killCount: poolKills.get(pool) ?? kills.length,
      phases: perPhase.map((slices, pi) =>
        slices.map((_, si) => {
          const byKill = new Map<string, number>();
          for (let k = Math.max(0, si - reach); k <= Math.min(slices.length - 1, si + reach); k++) {
            for (const [key, weight] of slices[k]) byKill.set(key, weight);
          }
          const w = [...byKill.values()].reduce((a, b) => a + b, 0);
          const share = weightIn[pi] > 0 ? Math.min(1, w / weightIn[pi]) : 0;
          return share < floor ? { ...bounds[pi][si], share: 0, kills: 0 } : { ...bounds[pi][si], share, kills: byKill.size };
        }),
      ),
      common: plan.timings
        .filter((t) => t.spellId === spellId && t.slot === slot)
        .map((t) => ({ phaseId: t.phaseId, tPhaseMs: t.tPhaseMs })),
    };
  });

  // A Druid #2 row's share is of kills with two druids, so scale it back to all kills before adding it up.
  const all = bounds.map((slices, pi) =>
    slices.map((b, si) => ({
      ...b,
      perKill: rows.reduce((sum, r) => {
        const own = rowReach.get(r.key)![pi];
        return sum + (reachedAll[pi] > 0 ? (r.phases[pi][si].share * own) / reachedAll[pi] : 0);
      }, 0),
    })),
  );

  // One group per healer spec in comp order, one per player when the comp doubles a spec, then raid-wide cooldowns by the class that casts them.
  const groups = new Map<string, TimelineGroup & { order: number }>();
  for (const row of rows) {
    const className = COOLDOWN_BY_ID.get(row.spellId)?.className ?? "Other";
    const name = row.spec ? SPEC_LABEL[row.spec] : className;
    const wowClass = row.spec ? SPEC_CLASS[row.spec] : className;
    const count = row.spec ? compCount(row.spec) : 0;
    const slot = count > 1 ? row.slot : null;
    const label = slot === null ? name : `${name} #${slot}`;
    const order = (row.spec ? HEALER_SPECS.indexOf(row.spec) : HEALER_SPECS.length) * 10 + (slot ?? 0);
    const group = groups.get(label) ?? { label, name, slot, wowClass, count, rows: [], order };
    group.rows.push(row);
    groups.set(label, group);
  }

  return {
    phases,
    totalMs,
    bucketMs,
    killCount: kills.length,
    damage: damageSlices(kills, phaseIndex, bounds, bucketMs),
    groups: [...groups.values()]
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map(({ order: _, ...g }) => ({ ...g, rows: g.rows.sort((a, b) => a.spellName.localeCompare(b.spellName)) })),
    all,
  };
}
