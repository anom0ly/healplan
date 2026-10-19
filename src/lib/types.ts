export const HEALER_SPECS = [
  "RestorationDruid",
  "HolyPaladin",
  "DisciplinePriest",
  "HolyPriest",
  "RestorationShaman",
  "MistweaverMonk",
  "PreservationEvoker",
] as const;

export type HealerSpec = (typeof HEALER_SPECS)[number];

export type Difficulty = "mythic" | "heroic";

/** WCL difficulty ids. */
export const DIFFICULTY_ID: Record<Difficulty, number> = { heroic: 4, mythic: 5 };

export interface Phase {
  id: number;
  /** Milliseconds from pull. */
  startMs: number;
}

export interface CastEvent {
  spellId: number;
  /** Player name, used for note export. */
  source: string;
  sourceSpec: HealerSpec | null;
  /** Milliseconds from pull. */
  timestampMs: number;
}

export interface KillRecord {
  reportCode: string;
  fightId: number;
  encounterId: number;
  difficulty: Difficulty;
  guildId: number;
  guildName: string;
  /** Epoch ms of the pull. */
  killDate: number;
  durationMs: number;
  healers: HealerSpec[];
  /** 1 = the guild's first kill of this boss on this difficulty. null = unknown. */
  killIndex: number | null;
  /** False when the first kill wasn't public and the earliest public kill was used instead. */
  firstKillConfirmed: boolean;
  phases: Phase[];
  casts: CastEvent[];
  /** Damage the raid took over the fight. null = not fetched yet. */
  damage?: KillDamage | null;
}

/**
 * Damage the raid took, in slices of `bucketMs` from the pull. Amounts are only compared within one kill,
 * so their unit doesn't matter. Empty arrays mean Warcraft Logs had no damage for the fight.
 */
export interface KillDamage {
  bucketMs: number;
  /** All damage taken in each slice. */
  total: number[];
  /** The abilities that did the most damage in each slice, up to three, as [abilityId, amount]. */
  top: [number, number][][];
  /** Names of the abilities in `top`, by id. */
  names: Record<number, string>;
}

/** One pull of a boss in a report someone pasted, wipes included. */
export interface ReportPull {
  fightId: number;
  /** The pull's number among this boss's pulls in the report, from 1. */
  number: number;
  kill: boolean;
  durationMs: number;
  /** Boss health left when the pull ended, in percent; 0 on a kill. null when Warcraft Logs didn't say. */
  bossPercent: number | null;
  phases: Phase[];
  healers: { name: string; spec: HealerSpec }[];
  /** Cooldown presses by anyone in the raid. */
  casts: CastEvent[];
  damage: KillDamage | null;
}

export const killKey =(k: Pick<KillRecord, "reportCode" | "fightId">) => `${k.reportCode}#${k.fightId}`;

/** The class each healer spec belongs to, for class colors. */
export const SPEC_CLASS: Record<HealerSpec, string> = {
  RestorationDruid: "Druid",
  HolyPaladin: "Paladin",
  DisciplinePriest: "Priest",
  HolyPriest: "Priest",
  RestorationShaman: "Shaman",
  MistweaverMonk: "Monk",
  PreservationEvoker: "Evoker",
};

/** Short names for healer specs, as raiders say them. */
export const SPEC_LABEL: Record<HealerSpec, string> = {
  RestorationDruid: "Resto Druid",
  HolyPaladin: "Holy Paladin",
  DisciplinePriest: "Disc Priest",
  HolyPriest: "Holy Priest",
  RestorationShaman: "Resto Shaman",
  MistweaverMonk: "Mistweaver",
  PreservationEvoker: "Preservation",
};
