import { COOLDOWN_BY_ID } from "@/data/cooldowns";
import { killKey, type CastEvent, type HealerSpec, type KillRecord } from "@/lib/types";
import { toPhaseTime } from "./cluster";
import type { WeightedKill } from "./weighting";

/** A press this close to a reference press of the same spell, in the same phase, counts as matching it. */
const MATCH_MS = 8_000;

const specOf = (c: CastEvent) => COOLDOWN_BY_ID.get(c.spellId)?.spec ?? null;

/** Numbers the players of each healer spec in a kill, so two Resto Druids become Druid #1 and Druid #2. */
export interface Slots {
  /** The cast's player number within its spec. 1 for raid-wide cooldowns and for a spec's only player. */
  of(kill: KillRecord, cast: CastEvent): number;
  /** Players of the spec in the kill: the larger of its healer list and the players seen pressing that spec's cooldowns. */
  players(kill: KillRecord, spec: HealerSpec): number;
}

/**
 * In kills with several players of a spec, #1 is the player whose presses land closest to where kills with
 * only one of that spec press, and the rest follow by how well they match. Each player keeps one number for
 * the whole kill. With no single-player kills to compare against, every kill's presses are the reference.
 */
export function assignSlots(kills: WeightedKill[]): Slots {
  const sources = new Map<string, Map<HealerSpec, string[]>>();
  for (const { kill } of kills) {
    const bySpec = new Map<HealerSpec, string[]>();
    for (const c of kill.casts) {
      const spec = specOf(c);
      if (!spec) continue;
      const list = bySpec.get(spec) ?? [];
      if (!list.includes(c.source)) list.push(c.source);
      bySpec.set(spec, list);
    }
    sources.set(killKey(kill), bySpec);
  }
  const players = (kill: KillRecord, spec: HealerSpec) =>
    Math.max(kill.healers.filter((s) => s === spec).length, sources.get(killKey(kill))?.get(spec)?.length ?? 0);

  const shared = new Set<HealerSpec>();
  for (const bySpec of sources.values()) for (const [spec, list] of bySpec) if (list.length > 1) shared.add(spec);

  const slot = new Map<string, number>();
  for (const spec of shared) {
    const single = kills.filter((k) => players(k.kill, spec) === 1);
    const ref = (single.length > 0 ? single : kills).flatMap(({ kill, weight }) =>
      kill.casts
        .filter((c) => specOf(c) === spec)
        .map((c) => ({ spellId: c.spellId, ...toPhaseTime(c.timestampMs, kill.phases), weight })),
    );

    for (const { kill } of kills) {
      const list = sources.get(killKey(kill))?.get(spec) ?? [];
      if (list.length < 2) continue;
      const ranked = list
        .map((source) => {
          const casts = kill.casts.filter((c) => c.source === source && specOf(c) === spec);
          let score = 0;
          for (const c of casts) {
            const { phaseId, tPhaseMs } = toPhaseTime(c.timestampMs, kill.phases);
            for (const r of ref) {
              if (r.spellId === c.spellId && r.phaseId === phaseId && Math.abs(r.tPhaseMs - tPhaseMs) <= MATCH_MS) score += r.weight;
            }
          }
          return { source, score, casts: casts.length };
        })
        .sort((a, b) => b.score - a.score || b.casts - a.casts || a.source.localeCompare(b.source));
      ranked.forEach((r, i) => slot.set(`${killKey(kill)}|${spec}|${r.source}`, i + 1));
    }
  }

  return {
    of: (kill, cast) => {
      const spec = specOf(cast);
      return spec ? (slot.get(`${killKey(kill)}|${spec}|${cast.source}`) ?? 1) : 1;
    },
    players,
  };
}

/** Which kills a cooldown row is judged against: all of them for #1 and raid-wide cooldowns, kills with at least N of the spec for #N. */
export const poolOf = (spec: HealerSpec | null, slot: number) => (spec && slot > 1 ? `${spec}#${slot}` : "");

/** Every pool a comp's rows use, with whether a kill belongs to it. */
export function compPools(comp: HealerSpec[], slots: Slots): { pool: string; has: (kill: KillRecord) => boolean }[] {
  const out: { pool: string; has: (kill: KillRecord) => boolean }[] = [{ pool: "", has: () => true }];
  for (const spec of new Set(comp)) {
    const count = comp.filter((s) => s === spec).length;
    for (let n = 2; n <= count; n++) out.push({ pool: poolOf(spec, n), has: (kill) => slots.players(kill, spec) >= n });
  }
  return out;
}
