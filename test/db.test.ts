import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cast, kill } from "./fixtures";

// Runs only against a throwaway database: TEST_DATABASE_URL=postgres://... npm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("db round trip", () => {
  let mod: typeof import("@/lib/db");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    mod = await import("@/lib/db");
    await mod.migrate();
    await mod.db().query("TRUNCATE kills, casts, guild_kill_history");
  });

  afterAll(async () => {
    await mod?.db().end();
  });

  it("saves and loads kills with their casts", async () => {
    const k = kill({ encounterId: 999, casts: [cast(740, 130_000, "Leafy")] });
    await mod.saveKill(k);
    await mod.saveKill(k); // re-saving replaces casts instead of duplicating them
    expect(await mod.hasKill(k.reportCode, k.fightId)).toBe(true);
    const [loaded] = await mod.loadKills(999, "mythic");
    expect(loaded).toMatchObject({ reportCode: k.reportCode, killIndex: 1, healers: k.healers, phases: k.phases });
    expect(loaded.killDate).toBe(k.killDate);
    expect(loaded.casts).toEqual(k.casts);
  });

  it("stores guild kill history", async () => {
    const h = { kills: [{ reportCode: "A", fightId: 3 }], firstConfirmed: true };
    await mod.saveGuildKillHistory(1, 999, "heroic", h);
    expect(await mod.getGuildKillHistory(1, 999, "heroic")).toEqual(h);
    expect(await mod.getGuildKillHistory(1, 999, "mythic")).toBeNull();
  });
});
