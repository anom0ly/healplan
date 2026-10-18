import type { HealerSpec } from "@/lib/types";

export type CooldownKind = "healing" | "damage-reduction" | "throughput" | "utility";

export interface Cooldown {
  spellId: number;
  name: string;
  /** null = usable by any class (raid-wide cooldowns from non-healers). */
  spec: HealerSpec | null;
  kind: CooldownKind;
  /** Base cooldown in seconds before talents. The engine prefers the observed recast time. */
  baseCooldownSec: number;
  /**
   * Spell ids and cooldowns change between patches. Set to true once checked
   * against cast events in a current-tier log: /api/cooldowns shows how often each id
   * appears in crawled kills, and `npm run spells` lists what healers actually cast.
   */
  verified: boolean;
}

export const COOLDOWNS: Cooldown[] = [
  // Restoration Druid
  { spellId: 740, name: "Tranquility", spec: "RestorationDruid", kind: "healing", baseCooldownSec: 180, verified: true },
  { spellId: 33891, name: "Incarnation: Tree of Life", spec: "RestorationDruid", kind: "throughput", baseCooldownSec: 180, verified: true },
  { spellId: 391528, name: "Convoke the Spirits", spec: "RestorationDruid", kind: "throughput", baseCooldownSec: 120, verified: true },
  // Holy Paladin
  { spellId: 31821, name: "Aura Mastery", spec: "HolyPaladin", kind: "damage-reduction", baseCooldownSec: 180, verified: true },
  { spellId: 31884, name: "Avenging Wrath", spec: "HolyPaladin", kind: "throughput", baseCooldownSec: 120, verified: true },
  // Discipline Priest
  { spellId: 62618, name: "Power Word: Barrier", spec: "DisciplinePriest", kind: "damage-reduction", baseCooldownSec: 180, verified: true },
  { spellId: 246287, name: "Evangelism", spec: "DisciplinePriest", kind: "healing", baseCooldownSec: 90, verified: false },
  { spellId: 47536, name: "Rapture", spec: "DisciplinePriest", kind: "healing", baseCooldownSec: 90, verified: false },
  // Holy Priest
  { spellId: 64843, name: "Divine Hymn", spec: "HolyPriest", kind: "healing", baseCooldownSec: 180, verified: true },
  { spellId: 200183, name: "Apotheosis", spec: "HolyPriest", kind: "throughput", baseCooldownSec: 120, verified: true },
  // Restoration Shaman
  { spellId: 98008, name: "Spirit Link Totem", spec: "RestorationShaman", kind: "damage-reduction", baseCooldownSec: 180, verified: true },
  { spellId: 108280, name: "Healing Tide Totem", spec: "RestorationShaman", kind: "healing", baseCooldownSec: 180, verified: true },
  { spellId: 114052, name: "Ascendance", spec: "RestorationShaman", kind: "throughput", baseCooldownSec: 180, verified: true },
  // Mistweaver Monk
  { spellId: 115310, name: "Revival", spec: "MistweaverMonk", kind: "healing", baseCooldownSec: 180, verified: true },
  { spellId: 388615, name: "Restoral", spec: "MistweaverMonk", kind: "healing", baseCooldownSec: 180, verified: true },
  { spellId: 322118, name: "Invoke Yu'lon, the Jade Serpent", spec: "MistweaverMonk", kind: "throughput", baseCooldownSec: 120, verified: true },
  { spellId: 325197, name: "Invoke Chi-Ji, the Red Crane", spec: "MistweaverMonk", kind: "throughput", baseCooldownSec: 120, verified: true },
  // Preservation Evoker
  { spellId: 363534, name: "Rewind", spec: "PreservationEvoker", kind: "healing", baseCooldownSec: 240, verified: true },
  { spellId: 359816, name: "Dream Flight", spec: "PreservationEvoker", kind: "healing", baseCooldownSec: 120, verified: true },
  { spellId: 370960, name: "Emerald Communion", spec: "PreservationEvoker", kind: "healing", baseCooldownSec: 180, verified: false },
  { spellId: 374227, name: "Zephyr", spec: "PreservationEvoker", kind: "damage-reduction", baseCooldownSec: 120, verified: true },
  // Raid-wide cooldowns from other roles
  { spellId: 97462, name: "Rallying Cry", spec: null, kind: "damage-reduction", baseCooldownSec: 180, verified: true },
  { spellId: 51052, name: "Anti-Magic Zone", spec: null, kind: "damage-reduction", baseCooldownSec: 120, verified: true },
  { spellId: 196718, name: "Darkness", spec: null, kind: "damage-reduction", baseCooldownSec: 300, verified: true },
];

export const COOLDOWN_BY_ID = new Map(COOLDOWNS.map((c) => [c.spellId, c]));

export const cooldownsForComp = (comp: HealerSpec[], includeRaidWide = true) =>
  COOLDOWNS.filter((c) => (c.spec === null ? includeRaidWide : comp.includes(c.spec)));
