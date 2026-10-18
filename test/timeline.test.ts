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
  const timeline = buildTimeline(buildPlan(kills, kills[0].healers, { weight: { now: NOW } }));

  it("lays phases end to end across the fight", () => {
    expect(timeline.totalMs).toBe(300_000);
    expect(timeline.phases).toEqual([
      { id: 1, leftPct: 0, widthPct: 40, lengthMs: 120_000 },
      { id: 2, leftPct: 40, widthPct: 60, lengthMs: 180_000 },
    ]);
  });

  it("places each cooldown press at its fight position, with its spread around it", () => {
    const row = timeline.groups.flatMap((g) => g.rows).find((r) => r.spellId === TRANQ)!;
    expect(row.spellName).toBe("Tranquility");
    expect(row.marks).toHaveLength(1);
    const [mark] = row.marks;
    expect(mark.phaseId).toBe(2);
    expect(mark.atPct).toBeCloseTo(43.3, 0); // 130s of a 300s fight
    expect(mark.fromPct).toBeLessThanOrEqual(mark.atPct);
    expect(mark.toPct).toBeGreaterThanOrEqual(mark.atPct);
    expect(mark.killCount).toBe(3);
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
