import { HEALER_SPECS, type Difficulty, type HealerSpec } from "./types";

export interface PlanRequest {
  encounterId: number;
  difficulty: Difficulty;
  comp: HealerSpec[];
  firstKillsOnly: boolean;
}

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Reads a plan request from query params: `encounter=3009&difficulty=mythic&RestorationDruid=2&HolyPaladin=1`.
 * Returns null when there's no boss or no healers yet.
 */
export function parsePlanRequest(params: Params): PlanRequest | null {
  const encounterId = Number(one(params.encounter));
  if (!Number.isInteger(encounterId) || encounterId <= 0) return null;
  const difficulty: Difficulty = one(params.difficulty) === "heroic" ? "heroic" : "mythic";
  const comp: HealerSpec[] = [];
  for (const spec of HEALER_SPECS) {
    const n = Math.min(6, Math.max(0, Math.floor(Number(one(params[spec]) ?? 0)) || 0));
    for (let i = 0; i < n; i++) comp.push(spec);
  }
  if (comp.length === 0) return null;
  return { encounterId, difficulty, comp, firstKillsOnly: one(params.firstKillsOnly) === "1" };
}
