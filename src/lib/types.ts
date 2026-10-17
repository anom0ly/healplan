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
}

export const killKey = (k: Pick<KillRecord, "reportCode" | "fightId">) => `${k.reportCode}#${k.fightId}`;
