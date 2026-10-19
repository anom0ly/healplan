import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/engine/plan";
import { toNote } from "@/lib/engine/note";
import { assignSlots } from "@/lib/engine/slots";
import { buildTimeline } from "@/lib/engine/timeline";
import type { HealerSpec } from "@/lib/types";
import { cast, kill, NOW } from "./fixtures";

const TRANQ = 740;
const ONE_DRUID: HealerSpec[] = ["RestorationDruid", "HolyPaladin", "RestorationShaman"];
const TWO_DRUIDS: HealerSpec[] = ["RestorationDruid", "RestorationDruid", "HolyPaladin", "RestorationShaman"];

// Kills with one druid press Tranquility 10s into phase 2. Kills with two also press it a minute in.
const kills = [
  ...[1, 2, 3].map(() => kill({ healers: ONE_DRUID, casts: [cast(TRANQ, 130_000, "Solo")] })),
  kill({ healers: TWO_DRUIDS, casts: [cast(TRANQ, 60_000, "Early"), cast(TRANQ, 131_000, "Late")] }),
  kill({ healers: TWO_DRUIDS, casts: [cast(TRANQ, 129_000, "Bark"), cast(TRANQ, 62_000, "Leaf")] }),
];
const weighted = kills.map((k) => ({ kill: k, weight: 1, compSimilarity: 1 }));

describe("assignSlots", () => {
  it("makes the druid who matches single-druid kills #1 and the other #2", () => {
    const slots = assignSlots(weighted);
    const [early, late] = kills[3].casts;
    expect(slots.of(kills[3], late)).toBe(1);
    expect(slots.of(kills[3], early)).toBe(2);
    expect(slots.of(kills[4], kills[4].casts[0])).toBe(1);
    expect(slots.of(kills[4], kills[4].casts[1])).toBe(2);
    expect(slots.of(kills[0], kills[0].casts[0])).toBe(1);
  });

  it("counts players from the healer list and from who cast", () => {
    const slots = assignSlots(weighted);
    expect(slots.players(kills[0], "RestorationDruid")).toBe(1);
    expect(slots.players(kills[3], "RestorationDruid")).toBe(2);
  });
});

describe("a comp with two of a spec", () => {
  const plan = buildPlan(kills, TWO_DRUIDS, { weight: { now: NOW } });
  const t = buildTimeline(plan, 4_000, { floor: 0, nearMs: 0 });

  it("gives each druid a group, #1 before #2", () => {
    expect(t.groups.map((g) => g.label)).toEqual(["Resto Druid #1", "Resto Druid #2"]);
    expect(t.groups[1]).toMatchObject({ name: "Resto Druid", slot: 2, count: 2 });
  });

  it("judges #1 against every kill and #2 only against kills with two druids", () => {
    const [one, two] = t.groups.map((g) => g.rows[0]);
    expect(one).toMatchObject({ key: "740#1", slot: 1, killCount: 5 });
    expect(two).toMatchObject({ key: "740#2", slot: 2, killCount: 2 });
    // Every kill pressed #1's Tranquility 9–11s into phase 2; both two-druid kills pressed #2's a minute in.
    expect(one.phases[1][2].share).toBeCloseTo(1, 5);
    expect(one.phases[0][15].share).toBe(0);
    expect(two.phases[0][15]).toMatchObject({ share: expect.closeTo(1, 5), kills: 2 });
    expect(two.common).toEqual([{ phaseId: 1, tPhaseMs: 60_000 }]);
  });

  it("names the matching player in the note", () => {
    const roster = [
      { name: "Leafy", spec: "RestorationDruid" as const },
      { name: "Barky", spec: "RestorationDruid" as const },
    ];
    expect(toNote(plan.timings, roster)).toBe("{time:1:00} Barky Tranquility\n{time:0:10,p2} Leafy Tranquility");
  });
});

describe("a comp with one of a spec", () => {
  it("follows Druid #1 only", () => {
    const plan = buildPlan(kills, ONE_DRUID, { weight: { now: NOW, minCompSimilarity: 0 } });
    expect(plan.timings.filter((t) => t.spellId === TRANQ).map((t) => t.phaseId)).toEqual([2]);
    const t = buildTimeline(plan, 4_000, { floor: 0, nearMs: 0 });
    expect(t.groups.map((g) => g.label)).toEqual(["Resto Druid"]);
    expect(t.groups[0].rows.map((r) => r.key)).toEqual(["740"]);
  });
});
