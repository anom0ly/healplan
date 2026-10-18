import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { summarizeComps, type CompSummary } from "./engine/comp";
import type { Difficulty, HealerSpec, KillRecord } from "./types";

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function migrate() {
  const sql = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await db().query(sql);
}

export async function saveKill(k: KillRecord) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO kills (report_code, fight_id, encounter_id, difficulty, guild_id, guild_name, kill_date,
         duration_ms, healers, kill_index, first_kill_confirmed, phases)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9, $10, $11, $12)
       ON CONFLICT (report_code, fight_id) DO UPDATE SET
         kill_index = EXCLUDED.kill_index, first_kill_confirmed = EXCLUDED.first_kill_confirmed, crawled_at = now()`,
      [k.reportCode, k.fightId, k.encounterId, k.difficulty, k.guildId, k.guildName, k.killDate,
       k.durationMs, k.healers, k.killIndex, k.firstKillConfirmed, JSON.stringify(k.phases)],
    );
    await client.query("DELETE FROM casts WHERE report_code = $1 AND fight_id = $2", [k.reportCode, k.fightId]);
    for (const c of k.casts) {
      await client.query(
        `INSERT INTO casts (report_code, fight_id, spell_id, source, source_spec, timestamp_ms) VALUES ($1, $2, $3, $4, $5, $6)`,
        [k.reportCode, k.fightId, c.spellId, c.source, c.sourceSpec, c.timestampMs],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function hasKill(reportCode: string, fightId: number): Promise<boolean> {
  const r = await db().query("SELECT 1 FROM kills WHERE report_code = $1 AND fight_id = $2", [reportCode, fightId]);
  return (r.rowCount ?? 0) > 0;
}

export async function loadKills(encounterId: number, difficulty: Difficulty): Promise<KillRecord[]> {
  const kills = await db().query(
    `SELECT * FROM kills WHERE encounter_id = $1 AND difficulty = $2 ORDER BY kill_date DESC`,
    [encounterId, difficulty],
  );
  const casts = await db().query(
    `SELECT c.* FROM casts c JOIN kills k USING (report_code, fight_id) WHERE k.encounter_id = $1 AND k.difficulty = $2`,
    [encounterId, difficulty],
  );
  const byFight = new Map<string, KillRecord["casts"]>();
  for (const c of casts.rows) {
    const key = `${c.report_code}#${c.fight_id}`;
    const list = byFight.get(key) ?? [];
    list.push({ spellId: c.spell_id, source: c.source, sourceSpec: c.source_spec, timestampMs: c.timestamp_ms });
    byFight.set(key, list);
  }
  return kills.rows.map((r) => ({
    reportCode: r.report_code,
    fightId: r.fight_id,
    encounterId: r.encounter_id,
    difficulty: r.difficulty,
    guildId: r.guild_id,
    guildName: r.guild_name,
    killDate: new Date(r.kill_date).getTime(),
    durationMs: r.duration_ms,
    healers: r.healers as HealerSpec[],
    killIndex: r.kill_index,
    firstKillConfirmed: r.first_kill_confirmed,
    phases: r.phases,
    casts: byFight.get(`${r.report_code}#${r.fight_id}`) ?? [],
  }));
}

export interface GuildKillHistory {
  kills: { reportCode: string; fightId: number }[];
  firstConfirmed: boolean;
}

export async function getGuildKillHistory(guildId: number, encounterId: number, difficulty: Difficulty) {
  const r = await db().query(
    "SELECT kills, first_confirmed FROM guild_kill_history WHERE guild_id = $1 AND encounter_id = $2 AND difficulty = $3",
    [guildId, encounterId, difficulty],
  );
  return r.rows[0] ? ({ kills: r.rows[0].kills, firstConfirmed: r.rows[0].first_confirmed } as GuildKillHistory) : null;
}

export async function saveGuildKillHistory(guildId: number, encounterId: number, difficulty: Difficulty, h: GuildKillHistory) {
  await db().query(
    `INSERT INTO guild_kill_history (guild_id, encounter_id, difficulty, kills, first_confirmed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, encounter_id, difficulty) DO UPDATE SET kills = EXCLUDED.kills,
       first_confirmed = EXCLUDED.first_confirmed, updated_at = now()`,
    [guildId, encounterId, difficulty, JSON.stringify(h.kills), h.firstConfirmed],
  );
}

/** The rankings page a resumable crawl should start from, or null when it hasn't run yet. */
export async function getCrawlPage(encounterId: number, difficulty: Difficulty, metric: string): Promise<number | null> {
  const r = await db().query(
    "SELECT next_page FROM crawl_pages WHERE encounter_id = $1 AND difficulty = $2 AND metric = $3",
    [encounterId, difficulty, metric],
  );
  return r.rows[0]?.next_page ?? null;
}

export async function saveCrawlPage(encounterId: number, difficulty: Difficulty, metric: string, nextPage: number) {
  await db().query(
    `INSERT INTO crawl_pages (encounter_id, difficulty, metric, next_page) VALUES ($1, $2, $3, $4)
     ON CONFLICT (encounter_id, difficulty, metric) DO UPDATE SET next_page = EXCLUDED.next_page, updated_at = now()`,
    [encounterId, difficulty, metric, nextPage],
  );
}

export async function saveEncounters(zoneId: number, zoneName: string, encounters: { id: number; name: string }[]) {
  for (const [i, e] of encounters.entries()) {
    await db().query(
      `INSERT INTO encounters (id, zone_id, zone_name, name, position) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, zone_name = EXCLUDED.zone_name,
         name = EXCLUDED.name, position = EXCLUDED.position`,
      [e.id, zoneId, zoneName, e.name, i],
    );
  }
}

export interface BossOption {
  id: number;
  name: string;
  zoneName: string;
  kills: Record<Difficulty, number>;
}

/** Saved bosses, newest raid first and in raid order, with how many kills of each difficulty are stored. */
export async function listBosses(): Promise<BossOption[]> {
  const r = await db().query(
    `SELECT e.id, e.name, e.zone_name,
       count(k.*) FILTER (WHERE k.difficulty = 'mythic')::int AS mythic,
       count(k.*) FILTER (WHERE k.difficulty = 'heroic')::int AS heroic
     FROM encounters e LEFT JOIN kills k ON k.encounter_id = e.id
     GROUP BY e.id ORDER BY max(e.zone_id) DESC, max(e.position)`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    zoneName: row.zone_name,
    kills: { mythic: row.mythic, heroic: row.heroic },
  }));
}

/** Every healer lineup stored for this boss, most-used first. */
export async function listComps(encounterId: number, difficulty: Difficulty): Promise<CompSummary[]> {
  const r = await db().query(
    `SELECT healers, count(*)::int AS kills, count(*) FILTER (WHERE kill_index = 1)::int AS first_kills
     FROM kills WHERE encounter_id = $1 AND difficulty = $2 GROUP BY healers`,
    [encounterId, difficulty],
  );
  return summarizeComps(r.rows.map((row) => ({ healers: row.healers, kills: row.kills, firstKills: row.first_kills })));
}

/** How often each spell id appears in stored casts, and in how many kills. */
export async function castCounts(): Promise<Map<number, { casts: number; kills: number }>> {
  const r = await db().query(
    `SELECT spell_id, count(*)::int AS casts, count(DISTINCT (report_code, fight_id))::int AS kills
     FROM casts GROUP BY spell_id`,
  );
  return new Map(r.rows.map((row) => [row.spell_id, { casts: row.casts, kills: row.kills }]));
}

/** Kills with a healer of this spec and no stored casts of any of these spells, newest first. */
export async function killsMissingSpells(spec: HealerSpec, spellIds: number[], limit: number) {
  const r = await db().query(
    `SELECT report_code, fight_id, encounter_id, difficulty FROM kills k
     WHERE $1 = ANY (k.healers)
       AND NOT EXISTS (SELECT 1 FROM casts c WHERE c.report_code = k.report_code AND c.fight_id = k.fight_id AND c.spell_id = ANY ($2))
     ORDER BY kill_date DESC LIMIT $3`,
    [spec, spellIds, limit],
  );
  return r.rows.map((row) => ({
    reportCode: row.report_code as string,
    fightId: row.fight_id as number,
    encounterId: row.encounter_id as number,
    difficulty: row.difficulty as Difficulty,
  }));
}

/** Replaces one kill's stored casts of the given spells. */
export async function replaceSpellCasts(reportCode: string, fightId: number, spellIds: number[], casts: KillRecord["casts"]) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM casts WHERE report_code = $1 AND fight_id = $2 AND spell_id = ANY ($3)", [reportCode, fightId, spellIds]);
    for (const c of casts) {
      await client.query(
        `INSERT INTO casts (report_code, fight_id, spell_id, source, source_spec, timestamp_ms) VALUES ($1, $2, $3, $4, $5, $6)`,
        [reportCode, fightId, c.spellId, c.source, c.sourceSpec, c.timestampMs],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
