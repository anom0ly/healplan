import { describe, expect, it } from "vitest";
import { toPhaseTime } from "@/lib/engine/cluster";
import { buildPlan } from "@/lib/engine/plan";
import { toNote } from "@/lib/engine/note";
import { cast, kill, NOW } from "./fixtures";

const TRANQ = 740;
const AURA = 31821;

describe("toPhaseTime", () => {
  it("measures from the start of the current phase", () => {
    const phases = [{ id: 1, startMs: 0 }, { id: 2, startMs: 120_000 }];
    expect(toPhaseTime(130_000, phases)).toEqual({ phaseId: 2, tPhaseMs: 10_000 });
    expect(toPhaseTime(5_000, [])).toEqual({ phaseId: 1, tPhaseMs: 5_000 });
  });
});

describe("buildPlan", () => {
  // Three kills agree on Tranquility ~10s into phase 2, even though phase 2 starts at different times.
  const kills = [
    kill({ phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 120_000 }], casts: [cast(TRANQ, 130_000), cast(AURA, 30_000)] }),
    kill({ phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 140_000 }], casts: [cast(TRANQ, 152_000)] }),
    kill({ phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 110_000 }], casts: [cast(TRANQ, 119_000)] }),
  ];
  const plan = buildPlan(kills, kills[0].healers, { weight: { now: NOW } });

  it("finds the consensus timing relative to phase start", () => {
    const tranq = plan.timings.find((t) => t.spellId === TRANQ)!;
    expect(tranq.phaseId).toBe(2);
    expect(tranq.tPhaseMs).toBeGreaterThanOrEqual(9_000);
    expect(tranq.tPhaseMs).toBeLessThanOrEqual(12_000);
    expect(tranq.killCount).toBe(3);
    expect(tranq.support).toBeCloseTo(1);
  });

  it("drops timings too few kills agree on", () => {
    // Aura Mastery appears in 1 of 3 equally weighted kills, under the 40% threshold.
    expect(plan.timings.find((t) => t.spellId === AURA)).toBeUndefined();
  });

  it("ignores spells the comp can't cast", () => {
    const noDruid = buildPlan(kills, ["HolyPaladin", "DisciplinePriest", "RestorationShaman", "HolyPaladin"], {
      weight: { now: NOW, minCompSimilarity: 0 },
    });
    expect(noDruid.timings.find((t) => t.spellId === TRANQ)).toBeUndefined();
  });

  it("exports an MRT-style note with names", () => {
    const note = toNote(plan.timings, [{ name: "Leafy", spec: "RestorationDruid" }]);
    expect(note).toMatch(/^\{time:0:1\d,p2\} Leafy Tranquility$/);
  });
});
