import type { HealerSpec } from "@/lib/types";

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
