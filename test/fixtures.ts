import { COOLDOWN_BY_ID } from "@/data/cooldowns";
import type { CastEvent, HealerSpec, KillRecord } from "@/lib/types";

const DAY = 86_400_000;
export const NOW = Date.parse("2026-10-17T00:00:00Z");

let n = 0;
export function kill(over: Partial<KillRecord> & { casts?: CastEvent[] } = {}): KillRecord {
  n++;
  return {
    reportCode: `R${n}`,
    fightId: 1,
    encounterId: 100,
    difficulty: "mythic",
    guildId: n,
    guildName: `Guild ${n}`,
    killDate: NOW - DAY,
    durationMs: 300_000,
    healers: ["RestorationDruid", "HolyPaladin", "DisciplinePriest", "RestorationShaman"] as HealerSpec[],
    killIndex: 1,
    firstKillConfirmed: true,
    phases: [
      { id: 1, startMs: 0 },
      { id: 2, startMs: 120_000 },
    ],
    casts: [],
    ...over,
  };
}

/** A cast by a player of the cooldown's own spec, unless `sourceSpec` says otherwise. */
export const cast = (
  spellId: number,
  timestampMs: number,
  source = "Healer",
  sourceSpec: HealerSpec | null = COOLDOWN_BY_ID.get(spellId)?.spec ?? null,
): CastEvent => ({
  spellId,
  source,
  sourceSpec,
  timestampMs,
});
