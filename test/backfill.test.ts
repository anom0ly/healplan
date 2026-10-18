import { describe, expect, it, vi } from "vitest";

const saved: { reportCode: string; total: number[] }[] = [];
vi.mock("@/lib/db", () => ({
  killsMissingDamage: async () => [
    { reportCode: "private", fightId: 1, encounterId: 1, difficulty: "mythic" },
    { reportCode: "flaky", fightId: 1, encounterId: 1, difficulty: "mythic" },
    { reportCode: "ok", fightId: 1, encounterId: 1, difficulty: "mythic" },
  ],
  saveDamage: async (reportCode: string, _fightId: number, d: { total: number[] }) => {
    saved.push({ reportCode, total: d.total });
  },
}));

const { backfillDamage } = await import("@/lib/crawl");
import type { WclClient } from "@/lib/wcl/client";

describe("backfillDamage", () => {
  it("stores no damage for reports that went private and leaves other failures to retry", async () => {
    const wcl = {
      rateLimit: async () => ({ limitPerHour: 3600, pointsSpentThisHour: 0, pointsResetIn: 0 }),
      query: async (q: string, v: { code: string }) => {
        if (v.code === "private") throw new Error("WCL query error: You do not have permission to view this report.");
        if (v.code === "flaky") throw new Error("WCL query failed: 502");
        if (q.includes("fights(")) return { reportData: { report: { startTime: 0, fights: [{ id: 1, kill: true, difficulty: 5, startTime: 0, endTime: 10_000, phaseTransitions: null }] } } };
        return { reportData: { report: { graph: { data: { series: [{ name: "Hit", guid: 9, pointStart: 0, pointInterval: 5_000, data: [1, 1] }] } } } } };
      },
    } as unknown as WclClient;
    const result = await backfillDamage(wcl, { limit: 10, reservePoints: 0, log: () => {} });
    expect(result).toEqual({ done: 1, stopped: false });
    expect(saved).toEqual([
      { reportCode: "private", total: [] },
      { reportCode: "ok", total: [5, 5] },
    ]);
  });
});
