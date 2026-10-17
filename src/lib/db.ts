import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
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
