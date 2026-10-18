import { describe, expect, it } from "vitest";
import type { WclClient } from "@/lib/wcl/client";
import { fightRankings, toKillDamage } from "@/lib/wcl/queries";

const clientReturning = (fightRankings: unknown) =>
  ({ query: async () => ({ worldData: { encounter: { fightRankings } } }) }) as unknown as WclClient;

describe("fightRankings", () => {
  it("maps ranking entries and skips ones without a public report", async () => {
    const wcl = clientReturning({
      hasMorePages: true,
      rankings: [
        { duration: 300_000, startTime: 1, guild: { id: 7, name: "Guild" }, report: { code: "abc", fightID: 3 } },
        { duration: 300_000, startTime: 2, guild: { id: 8, name: "Hidden" }, report: null },
      ],
    });
    expect(await fightRankings(wcl, 1, 5, 1, "progress")).toEqual({
      fights: [{ guildId: 7, guildName: "Guild", reportCode: "abc", fightId: 3, startTime: 1, durationMs: 300_000 }],
      hasMorePages: true,
      note: undefined,
    });
  });

  it("treats a page without rankings as the end of the list", async () => {
    const result = await fightRankings(clientReturning({ error: "Invalid page" }), 1, 5, 40, "progress");
    expect(result).toEqual({ fights: [], hasMorePages: false, note: "Invalid page" });
  });

  it("passes the region filter to the API", async () => {
    let variables: Record<string, unknown> = {};
    const wcl = {
      query: async (_q: string, v: Record<string, unknown>) => {
        variables = v;
        return { worldData: { encounter: { fightRankings: { hasMorePages: false, rankings: [] } } } };
      },
    } as unknown as WclClient;
    await fightRankings(wcl, 1, 5, 1, "progress", "EU");
    expect(variables).toMatchObject({ metric: "progress", region: "EU" });
    await fightRankings(wcl, 1, 5, 1, "speed");
    expect(variables.region).toBeNull();
  });
});

describe("toKillDamage", () => {
  const fight = { startTime: 10_000, endTime: 30_000 };

  it("spreads each point over the slices it covers and keeps the top abilities per slice", () => {
    const damage = toKillDamage(
      [
        { name: "Total", data: [999] },
        { name: "Big Hit", guid: 1, pointStart: 10_000, pointInterval: 10_000, data: [100, 0] },
        { name: "Dot", guid: 2, pointStart: 10_000, pointInterval: 10_000, data: [10, 10] },
        { name: "Tiny", guid: 3, pointStart: 10_000, pointInterval: 10_000, data: [1, 1] },
        { name: "Tinier", guid: 4, pointStart: 10_000, pointInterval: 10_000, data: [0.5, 0] },
      ],
      fight,
      5_000,
    );
    // A rate of 100/s over a 10s point puts 500 in each of the two 5s slices it covers.
    expect(damage.total).toEqual([558, 558, 55, 55]);
    expect(damage.top[0]).toEqual([[1, 500], [2, 50], [3, 5]]);
    expect(damage.top[3]).toEqual([[2, 50], [3, 5]]);
    expect(damage.names).toEqual({ 1: "Big Hit", 2: "Dot", 3: "Tiny" });
  });

  it("reads [timestamp, value] points", () => {
    const damage = toKillDamage([{ name: "Hit", guid: 7, pointInterval: 5_000, data: [[25_000, 2]] }], fight, 5_000);
    expect(damage.total).toEqual([0, 0, 0, 10]);
  });

  it("returns empty slices when the graph has no abilities", () => {
    expect(toKillDamage([], fight)).toEqual({ bucketMs: 5_000, total: [], top: [], names: {} });
  });
});
