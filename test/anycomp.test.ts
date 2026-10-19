import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/engine/plan";
import { compShifts } from "@/lib/engine/shift";
import { buildTimeline, hideSpecs } from "@/lib/engine/timeline";
import { DEFAULT_WEIGHT_OPTIONS, weighKills } from "@/lib/engine/weighting";
import { parsePlanRequest } from "@/lib/request";
import { HEALER_SPECS, type HealerSpec } from "@/lib/types";
import { cast, kill, NOW } from "./fixtures";

const AURA = 31821;
const HYMN = 64843;
const raw = { floor: 0, nearMs: 0 };
const withDisc: HealerSpec[] = ["HolyPaladin", "HolyPriest", "DisciplinePriest", "RestorationDruid"];
const noDisc: HealerSpec[] = ["HolyPaladin", "HolyPriest", "MistweaverMonk", "PreservationEvoker"];
const noPriest: HealerSpec[] = ["HolyPaladin", "RestorationShaman", "MistweaverMonk", "PreservationEvoker"];

// Aura Mastery 40s in every comp; Divine Hymn 95s with a Disc Priest and 40s without.
const kills = [
  ...Array.from({ length: 2 }, () => kill({ healers: withDisc, casts: [cast(AURA, 40_000), cast(HYMN, 95_000)] })),
  ...Array.from({ length: 3 }, () => kill({ healers: noDisc, casts: [cast(AURA, 40_000), cast(HYMN, 40_000)] })),
  ...Array.from({ length: 3 }, () => kill({ healers: noPriest, casts: [cast(AURA, 40_000)] })),
];
const opts = { weight: { now: NOW } };

describe("any comp", () => {
  it("counts every kill with one of the specs in full, whoever else healed", () => {
    const out = weighKills(kills, ["HolyPriest"], { ...DEFAULT_WEIGHT_OPTIONS, now: NOW, anyComp: true });
    expect(out).toHaveLength(5);
    expect(new Set(out.map((w) => w.compSimilarity))).toEqual(new Set([1]));
  });

  it("judges each spec's cooldowns against the kills that had that spec", () => {
    const t = buildTimeline(buildPlan(kills, [...HEALER_SPECS], { ...opts, anyComp: true }), 4_000, raw);
    const rows = t.groups.flatMap((g) => g.rows);
    const hymn = rows.find((r) => r.spellId === HYMN)!;
    const aura = rows.find((r) => r.spellId === AURA)!;
    expect(t.killCount).toBe(8);
    expect(hymn.killCount).toBe(5);
    // 40–44s: three of the five Holy Priest kills pressed Hymn there.
    expect(hymn.phases[0][10].share).toBeCloseTo(3 / 5, 5);
    expect(aura.killCount).toBe(8);
    expect(aura.phases[0][10].share).toBeCloseTo(1, 5);
    // Hymn's share is of Holy Priest kills, so it counts 5 of 8 kills toward all cooldowns.
    expect(t.all[0][10].perKill).toBeCloseTo(1 + (3 / 5) * (5 / 8), 5);
  });

  it("leaves hidden specs out and adds the all-cooldowns row up again without them", () => {
    const t = buildTimeline(buildPlan(kills, [...HEALER_SPECS], { ...opts, anyComp: true }), 4_000, raw);
    const shown = hideSpecs(t, ["HolyPriest"]);
    expect(shown.groups.map((g) => g.spec)).not.toContain("HolyPriest");
    expect(shown.groups.map((g) => g.spec)).toContain("HolyPaladin");
    expect(shown.all[0][10].perKill).toBeCloseTo(1, 5);
    expect(hideSpecs(t, [])).toBe(t);
  });

  it("reads any=1 with the specs to show, and none meaning all of them", () => {
    expect(parsePlanRequest({ encounter: "1", any: "1", HolyPriest: "1", HolyPaladin: "2" })).toMatchObject({
      anyComp: true,
      comp: ["HolyPaladin", "HolyPriest"],
    });
    expect(parsePlanRequest({ encounter: "1", any: "1" })?.comp).toEqual([...HEALER_SPECS]);
    expect(parsePlanRequest({ encounter: "1", HolyPriest: "1" })?.anyComp).toBe(false);
  });
});

describe("compShifts", () => {
  const plan = (comp: HealerSpec[]) => buildPlan(kills, comp, opts);
  const every = (comp: HealerSpec[]) => buildPlan(kills, [...new Set(comp)], { ...opts, anyComp: true });

  it("flags a cooldown the comp presses somewhere else than every comp", () => {
    const shifts = compShifts(plan(withDisc), every(withDisc));
    expect([...shifts.keys()]).toEqual([HYMN]);
    expect(shifts.get(HYMN)).toEqual({ yours: [{ phaseId: 1, tPhaseMs: 95_000 }], every: [{ phaseId: 1, tPhaseMs: 40_000 }] });
  });

  it("leaves cooldowns alone when the comp presses them where everyone does", () => {
    expect(compShifts(plan(noDisc), every(noDisc)).size).toBe(0);
  });

  it("puts the flag on the cooldown's heat map row", () => {
    const t = buildTimeline(plan(withDisc), 4_000, raw, compShifts(plan(withDisc), every(withDisc)));
    const rows = t.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.spellId === HYMN)!.shift?.every).toEqual([{ phaseId: 1, tPhaseMs: 40_000 }]);
    expect(rows.find((r) => r.spellId === AURA)!.shift).toBeNull();
  });
});
