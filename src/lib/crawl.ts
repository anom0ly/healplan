import { COOLDOWNS } from "@/data/cooldowns";
import { getGuildKillHistory, hasKill, saveGuildKillHistory, saveKill, type GuildKillHistory } from "./db";
import { HEALER_SPECS, DIFFICULTY_ID, type Difficulty, type HealerSpec, type KillRecord } from "./types";
import type { WclClient } from "./wcl/client";
import { fightCasts, fightHealers, fightRankings, guildReports, reportActors, reportPulls, type RankedFight } from "./wcl/queries";

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

async function crawlFight(
  wcl: WclClient,
  ranked: RankedFight,
  zoneId: number,
  encounterId: number,
  difficulty: Difficulty,
): Promise<KillRecord | null> {
  let history = await getGuildKillHistory(ranked.guildId, encounterId, difficulty);
  if (!history) {
    history = await buildKillHistory(wcl, ranked.guildId, zoneId, encounterId, difficulty);
    await saveGuildKillHistory(ranked.guildId, encounterId, difficulty, history);
  }

  const { reportStart, fights } = await reportPulls(wcl, ranked.reportCode, encounterId, DIFFICULTY_ID[difficulty]);
  const fight = fights.find((f) => f.id === ranked.fightId && f.kill);
  if (!fight) return null;

  const healers = (await fightHealers(wcl, ranked.reportCode, fight.id)).filter(
    (h): h is { name: string; spec: HealerSpec } => isHealerSpec(h.spec),
  );
  const specByName = new Map(healers.map((h) => [h.name, h.spec]));
  const actors = await reportActors(wcl, ranked.reportCode);
  const raw = await fightCasts(wcl, ranked.reportCode, fight, COOLDOWNS.map((c) => c.spellId));

  const killIndex = killIndexOf(history, ranked.reportCode, fight.id);
  return {
    reportCode: ranked.reportCode,
    fightId: fight.id,
    encounterId,
    difficulty,
    guildId: ranked.guildId,
    guildName: ranked.guildName,
    killDate: reportStart + fight.startTime,
    durationMs: fight.endTime - fight.startTime,
    healers: healers.map((h) => h.spec),
    killIndex,
    firstKillConfirmed: killIndex === 1 && history.firstConfirmed,
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

export interface CrawlOptions {
  zoneId: number;
  encounterId: number;
  difficulty: Difficulty;
  /** Pages of speed rankings to walk, 100 kills each. */
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
    const { fights, hasMorePages } = await fightRankings(wcl, opts.encounterId, DIFFICULTY_ID[opts.difficulty], page);
    for (const ranked of fights) {
      if (await hasKill(ranked.reportCode, ranked.fightId)) continue;
      const rl = await wcl.rateLimit();
      if (rl.limitPerHour - rl.pointsSpentThisHour < opts.reservePoints) {
        log(`Stopping: ${rl.pointsSpentThisHour}/${rl.limitPerHour} points used this hour`);
        return saved;
      }
      try {
        const kill = await crawlFight(wcl, ranked, opts.zoneId, opts.encounterId, opts.difficulty);
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
