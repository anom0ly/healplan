import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHT_OPTIONS, killTypeWeight, recencyWeight, weighKills } from "@/lib/engine/weighting";
import { kill, NOW } from "./fixtures";

const DAY = 86_400_000;
const opts = { ...DEFAULT_WEIGHT_OPTIONS, now: NOW };
const comp = kill().healers;

describe("weighting", () => {
  it("ranks first kills over farm kills", () => {
    expect(killTypeWeight(1)).toBeGreaterThan(killTypeWeight(2));
    expect(killTypeWeight(2)).toBeGreaterThan(killTypeWeight(5));
    expect(killTypeWeight(null)).toBe(killTypeWeight(5));
  });

  it("halves weight every half-life", () => {
    expect(recencyWeight(NOW - 14 * DAY, NOW, 14)).toBeCloseTo(0.5);
    expect(recencyWeight(NOW, NOW, 14)).toBe(1);
  });

  it("drops kills before the patch window and below the comp threshold", () => {
    const kills = [
      kill({ killDate: NOW - 30 * DAY }),
      kill({ healers: ["HolyPriest", "MistweaverMonk", "PreservationEvoker", "HolyPriest"] }),
      kill(),
    ];
    const out = weighKills(kills, comp, { ...opts, patchStart: NOW - 7 * DAY });
    expect(out.map((w) => w.kill.reportCode)).toEqual([kills[2].reportCode]);
  });

  it("filters to first kills when asked", () => {
    const out = weighKills([kill({ killIndex: 4 }), kill({ killIndex: 1 })], comp, { ...opts, firstKillsOnly: true });
    expect(out).toHaveLength(1);
    expect(out[0].kill.killIndex).toBe(1);
  });
});
