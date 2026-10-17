import { COOLDOWN_BY_ID, cooldownsForComp } from "@/data/cooldowns";
import { killKey, type HealerSpec, type KillRecord } from "@/lib/types";
import { clusterCasts, toPhaseTime, DEFAULT_CLUSTER_OPTIONS, type ClusterOptions, type WeightedCast } from "./cluster";
import { weighKills, DEFAULT_WEIGHT_OPTIONS, type WeightOptions, type WeightedKill } from "./weighting";

export interface PlannedTiming {
  spellId: number;
  spellName: string;
  spec: HealerSpec | null;
  phaseId: number;
  tPhaseMs: number;
  earliestMs: number;
  latestMs: number;
  support: number;
  killCount: number;
  killKeys: string[];
}

export interface Plan {
  comp: HealerSpec[];
  timings: PlannedTiming[];
  killsUsed: WeightedKill[];
  /** Observed median recast time per spell, in seconds, when kills recast sooner than the base cooldown. */
  observedCooldownSec: Record<number, number>;
}

export interface PlanOptions {
  weight?: Partial<WeightOptions> & { now: number };
  cluster?: Partial<ClusterOptions>;
  includeRaidWide?: boolean;
}

/** Builds the consensus cooldown timeline for one boss and difficulty from pre-filtered kills. */
export function buildPlan(kills: KillRecord[], comp: HealerSpec[], opts: PlanOptions): Plan {
  const weightOpts: WeightOptions = { ...DEFAULT_WEIGHT_OPTIONS, now: Date.now(), ...opts.weight };
  const clusterOpts: ClusterOptions = { ...DEFAULT_CLUSTER_OPTIONS, ...opts.cluster };
  const spells = new Set(cooldownsForComp(comp, opts.includeRaidWide ?? true).map((c) => c.spellId));

  const weighted = weighKills(kills, comp, weightOpts);

  const phaseWeight = new Map<number, number>();
  const casts: WeightedCast[] = [];
  const recasts = new Map<number, number[]>();

  for (const { kill, weight } of weighted) {
    const key = killKey(kill);
    const phaseIds = new Set([1, ...kill.phases.map((p) => p.id)]);
    for (const id of phaseIds) phaseWeight.set(id, (phaseWeight.get(id) ?? 0) + weight);

    const lastBySource = new Map<string, number>();
    for (const c of [...kill.casts].sort((a, b) => a.timestampMs - b.timestampMs)) {
      if (!spells.has(c.spellId)) continue;
      casts.push({ spellId: c.spellId, ...toPhaseTime(c.timestampMs, kill.phases), killKey: key, weight });
      const srcKey = `${c.source}:${c.spellId}`;
      const prev = lastBySource.get(srcKey);
      if (prev !== undefined) {
        const gaps = recasts.get(c.spellId) ?? [];
        gaps.push((c.timestampMs - prev) / 1000);
        recasts.set(c.spellId, gaps);
      }
      lastBySource.set(srcKey, c.timestampMs);
    }
  }

  const observedCooldownSec: Record<number, number> = {};
  for (const [spellId, gaps] of recasts) {
    const base = COOLDOWN_BY_ID.get(spellId)?.baseCooldownSec;
    const shortest = Math.min(...gaps);
    if (base !== undefined && gaps.length >= 3 && shortest < base) observedCooldownSec[spellId] = Math.round(shortest);
  }

  const timings = clusterCasts(casts, phaseWeight, clusterOpts).map((c) => {
    const cd = COOLDOWN_BY_ID.get(c.spellId);
    return {
      ...c,
      spellName: cd?.name ?? `Spell ${c.spellId}`,
      spec: cd?.spec ?? null,
      killCount: c.killKeys.length,
    };
  });

  return { comp, timings, killsUsed: weighted, observedCooldownSec };
}
