import type { HealerSpec, KillRecord } from "@/lib/types";
import { compSimilarity } from "./comp";

export interface WeightOptions {
  /** Epoch ms treated as "now" for recency. */
  now: number;
  halfLifeDays: number;
  /** Kills before this epoch ms (last hotfix or nerf) are dropped. */
  patchStart?: number;
  /** Kills with comp similarity below this are dropped. */
  minCompSimilarity: number;
  /** Allowed deviation from the median kill length before a kill is down-weighted. */
  durationTolerance: number;
  /** Only use guild first kills. */
  firstKillsOnly: boolean;
  /** Any comp: every kill with at least one of the comp's specs counts in full, whoever else healed. */
  anyComp: boolean;
}

export const DEFAULT_WEIGHT_OPTIONS: Omit<WeightOptions, "now"> = {
  halfLifeDays: 14,
  minCompSimilarity: 0.6,
  durationTolerance: 0.2,
  firstKillsOnly: false,
  anyComp: false,
};

const DAY_MS = 86_400_000;

export function killTypeWeight(killIndex: number | null): number {
  if (killIndex === 1) return 1;
  if (killIndex === 2 || killIndex === 3) return 0.6;
  return 0.25;
}

export function recencyWeight(killDate: number, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, now - killDate) / DAY_MS;
  return 0.5 ** (ageDays / halfLifeDays);
}

export function durationWeight(durationMs: number, medianMs: number, tolerance: number): number {
  if (medianMs <= 0) return 1;
  return Math.abs(durationMs - medianMs) / medianMs <= tolerance ? 1 : 0.5;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface WeightedKill {
  kill: KillRecord;
  weight: number;
  compSimilarity: number;
}

/** Scores every kill against the comp and filters. Kills with weight 0 are dropped. */
export function weighKills(kills: KillRecord[], comp: HealerSpec[], opts: WeightOptions): WeightedKill[] {
  const eligible = kills.filter(
    (k) =>
      (opts.patchStart === undefined || k.killDate >= opts.patchStart) &&
      (!opts.firstKillsOnly || k.killIndex === 1),
  );
  const med = median(eligible.map((k) => k.durationMs));
  const out: WeightedKill[] = [];
  for (const kill of eligible) {
    const sim = opts.anyComp ? (comp.some((s) => kill.healers.includes(s)) ? 1 : 0) : compSimilarity(comp, kill.healers);
    if (sim < opts.minCompSimilarity) continue;
    const weight =
      sim *
      killTypeWeight(kill.killIndex) *
      recencyWeight(kill.killDate, opts.now, opts.halfLifeDays) *
      durationWeight(kill.durationMs, med, opts.durationTolerance);
    if (weight > 0) out.push({ kill, weight, compSimilarity: sim });
  }
  return out.sort((a, b) => b.weight - a.weight);
}
