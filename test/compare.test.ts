import { describe, expect, it } from "vitest";
import { comparePulls } from "@/lib/engine/compare";
import type { PlannedTiming } from "@/lib/engine/plan";
import type { HealerSpec, ReportPull } from "@/lib/types";
import { cast } from "./fixtures";

const timing = (spellId: number, spec: HealerSpec | null, phaseId: number, tPhaseMs: number, slot = 1): PlannedTiming => ({
  spellId,
  spellName: `Spell ${spellId}`,
  spec,
  slot,
  phaseId,
  tPhaseMs,
  earliestMs: tPhaseMs,
  latestMs: tPhaseMs,
  support: 1,
  killCount: 1,
  killKeys: [],
});

let fight = 0;
const pull = (over: Partial<ReportPull> = {}): ReportPull => ({
  fightId: ++fight,
  number: fight,
  kill: false,
  durationMs: 300_000,
  bossPercent: 40,
  phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 120_000 }],
  healers: [
    { name: "Leafy", spec: "RestorationDruid" },
    { name: "Totem", spec: "RestorationShaman" },
  ],
  casts: [],
  damage: null,
  ...over,
});

const comp: HealerSpec[] = ["RestorationDruid", "RestorationShaman"];
const TRANQ = 740;
const HTT = 108280;
const RALLY = 97462;

describe("comparePulls", () => {
  it("judges presses on time, early, late and missed, measured from the phase start", () => {
    const plan = [timing(TRANQ, "RestorationDruid", 1, 60_000), timing(TRANQ, "RestorationDruid", 2, 40_000), timing(HTT, "RestorationShaman", 2, 10_000)];
    // Phase 2 came 10 seconds late in this pull, so its planned times move with it.
    const p = pull({
      phases: [{ id: 1, startMs: 0 }, { id: 2, startMs: 130_000 }],
      casts: [cast(TRANQ, 63_000, "Leafy"), cast(TRANQ, 182_000, "Leafy")],
    });
    const { lines, pulls } = comparePulls(plan, comp, [p]);
    expect(lines.map((l) => [l.spellId, l.phaseId, l.player])).toEqual([
      [TRANQ, 1, "Leafy"],
      [HTT, 2, "Totem"],
      [TRANQ, 2, "Leafy"],
    ]);
    const [m1, m2, m3] = pulls[0].marks;
    expect(m1).toMatchObject({ verdict: "on", plannedMs: 60_000, deltaMs: 3_000 });
    expect(m2).toMatchObject({ verdict: "missed", plannedMs: 140_000 });
    expect(m3).toMatchObject({ verdict: "late", plannedMs: 170_000, pressedMs: 182_000, deltaMs: 12_000 });
    expect(pulls[0]).toMatchObject({ onTime: 1, judged: 3 });
  });

  it("doesn't judge presses the pull never got to, and counts unplanned presses", () => {
    const plan = [timing(TRANQ, "RestorationDruid", 1, 60_000), timing(TRANQ, "RestorationDruid", 2, 40_000), timing(HTT, "RestorationShaman", 1, 100_000)];
    const p = pull({ durationMs: 102_000, phases: [{ id: 1, startMs: 0 }], casts: [cast(TRANQ, 52_000, "Leafy"), cast(HTT, 20_000, "Totem")] });
    const r = comparePulls(plan, comp, [p]).pulls[0];
    expect(r.marks.map((m) => m.verdict)).toEqual(["early", "unreached", "unreached"]);
    expect(r.marks[0].deltaMs).toBe(-8_000);
    expect(r.extras).toEqual([{ spellId: HTT, spec: "RestorationShaman", slot: 1, pressedMs: 20_000 }]);
    expect(r.judged).toBe(1);
  });

  it("gives each doubled-spec slot to the player whose presses fit it, the same across pulls", () => {
    const plan = [timing(TRANQ, "RestorationDruid", 1, 30_000, 1), timing(TRANQ, "RestorationDruid", 1, 90_000, 2)];
    const healers = [
      { name: "Bark", spec: "RestorationDruid" as const },
      { name: "Leafy", spec: "RestorationDruid" as const },
    ];
    const pulls = [
      pull({ healers, casts: [cast(TRANQ, 31_000, "Leafy"), cast(TRANQ, 89_000, "Bark")] }),
      pull({ healers, casts: [cast(TRANQ, 29_000, "Leafy"), cast(TRANQ, 75_000, "Bark")] }),
    ];
    const r = comparePulls(plan, ["RestorationDruid", "RestorationDruid"], pulls);
    expect(r.lines.map((l) => [l.group, l.player])).toEqual([
      ["Resto Druid #1", "Leafy"],
      ["Resto Druid #2", "Bark"],
    ]);
    expect(r.pulls[1].marks.map((m) => m.verdict)).toEqual(["on", "early"]);
  });

  it("leaves raid-wide cooldowns out", () => {
    const r = comparePulls([timing(RALLY, null, 1, 30_000)], comp, [pull()]);
    expect(r.lines).toEqual([]);
  });
});
