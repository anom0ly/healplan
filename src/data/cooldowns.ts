import type { HealerSpec } from "@/lib/types";

export type CooldownKind = "healing" | "damage-reduction" | "throughput" | "utility";

export interface Cooldown {
  spellId: number;
  name: string;
  /** null = usable by any class (raid-wide cooldowns from non-healers). */
  spec: HealerSpec | null;
  /** The class that casts a raid-wide cooldown, for grouping (healer cooldowns group by spec). */
  className?: string;
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
  { spellId: 472433, name: "Evangelism", spec: "DisciplinePriest", kind: "healing", baseCooldownSec: 90, verified: true },
  { spellId: 421453, name: "Ultimate Penitence", spec: "DisciplinePriest", kind: "healing", baseCooldownSec: 240, verified: true },
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
  { spellId: 374227, name: "Zephyr", spec: "PreservationEvoker", kind: "damage-reduction", baseCooldownSec: 120, verified: true },
  // Raid-wide cooldowns from other roles
  { spellId: 97462, name: "Rallying Cry", spec: null, className: "Warrior", kind: "damage-reduction", baseCooldownSec: 180, verified: true },
  { spellId: 51052, name: "Anti-Magic Zone", spec: null, className: "Death Knight", kind: "damage-reduction", baseCooldownSec: 120, verified: true },
  { spellId: 196718, name: "Darkness", spec: null, className: "Demon Hunter", kind: "damage-reduction", baseCooldownSec: 300, verified: true },
];

export const COOLDOWN_BY_ID = new Map(COOLDOWNS.map((c) => [c.spellId, c]));

/**
 * Whether a cast counts as its cooldown. A healer cooldown counts only when a player of that healer spec pressed it,
 * since Retribution Paladins also cast Avenging Wrath and every Evoker casts Zephyr.
 */
export const pressedByItsSpec = (c: { spellId: number; sourceSpec: HealerSpec | null }) => {
  const spec = COOLDOWN_BY_ID.get(c.spellId)?.spec ?? null;
  return spec === null || c.sourceSpec === spec;
};

export const cooldownsForComp = (comp: HealerSpec[], includeRaidWide = true) =>
  COOLDOWNS.filter((c) => (c.spec === null ? includeRaidWide : comp.includes(c.spec)));
