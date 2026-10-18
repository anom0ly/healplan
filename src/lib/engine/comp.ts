import { HEALER_SPECS, type HealerSpec } from "@/lib/types";

const counts = (specs: HealerSpec[]) => {
  const m = new Map<HealerSpec, number>();
  for (const s of specs) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
};

/**
 * Multiset Jaccard similarity of two healer lineups, in [0, 1].
 * Two Resto Druids vs one counts as a partial match, not a full one.
 */
export function compSimilarity(a: HealerSpec[], b: HealerSpec[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const ca = counts(a);
  const cb = counts(b);
  let inter = 0;
  let union = 0;
  for (const spec of new Set([...ca.keys(), ...cb.keys()])) {
    const x = ca.get(spec) ?? 0;
    const y = cb.get(spec) ?? 0;
    inter += Math.min(x, y);
    union += Math.max(x, y);
  }
  return inter / union;
}

/** How many stored kills on one boss used a healer lineup. */
export interface CompSummary {
  /** Sorted in HEALER_SPECS order. */
  healers: HealerSpec[];
  kills: number;
  firstKills: number;
}

const specOrder = (s: HealerSpec) => HEALER_SPECS.indexOf(s);
export const sortComp = (comp: HealerSpec[]) => [...comp].sort((a, b) => specOrder(a) - specOrder(b));

/** Merges lineups saved in a different order and sorts the most-used first. */
export function summarizeComps(rows: CompSummary[]): CompSummary[] {
  const byKey = new Map<string, CompSummary>();
  for (const r of rows) {
    const healers = sortComp(r.healers);
    const key = healers.join();
    const prev = byKey.get(key);
    byKey.set(key, { healers, kills: (prev?.kills ?? 0) + r.kills, firstKills: (prev?.firstKills ?? 0) + r.firstKills });
  }
  return [...byKey.values()].sort((a, b) => b.kills - a.kills || b.firstKills - a.firstKills);
}

/** Stored kills an exact or close comp match would draw from, as the plan's weighting counts them. */
export function matchCounts(comp: HealerSpec[], comps: CompSummary[], minSimilarity: number) {
  const out = { exact: 0, close: 0, firstKills: 0 };
  if (comp.length === 0) return out;
  for (const c of comps) {
    const sim = compSimilarity(comp, c.healers);
    if (sim < minSimilarity) continue;
    if (sim === 1) out.exact += c.kills;
    else out.close += c.kills;
    out.firstKills += c.firstKills;
  }
  return out;
}
