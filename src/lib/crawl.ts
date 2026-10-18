import { COOLDOWNS } from "@/data/cooldowns";
import {
  getCrawlPage,
  getGuildKillHistory,
  hasKill,
  killsMissingDamage,
  saveCrawlPage,
  saveDamage,
  saveGuildKillHistory,
  saveKill,
  type GuildKillHistory,
} from "./db";
import { HEALER_SPECS, DIFFICULTY_ID, type Difficulty, type HealerSpec, type KillDamage, type KillRecord } from "./types";
import type { WclClient } from "./wcl/client";
import {
  DAMAGE_BUCKET_MS,
  fightCasts,
  fightDamage,
  fightHealers,
  fightRankings,
  guildReports,
  reportActors,
  reportPulls,
  type BossFight,
  type RankedFight,
  type RankingMetric,
} from "./wcl/queries";

/** Past this many kills a guild is on farm; the engine weights every kill after the 3rd the same. */
const HISTORY_DEPTH = 3;

const isHealerSpec = (s: string): s is HealerSpec => (HEALER_SPECS as readonly string[]).includes(s);

/**
 * Walks a guild's public reports oldest first and records its first few kills of a boss.
 * The first kill is "confirmed" when public wipes on the boss come before it, which means
 * the guild logged its progression rather than uploading a reclear.
 */
export async function buildKillHistory(
  wcl: WclClient,
  guildId: number,
  zoneId: number,
  encounterId: number,
  difficulty: Difficulty,
): Promise<GuildKillHistory> {
  const kills: GuildKillHistory["kills"] = [];
  let sawWipe = false;
  let firstConfirmed = false;
  for (const report of await guildReports(wcl, guildId, zoneId)) {
    const { fights } = await reportPulls(wcl, report.code, encounterId, DIFFICULTY_ID[difficulty]);
    for (const f of fights.sort((a, b) => a.startTime - b.startTime)) {
      if (!f.kill) {
        sawWipe = true;
        continue;
      }
      if (kills.length === 0) firstConfirmed = sawWipe;
      kills.push({ reportCode: report.code, fightId: f.id });
      if (kills.length >= HISTORY_DEPTH) return { kills, firstConfirmed };
    }
  }
  return { kills, firstConfirmed };
}

export function killIndexOf(history: GuildKillHistory, reportCode: string, fightId: number): number | null {
  const i = history.kills.findIndex((k) => k.reportCode === reportCode && k.fightId === fightId);
  if (i >= 0) return i + 1;
  return history.kills.length >= HISTORY_DEPTH ? HISTORY_DEPTH + 1 : null;
}

interface KillMeta {
  reportCode: string;
  guildId: number;
  guildName: string;
  encounterId: number;
  difficulty: Difficulty;
  killIndex: number | null;
  firstKillConfirmed: boolean;
}

/** The raid's damage taken in a fight, or null when it couldn't be read, so a later backfill can try again. */
async function tryFightDamage(wcl: WclClient, code: string, fight: BossFight, log: (msg: string) => void): Promise<KillDamage | null> {
  try {
    return await fightDamage(wcl, code, fight);
  } catch (e) {
    log(`No damage for ${code}#${fight.id}: ${(e as Error).message}`);
    return null;
  }
}

/** Fetches healers, phases, cooldown casts and damage taken for one kill fight. */
async function buildKillRecord(
  wcl: WclClient,
  meta: KillMeta,
  reportStart: number,
  fight: BossFight,
  log: (msg: string) => void,
): Promise<KillRecord> {
  const healers = (await fightHealers(wcl, meta.reportCode, fight.id)).filter(
    (h): h is { actorId: number; name: string; spec: HealerSpec } => isHealerSpec(h.spec),
  );
  const specByName = new Map(healers.map((h) => [h.name, h.spec]));
  const actors = await reportActors(wcl, meta.reportCode);
  const raw = await fightCasts(wcl, meta.reportCode, fight, COOLDOWNS.map((c) => c.spellId));
  const damage = await tryFightDamage(wcl, meta.reportCode, fight, log);

  return {
    ...meta,
    fightId: fight.id,
    killDate: reportStart + fight.startTime,
    durationMs: fight.endTime - fight.startTime,
    healers: healers.map((h) => h.spec),
    phases: (fight.phaseTransitions ?? []).map((p) => ({ id: p.id, startMs: p.startTime - fight.startTime })),
    casts: raw.map((c) => {
      const source = actors.get(c.sourceID) ?? `#${c.sourceID}`;
      return {
        spellId: c.abilityGameID,
        source,
        sourceSpec: specByName.get(source) ?? null,
        timestampMs: c.timestamp - fight.startTime,
      };
    }),
    damage,
  };
}

async function crawlFight(
  wcl: WclClient,
  ranked: RankedFight,
  zoneId: number,
  encounterId: number,
  difficulty: Difficulty,
  metric: RankingMetric,
  log: (msg: string) => void,
): Promise<KillRecord | null> {
  const { reportStart, fights } = await reportPulls(wcl, ranked.reportCode, encounterId, DIFFICULTY_ID[difficulty]);
  const fight = fights.find((f) => f.id === ranked.fightId && f.kill);
  if (!fight) return null;

  let killIndex: number | null;
  let firstConfirmed: boolean;
  if (metric === "progress") {
    // Progress rankings list each guild's first kill, so the guild's history isn't needed.
    killIndex = 1;
    firstConfirmed = fights.some((f) => !f.kill && f.startTime < fight.startTime);
  } else {
    let history = await getGuildKillHistory(ranked.guildId, encounterId, difficulty);
    if (!history) {
      history = await buildKillHistory(wcl, ranked.guildId, zoneId, encounterId, difficulty);
      await saveGuildKillHistory(ranked.guildId, encounterId, difficulty, history);
    }
    killIndex = killIndexOf(history, ranked.reportCode, fight.id);
    firstConfirmed = killIndex === 1 && history.firstConfirmed;
  }
  return buildKillRecord(
    wcl,
    {
      reportCode: ranked.reportCode,
      guildId: ranked.guildId,
      guildName: ranked.guildName,
      encounterId,
      difficulty,
      killIndex,
      firstKillConfirmed: firstConfirmed,
    },
    reportStart,
    fight,
    log,
  );
}

export interface CrawlOptions {
  zoneId: number;
  encounterId: number;
  difficulty: Difficulty;
  /** "progress" walks guilds' first kills in the order they happened; "speed" walks the fastest kills. */
  metric: RankingMetric;
  /** Limits the crawl to one region's rankings, e.g. "US". */
  region?: string;
  /** Pages of speed rankings to walk, 100 kills each. Progress rankings are always walked to the end. */
  pages: number;
  /** Stop when this many points are left in the hour, to leave room for on-demand imports. */
  reservePoints: number;
  log?: (msg: string) => void;
}

/** True when the hour's remaining Warcraft Logs points have dropped to the reserve, after logging it. */
export async function overBudget(wcl: WclClient, reservePoints: number, log: (msg: string) => void = console.log) {
  const rl = await wcl.rateLimit();
  if (rl.limitPerHour - rl.pointsSpentThisHour >= reservePoints) return false;
  log(`Stopping: ${rl.pointsSpentThisHour}/${rl.limitPerHour} Warcraft Logs points used this hour`);
  return true;
}

/**
 * Crawls new kills of one boss into the database. Safe to re-run: known kills are skipped.
 * Progress rankings only grow at the end, so that crawl resumes from the page the last run reached and walks to the end;
 * speed rankings are re-read from the top, `pages` deep. Checks the hour's API points before every Warcraft Logs
 * request batch and returns `stopped: true` once only the reserve is left, so the caller can end the run.
 */
export async function crawlBoss(wcl: WclClient, opts: CrawlOptions) {
  const log = opts.log ?? console.log;
  const resumable = opts.metric === "progress";
  // Each region's progress crawl keeps its own place in the rankings.
  const cursorKey = opts.region ? `${opts.metric}:${opts.region}` : opts.metric;
  let saved = 0;
  let page = resumable ? ((await getCrawlPage(opts.encounterId, opts.difficulty, cursorKey)) ?? 1) : 1;
  const stop = async () => {
    if (resumable) await saveCrawlPage(opts.encounterId, opts.difficulty, cursorKey, page);
    return { saved, stopped: true };
  };
  for (; resumable || page <= opts.pages; page++) {
    if (await overBudget(wcl, opts.reservePoints, log)) return stop();
    const label = `${opts.metric}${opts.region ? ` ${opts.region}` : ""} rankings page ${page} for encounter ${opts.encounterId} ${opts.difficulty}`;
    let ranking: Awaited<ReturnType<typeof fightRankings>>;
    try {
      ranking = await fightRankings(wcl, opts.encounterId, DIFFICULTY_ID[opts.difficulty], page, opts.metric, opts.region);
    } catch (e) {
      // A failed rankings request ends this boss for the run rather than the whole crawl.
      log(`Couldn't read ${label}: ${(e as Error).message}`);
      return { saved, stopped: false };
    }
    const { fights, hasMorePages, note } = ranking;
    if (note) log(`No ${label}: ${note}`);
    for (const ranked of fights) {
      if (await hasKill(ranked.reportCode, ranked.fightId)) continue;
      if (await overBudget(wcl, opts.reservePoints, log)) return stop();
      try {
        const kill = await crawlFight(wcl, ranked, opts.zoneId, opts.encounterId, opts.difficulty, opts.metric, log);
        if (kill) {
          await saveKill(kill);
          saved++;
          log(`Saved ${ranked.guildName} ${ranked.reportCode}#${ranked.fightId} (kill ${kill.killIndex ?? "?"})`);
        }
      } catch (e) {
        log(`Skipped ${ranked.reportCode}#${ranked.fightId}: ${(e as Error).message}`);
      }
    }
    // The last page can still fill up, so the next run starts by re-reading it.
    if (resumable) await saveCrawlPage(opts.encounterId, opts.difficulty, cursorKey, hasMorePages ? page + 1 : page);
    if (!hasMorePages) break;
  }
  return { saved, stopped: false };
}

const MAX_DAMAGE_FAILURES = 5;
/** Errors Warcraft Logs gives for a report that's no longer public. */
const GONE = /permission to view this report|report does not exist/i;
const NO_DAMAGE: KillDamage = { bucketMs: DAMAGE_BUCKET_MS, total: [], top: [], names: {} };

/**
 * Fetches damage taken for kills saved without it, newest first, until `limit` kills are done or only the
 * reserve of the hour's points is left. Kills whose report went private or lost the fight are stored with no damage so
 * they aren't asked for again. Other failures stay unfetched and are retried on the next run, and a run of them in a
 * row ends the backfill so a broken query doesn't spend the hour's points.
 */
export async function backfillDamage(wcl: WclClient, opts: { limit: number; reservePoints: number; log?: (msg: string) => void }) {
  const log = opts.log ?? console.log;
  const kills = await killsMissingDamage(opts.limit);
  let done = 0;
  let failedInARow = 0;
  for (const k of kills) {
    if (failedInARow >= MAX_DAMAGE_FAILURES) {
      log(`Stopped the damage backfill after ${failedInARow} failures in a row`);
      break;
    }
    if (await overBudget(wcl, opts.reservePoints, log)) return { done, stopped: true };
    try {
      const { fights } = await reportPulls(wcl, k.reportCode, k.encounterId, DIFFICULTY_ID[k.difficulty]);
      const fight = fights.find((f) => f.id === k.fightId);
      if (!fight) {
        log(`No damage for ${k.reportCode}#${k.fightId}: fight not found`);
        await saveDamage(k.reportCode, k.fightId, NO_DAMAGE);
        continue;
      }
      const damage = await fightDamage(wcl, k.reportCode, fight);
      await saveDamage(k.reportCode, k.fightId, damage);
      done++;
      failedInARow = 0;
    } catch (e) {
      const message = (e as Error).message;
      log(`No damage for ${k.reportCode}#${k.fightId}: ${message}`);
      if (GONE.test(message)) {
        // The report went private or was deleted, so it will never answer; don't ask again every run.
        await saveDamage(k.reportCode, k.fightId, NO_DAMAGE);
      } else {
        failedInARow++;
      }
    }
  }
  return { done, stopped: false };
}
