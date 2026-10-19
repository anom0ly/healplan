import { HEALER_SPECS, type Difficulty, type HealerSpec } from "./types";

export interface PlanRequest {
  encounterId: number;
  difficulty: Difficulty;
  comp: HealerSpec[];
  firstKillsOnly: boolean;
  /** Any comp (`any=1`): `comp` holds the specs to show, each once, and every kill with a spec counts for it. */
  anyComp: boolean;
}

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Reads a plan request from query params: `encounter=3009&difficulty=mythic&RestorationDruid=2&HolyPaladin=1`.
 * With `any=1`, the healers are the specs to show, and none means all of them.
 * Returns null when there's no boss or no healers yet.
 */
export function parsePlanRequest(params: Params): PlanRequest | null {
  const encounterId = Number(one(params.encounter));
  if (!Number.isInteger(encounterId) || encounterId <= 0) return null;
  const difficulty: Difficulty = one(params.difficulty) === "heroic" ? "heroic" : "mythic";
  const firstKillsOnly = one(params.firstKillsOnly) === "1";
  if (one(params.any) === "1") {
    const shown = new Set(parseComp(params));
    const comp = shown.size > 0 ? HEALER_SPECS.filter((s) => shown.has(s)) : [...HEALER_SPECS];
    return { encounterId, difficulty, comp, firstKillsOnly, anyComp: true };
  }
  const comp = parseComp(params);
  if (comp.length === 0) return null;
  return { encounterId, difficulty, comp, firstKillsOnly, anyComp: false };
}

/** Reads the healers from query params (`RestorationDruid=2&HolyPaladin=1`), up to 6 of each spec. */
export function parseComp(params: Params): HealerSpec[] {
  const comp: HealerSpec[] = [];
  for (const spec of HEALER_SPECS) {
    const n = Math.min(6, Math.max(0, Math.floor(Number(one(params[spec]) ?? 0)) || 0));
    for (let i = 0; i < n; i++) comp.push(spec);
  }
  return comp;
}
