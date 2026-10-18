import { describe, expect, it } from "vitest";
import { compSimilarity, matchCounts, summarizeComps, type CompSummary } from "@/lib/engine/comp";

describe("compSimilarity", () => {
  it("is 1 for identical comps regardless of order", () => {
    expect(compSimilarity(["HolyPaladin", "RestorationDruid"], ["RestorationDruid", "HolyPaladin"])).toBe(1);
  });

  it("counts duplicate specs", () => {
    // {Druid x2} vs {Druid x1}: 1 shared / 2 total
    expect(compSimilarity(["RestorationDruid", "RestorationDruid"], ["RestorationDruid"])).toBe(0.5);
  });

  it("is 0 with nothing shared", () => {
    expect(compSimilarity(["HolyPriest"], ["MistweaverMonk"])).toBe(0);
  });
});

describe("summarizeComps", () => {
  it("merges the same lineup saved in a different order and puts the most-used first", () => {
    const out = summarizeComps([
      { healers: ["HolyPaladin", "RestorationDruid"], kills: 2, firstKills: 1 },
      { healers: ["MistweaverMonk"], kills: 4, firstKills: 0 },
      { healers: ["RestorationDruid", "HolyPaladin"], kills: 3, firstKills: 2 },
    ]);
    expect(out).toEqual([
      { healers: ["RestorationDruid", "HolyPaladin"], kills: 5, firstKills: 3 },
      { healers: ["MistweaverMonk"], kills: 4, firstKills: 0 },
    ]);
  });
});

describe("matchCounts", () => {
  const comps: CompSummary[] = [
    { healers: ["RestorationDruid", "HolyPaladin", "DisciplinePriest", "RestorationShaman"], kills: 10, firstKills: 4 },
    { healers: ["RestorationDruid", "HolyPaladin", "DisciplinePriest", "MistweaverMonk"], kills: 6, firstKills: 1 },
    { healers: ["HolyPriest", "MistweaverMonk", "PreservationEvoker", "RestorationShaman"], kills: 9, firstKills: 3 },
  ];

  it("splits exact and close matches and leaves out the rest", () => {
    // 3 of 4 shared is 3/5 = 0.6, which the default weighting still keeps
    expect(matchCounts(["RestorationShaman", "DisciplinePriest", "HolyPaladin", "RestorationDruid"], comps, 0.6)).toEqual({
      exact: 10,
      close: 6,
      firstKills: 5,
    });
  });

  it("is empty with no healers picked", () => {
    expect(matchCounts([], comps, 0.6)).toEqual({ exact: 0, close: 0, firstKills: 0 });
  });
});
