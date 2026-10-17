import { describe, expect, it } from "vitest";
import { compSimilarity } from "@/lib/engine/comp";

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
