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
    await mod.db().query("TRUNCATE kills, casts, guild_kill_history, crawl_pages, encounters, user_reports CASCADE");
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
    expect(loaded.damage).toBeNull();
  });

  it("saves damage and finds kills still missing it", async () => {
    const damage = { bucketMs: 5_000, total: [10, 20], top: [[[1, 10]], [[1, 20]]] as [number, number][][], names: { 1: "Melee" } };
    const k = kill({ encounterId: 998 });
    await mod.saveKill(k);
    expect((await mod.killsMissingDamage(100)).map((m) => m.reportCode)).toContain(k.reportCode);
    await mod.saveDamage(k.reportCode, k.fightId, damage);
    expect((await mod.killsMissingDamage(100)).map((m) => m.reportCode)).not.toContain(k.reportCode);
    await mod.saveKill(k); // a re-crawl without damage keeps what's stored
    const [loaded] = await mod.loadKills(998, "mythic");
    expect(loaded.damage).toEqual(damage);
  });

  it("stores guild kill history", async () => {
    const h = { kills: [{ reportCode: "A", fightId: 3 }], firstConfirmed: true };
    await mod.saveGuildKillHistory(1, 999, "heroic", h);
    expect(await mod.getGuildKillHistory(1, 999, "heroic")).toEqual(h);
    expect(await mod.getGuildKillHistory(1, 999, "mythic")).toBeNull();
  });

  it("remembers where a resumable crawl got to", async () => {
    expect(await mod.getCrawlPage(999, "heroic", "progress")).toBeNull();
    await mod.saveCrawlPage(999, "heroic", "progress", 3);
    await mod.saveCrawlPage(999, "heroic", "progress", 4);
    expect(await mod.getCrawlPage(999, "heroic", "progress")).toBe(4);
    expect(await mod.getCrawlPage(999, "mythic", "progress")).toBeNull();
  });

  it("lists saved bosses with kill counts, and counts casts per spell", async () => {
    await mod.saveEncounters(53, "Test Raid", [
      { id: 998, name: "First Boss" },
      { id: 999, name: "Second Boss" },
    ]);
    const bosses = await mod.listBosses();
    expect(bosses.map((b) => b.name)).toEqual(["First Boss", "Second Boss"]);
    expect(bosses[1]).toMatchObject({ zoneName: "Test Raid", kills: { mythic: 1, heroic: 0 } });
    expect((await mod.castCounts()).get(740)).toEqual({ casts: 1, kills: 1 });
  });

  it("finds kills missing newly listed spells and backfills them", async () => {
    const k = kill({ encounterId: 997, casts: [cast(740, 10_000, "Leafy")] });
    await mod.saveKill(k);
    const missing = await mod.killsMissingSpells("DisciplinePriest", [472433], 1000);
    expect(missing).toContainEqual({ reportCode: k.reportCode, fightId: 1, encounterId: 997, difficulty: "mythic" });
    expect(await mod.killsMissingSpells("MistweaverMonk", [472433], 1000)).toEqual([]);

    const evangelism = { spellId: 472433, source: "Shadowy", sourceSpec: "DisciplinePriest" as const, timestampMs: 20_000 };
    await mod.replaceSpellCasts(k.reportCode, 1, [472433], [evangelism]);
    await mod.replaceSpellCasts(k.reportCode, 1, [472433], [evangelism]); // re-running doesn't duplicate
    expect((await mod.killsMissingSpells("DisciplinePriest", [472433], 1000)).map((m) => m.reportCode)).not.toContain(k.reportCode);
    const [loaded] = await mod.loadKills(997, "mythic");
    expect(loaded.casts).toHaveLength(2); // the existing Tranquility cast is kept
  });

  it("counts kills per healer lineup, whatever order the healers were saved in", async () => {
    await mod.saveKill(kill({ encounterId: 996, healers: ["HolyPaladin", "RestorationDruid"] }));
    await mod.saveKill(kill({ encounterId: 996, healers: ["RestorationDruid", "HolyPaladin"], killIndex: 2 }));
    await mod.saveKill(kill({ encounterId: 996, healers: ["MistweaverMonk"] }));
    expect(await mod.listComps(996, "mythic")).toEqual([
      { healers: ["RestorationDruid", "HolyPaladin"], kills: 2, firstKills: 1 },
      { healers: ["MistweaverMonk"], kills: 1, firstKills: 1 },
    ]);
  });

  it("stores pasted reports and their pulls, and deletes ones nobody has fetched in two weeks", async () => {
    const fight = { id: 3, encounterId: 999, difficulty: "mythic" as const, kill: false, durationMs: 90_000, bossPercent: 61.5, phases: [], startTime: 1_000, endTime: 91_000 };
    await mod.saveUserReport("OLDREPORT", "Old night", [fight]);
    await mod.saveUserReport("NEWREPORT", "New night", [fight]);
    await mod.saveUserPull("OLDREPORT", 3, { healers: [{ name: "Leafy", spec: "RestorationDruid" }], casts: [cast(740, 30_000, "Leafy")], damage: null });
    expect((await mod.getUserReport("NEWREPORT"))?.fights).toEqual([fight]);
    expect((await mod.getUserPulls("OLDREPORT", [3, 4])).get(3)?.casts).toEqual([cast(740, 30_000, "Leafy")]);

    await mod.db().query("UPDATE user_reports SET fetched_at = now() - interval '15 days' WHERE report_code = 'OLDREPORT'");
    expect(await mod.deleteOldUserReports(14)).toBe(1);
    expect(await mod.getUserReport("OLDREPORT")).toBeNull();
    expect((await mod.getUserPulls("OLDREPORT", [3])).size).toBe(0);
    expect(await mod.getUserReport("NEWREPORT")).not.toBeNull();
  });
});
