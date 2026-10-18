import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/engine/plan";
import { buildTimeline, phaseLengths } from "@/lib/engine/timeline";
import { cast, kill, NOW } from "./fixtures";

const TRANQ = 740;

describe("phaseLengths", () => {
  it("takes the typical length of each phase, in fight order", () => {
    const kills = [
      kill({ durationMs: 300_000, phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 120_000 }] }),
      kill({ durationMs: 320_000, phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 140_000 }] }),
      kill({ durationMs: 280_000, phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 100_000 }] }),
    ];
    expect(phaseLengths(kills)).toEqual([
      { id: 1, lengthMs: 120_000 },
      { id: 2, lengthMs: 180_000 },
    ]);
  });

  it("treats a kill with no phase changes as one long phase 1", () => {
    expect(phaseLengths([kill({ durationMs: 200_000, phases: [] })])).toEqual([{ id: 1, lengthMs: 200_000 }]);
  });
});

describe("buildTimeline", () => {
  const kills = [
    kill({ durationMs: 300_000, casts: [cast(TRANQ, 130_000)] }),
    kill({ durationMs: 300_000, casts: [cast(TRANQ, 132_000)] }),
    kill({ durationMs: 300_000, casts: [cast(TRANQ, 128_000)] }),
  ];
  const raw = { floor: 0, nearMs: 0 };
  const timeline = buildTimeline(buildPlan(kills, kills[0].healers, { weight: { now: NOW } }), 4_000, raw);

  it("lays phases end to end across the fight", () => {
    expect(timeline.totalMs).toBe(300_000);
    expect(timeline.phases).toEqual([
      { id: 1, startMs: 0, lengthMs: 120_000, leftPct: 0, widthPct: 40 },
      { id: 2, startMs: 120_000, lengthMs: 180_000, leftPct: 40, widthPct: 60 },
    ]);
  });

  it("cuts each phase into slices and counts the share of kills pressing in each", () => {
    const row = timeline.groups.flatMap((g) => g.rows).find((r) => r.spellId === TRANQ)!;
    expect(row.spellName).toBe("Tranquility");
    expect(timeline.bucketMs).toBe(4_000);
    expect(row.phases.map((slices) => slices.length)).toEqual([30, 45]);
    // Presses 8s, 10s and 12s into phase 2: two land in the 8–12s slice, one in 12–16s.
    expect(row.phases[1][2]).toEqual({ startMs: 8_000, endMs: 12_000, share: expect.closeTo(2 / 3, 5), kills: 2 });
    expect(row.phases[1][3]).toMatchObject({ share: expect.closeTo(1 / 3, 5), kills: 1 });
    expect(row.phases[0].every((s) => s.share === 0)).toBe(true);
    expect(row.common).toEqual([{ phaseId: 2, tPhaseMs: 10_000 }]);
    expect(timeline.all[1][2].perKill).toBeCloseTo(2 / 3, 5);
  });

  it("counts a kill once per slice and judges a phase only against kills that reached it", () => {
    const kills = [
      kill({ casts: [cast(TRANQ, 1_000), cast(TRANQ, 2_000)] }),
      kill({ phases: [], casts: [cast(TRANQ, 1_500)] }),
      kill({ casts: [cast(TRANQ, 130_000)] }),
    ];
    const t = buildTimeline(buildPlan(kills, kills[0].healers, { weight: { now: NOW } }), 8_000, raw);
    const row = t.groups.flatMap((g) => g.rows).find((r) => r.spellId === TRANQ)!;
    expect(row.phases[0][0]).toMatchObject({ share: expect.closeTo(2 / 3, 5), kills: 2 });
    // Only two of the three kills reached phase 2, so one press there is half of them.
    expect(row.phases[1][1]).toMatchObject({ share: expect.closeTo(1 / 2, 5), kills: 1 });
  });

  it("counts presses near a slice toward it, so one spread-out press reads as one hot spot", () => {
    const t = buildTimeline(buildPlan(kills, kills[0].healers, { weight: { now: NOW } }), 4_000, { floor: 0, nearMs: 4_000 });
    const row = t.groups.flatMap((g) => g.rows).find((r) => r.spellId === TRANQ)!;
    // Presses at 8s, 10s and 12s into phase 2 all count toward the 8–12s slice and both slices beside it.
    expect(row.phases[1][1]).toMatchObject({ share: expect.closeTo(2 / 3, 5), kills: 2 });
    expect(row.phases[1][2]).toMatchObject({ share: expect.closeTo(1, 5), kills: 3 });
    expect(row.phases[1][3]).toMatchObject({ share: expect.closeTo(1, 5), kills: 3 });
  });

  it("leaves slices under the floor blank", () => {
    const many = [
      ...Array.from({ length: 9 }, () => kill({ casts: [cast(TRANQ, 130_000)] })),
      kill({ casts: [cast(TRANQ, 130_000), cast(TRANQ, 200_000)] }),
      ...Array.from({ length: 10 }, () => kill({ casts: [cast(TRANQ, 130_000)] })),
    ];
    const t = buildTimeline(buildPlan(many, many[0].healers, { weight: { now: NOW } }));
    const row = t.groups.flatMap((g) => g.rows).find((r) => r.spellId === TRANQ)!;
    // One kill in twenty (5%) pressed at 80s into phase 2: under the default 10% floor.
    expect(row.phases[1][20]).toEqual({ startMs: 80_000, endMs: 84_000, share: 0, kills: 0 });
    expect(row.phases[1][2].share).toBeCloseTo(1, 5);
  });

  it("groups cooldowns by the healer spec or class that casts them", () => {
    const AURA = 31821;
    const RALLY = 97462;
    const both = [1, 2, 3].map(() =>
      kill({ casts: [cast(TRANQ, 130_000, "Leafy"), cast(AURA, 30_000, "Shiny"), cast(RALLY, 200_000, "Shouty")] }),
    );
    const { groups } = buildTimeline(buildPlan(both, both[0].healers, { weight: { now: NOW } }));
    expect(groups.map((g) => g.label)).toEqual(["Resto Druid", "Holy Paladin", "Warrior"]);
    expect(groups[0]).toMatchObject({ count: 1, rows: [{ spellName: "Tranquility" }] });
    expect(groups[2]).toMatchObject({ count: 0, rows: [{ spellName: "Rallying Cry" }] });
  });
});
