import { describe, expect, it } from "vitest";
import type { WclClient } from "@/lib/wcl/client";
import { fightRankings } from "@/lib/wcl/queries";

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
