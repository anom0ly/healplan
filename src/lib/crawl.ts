import { COOLDOWNS } from "@/data/cooldowns";
import { getGuildKillHistory, hasKill, saveGuildKillHistory, saveKill, type GuildKillHistory } from "./db";
import { HEALER_SPECS, DIFFICULTY_ID, type Difficulty, type HealerSpec, type KillRecord } from "./types";
import type { WclClient } from "./wcl/client";
import {
  fightCasts,
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

/** Fetches healers, phases and cooldown casts for one kill fight. */
async function buildKillRecord(wcl: WclClient, meta: KillMeta, reportStart: number, fight: BossFight): Promise<KillRecord> {
  const healers = (await fightHealers(wcl, meta.reportCode, fight.id)).filter(
    (h): h is { name: string; spec: HealerSpec } => isHealerSpec(h.spec),
  );
  const specByName = new Map(healers.map((h) => [h.name, h.spec]));
  const actors = await reportActors(wcl, meta.reportCode);
  const raw = await fightCasts(wcl, meta.reportCode, fight, COOLDOWNS.map((c) => c.spellId));

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
  };
}

async function crawlFight(
  wcl: WclClient,
  ranked: RankedFight,
  zoneId: number,
  encounterId: number,
  difficulty: Difficulty,
  metric: RankingMetric,
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
  );
}

export interface CrawlOptions {
  zoneId: number;
  encounterId: number;
  difficulty: Difficulty;
  /** "progress" walks guilds' first kills in the order they happened; "speed" walks the fastest kills. */
  metric: RankingMetric;
  /** Pages of rankings to walk, 100 kills each. */
  pages: number;
  /** Stop when this many points are left in the hour, to leave room for on-demand imports. */
  reservePoints: number;
  log?: (msg: string) => void;
}

/** Crawls new kills of one boss into the database. Safe to re-run: known kills are skipped. */
export async function crawlBoss(wcl: WclClient, opts: CrawlOptions) {
  const log = opts.log ?? console.log;
  let saved = 0;
  for (let page = 1; page <= opts.pages; page++) {
    const { fights, hasMorePages } = await fightRankings(wcl, opts.encounterId, DIFFICULTY_ID[opts.difficulty], page, opts.metric);
    for (const ranked of fights) {
      if (await hasKill(ranked.reportCode, ranked.fightId)) continue;
      const rl = await wcl.rateLimit();
      if (rl.limitPerHour - rl.pointsSpentThisHour < opts.reservePoints) {
        log(`Stopping: ${rl.pointsSpentThisHour}/${rl.limitPerHour} points used this hour`);
        return saved;
      }
      try {
        const kill = await crawlFight(wcl, ranked, opts.zoneId, opts.encounterId, opts.difficulty, opts.metric);
        if (kill) {
          await saveKill(kill);
          saved++;
          log(`Saved ${ranked.guildName} ${ranked.reportCode}#${ranked.fightId} (kill ${kill.killIndex ?? "?"})`);
        }
      } catch (e) {
        log(`Skipped ${ranked.reportCode}#${ranked.fightId}: ${(e as Error).message}`);
      }
    }
    if (!hasMorePages) break;
  }
  return saved;
}

