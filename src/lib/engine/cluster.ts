import type { Phase } from "@/lib/types";

/** Converts a pull-relative timestamp to (phase, ms since that phase started). */
export function toPhaseTime(timestampMs: number, phases: Phase[]): { phaseId: number; tPhaseMs: number } {
  let current: Phase = { id: 1, startMs: 0 };
  for (const p of [...phases].sort((a, b) => a.startMs - b.startMs)) {
    if (p.startMs <= timestampMs) current = p;
  }
  return { phaseId: current.id, tPhaseMs: timestampMs - current.startMs };
}

export interface WeightedCast {
  spellId: number;
  phaseId: number;
  tPhaseMs: number;
  killKey: string;
  weight: number;
}

export interface Cluster {
  spellId: number;
  phaseId: number;
  /** Weighted median of the casts in the cluster. */
  tPhaseMs: number;
  earliestMs: number;
  latestMs: number;
  /** Share of the total kill weight that cast this spell here, in [0, 1]. */
  support: number;
  killKeys: string[];
}

export interface ClusterOptions {
  /** Casts closer than this to the previous cast in the group join it. */
  windowMs: number;
  minSupport: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = { windowMs: 8_000, minSupport: 0.4 };

function weightedMedian(items: { t: number; w: number }[]): number {
  const s = [...items].sort((a, b) => a.t - b.t);
  const total = s.reduce((acc, x) => acc + x.w, 0);
  let run = 0;
  for (const x of s) {
    run += x.w;
    if (run >= total / 2) return x.t;
  }
  return s[s.length - 1].t;
}

/**
 * Groups casts of the same spell in the same phase by time gaps, then keeps
 * groups that enough of the (weighted) kills agree on.
 *
 * `phaseWeight` maps phase id to the total weight of kills that reached that
 * phase, so a phase only some kills saw isn't judged against all of them.
 */
export function clusterCasts(
  casts: WeightedCast[],
  phaseWeight: Map<number, number>,
  opts: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): Cluster[] {
  const groups = new Map<string, WeightedCast[]>();
  for (const c of casts) {
    const key = `${c.spellId}:${c.phaseId}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }

  const out: Cluster[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.tPhaseMs - b.tPhaseMs);
    let run: WeightedCast[] = [];
    const flush = () => {
      if (run.length === 0) return;
      // A kill counts once per cluster even if it double-cast inside the window.
      const perKill = new Map<string, number>();
      for (const c of run) perKill.set(c.killKey, Math.max(perKill.get(c.killKey) ?? 0, c.weight));
      const supported = [...perKill.values()].reduce((a, b) => a + b, 0);
      const total = phaseWeight.get(run[0].phaseId) ?? 0;
      const support = total > 0 ? Math.min(1, supported / total) : 0;
      if (support >= opts.minSupport) {
        out.push({
          spellId: run[0].spellId,
          phaseId: run[0].phaseId,
          tPhaseMs: weightedMedian(run.map((c) => ({ t: c.tPhaseMs, w: c.weight }))),
          earliestMs: run[0].tPhaseMs,
          latestMs: run[run.length - 1].tPhaseMs,
          support,
          killKeys: [...perKill.keys()],
        });
      }
      run = [];
    };
    for (const c of group) {
      if (run.length > 0 && c.tPhaseMs - run[run.length - 1].tPhaseMs > opts.windowMs) flush();
      run.push(c);
    }
    flush();
  }
  return out.sort((a, b) => a.phaseId - b.phaseId || a.tPhaseMs - b.tPhaseMs);
}
