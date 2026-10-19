import { COOLDOWNS } from "@/data/cooldowns";
import {
  deleteOldUserReports,
  getUserPulls,
  getUserReport,
  saveUserPull,
  saveUserReport,
  type UserFight,
  type UserPullData,
  type UserReport,
} from "./db";
import { HEALER_SPECS, type Difficulty, type HealerSpec, type ReportPull } from "./types";
import { WclClient } from "./wcl/client";
import { fightCasts, fightDamage, fightHealers, reportActors, reportBossFights } from "./wcl/queries";

/** Pasted reports are deleted this long after they were last fetched. */
export const RETENTION_DAYS = 14;
/** A report fetched this recently is served from the database without asking Warcraft Logs for new pulls. */
const REFRESH_MS = 60_000;
/** Pasted reports stop fetching when fewer of the hour's points are left than this, so the crawler keeps its share. */
const RESERVE_POINTS = 3_000;
/** Pulls shorter than this are resets and aren't fetched. */
export const MIN_PULL_MS = 15_000;
/** Only the newest pulls of a boss are fetched. */
const MAX_PULLS = 40;
/** Pulls fetched at the same time. */
const PARALLEL = 4;

const DIFFICULTY_BY_ID: Record<number, Difficulty> = { 4: "heroic", 5: "mythic" };
const GONE = /permission to view this report|report does not exist|do not have permission/i;

const isHealerSpec = (s: string): s is HealerSpec => (HEALER_SPECS as readonly string[]).includes(s);

/** A problem to show the person, worded for them. */
export class ReportError extends Error {}

export interface ReportLink {
  code: string;
  /** The fight the link points at, when it names one. */
  fightId: number | null;
}

/** Reads a Warcraft Logs report link, or a bare report code. */
export function parseReportLink(input: string): ReportLink | null {
  const s = input.trim();
  const m = s.match(/reports\/([A-Za-z0-9]{16})/) ?? s.match(/^([A-Za-z0-9]{16})$/);
  if (!m) return null;
  const fight = s.match(/[?#&]fight=(\d+)/);
  return { code: m[1], fightId: fight ? Number(fight[1]) : null };
}

export interface BossInReport {
  encounterId: number;
  difficulty: Difficulty;
  pulls: number;
}

export interface LoadedReport {
  code: string;
  title: string;
  encounterId: number;
  difficulty: Difficulty;
  /** Pulls of the boss, oldest first, resets left out. */
  pulls: ReportPull[];
  /** Pulls that couldn't be fetched this time, e.g. when the hour's points ran low. */
  missing: number;
  /** Every Heroic and Mythic boss in the report, with its pull count. */
  bosses: BossInReport[];
}

/** The healers of the newest pull, the comp the plan is built for. */
export function compOf(pulls: ReportPull[]): HealerSpec[] {
  return pulls.length === 0 ? [] : pulls[pulls.length - 1].healers.map((h) => h.spec);
}

/** Runs `fn` on every item, a few at a time. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function fetchFights(wcl: WclClient, code: string): Promise<UserReport> {
  const r = await reportBossFights(wcl, code);
  const fights: UserFight[] = r.fights
    .filter((f) => f.difficulty !== null && DIFFICULTY_BY_ID[f.difficulty])
    .map((f) => ({
      id: f.id,
      encounterId: f.encounterID,
      difficulty: DIFFICULTY_BY_ID[f.difficulty!],
      kill: f.kill,
      durationMs: f.endTime - f.startTime,
      bossPercent: f.kill ? 0 : f.bossPercentage,
      phases: (f.phaseTransitions ?? []).map((p) => ({ id: p.id, startMs: p.startTime - f.startTime })),
      startTime: f.startTime,
      endTime: f.endTime,
    }));
  await saveUserReport(code, r.title, fights);
  return { code, title: r.title, fights, fetchedAt: Date.now() };
}

async function fetchPull(wcl: WclClient, code: string, fight: UserFight, actors: Map<number, string>): Promise<UserPullData> {
  const healers = (await fightHealers(wcl, code, fight.id))
    .filter((h): h is { actorId: number; name: string; spec: HealerSpec } => isHealerSpec(h.spec))
    .map((h) => ({ name: h.name, spec: h.spec }));
  const specByName = new Map(healers.map((h) => [h.name, h.spec]));
  const raw = await fightCasts(wcl, code, fight, COOLDOWNS.map((c) => c.spellId));
  const damage = await fightDamage(wcl, code, fight).catch(() => null);
  return {
    healers,
    casts: raw.map((c) => {
      const source = actors.get(c.sourceID) ?? `#${c.sourceID}`;
      return { spellId: c.abilityGameID, source, sourceSpec: specByName.get(source) ?? null, timestampMs: c.timestamp - fight.startTime };
    }),
    damage,
  };
}

/**
 * Loads one boss's pulls from a pasted report: from the database when fetched in the last minute, otherwise asking
 * Warcraft Logs for the report's pulls and fetching only the ones not stored yet, so a live report picks up new pulls.
 * The boss is the one the link points at, else `want`'s when the report has it, else the boss of the report's last pull.
 */
export async function loadReport(
  link: ReportLink,
  want: { encounterId?: number; difficulty?: Difficulty } = {},
  client: () => WclClient = () => new WclClient(),
): Promise<LoadedReport> {
  await deleteOldUserReports(RETENTION_DAYS);
  let wcl: WclClient | null = null;
  const api = () => (wcl ??= client());

  let report = await getUserReport(link.code);
  if (!report || Date.now() - report.fetchedAt > REFRESH_MS) {
    try {
      report = await fetchFights(api(), link.code);
    } catch (e) {
      const message = (e as Error).message;
      // A stored copy still answers when Warcraft Logs can't, unless the report is gone.
      if (GONE.test(message)) throw new ReportError("That log is private or doesn't exist. Only public logs can be checked.");
      if (!report) throw new ReportError("Couldn't reach Warcraft Logs to read that log. Try again in a minute.");
    }
  }

  const { fights } = report;
  if (fights.length === 0) throw new ReportError("That log has no Heroic or Mythic boss pulls.");
  const bosses: BossInReport[] = [];
  for (const f of fights) {
    const b = bosses.find((x) => x.encounterId === f.encounterId && x.difficulty === f.difficulty);
    if (b) b.pulls++;
    else bosses.push({ encounterId: f.encounterId, difficulty: f.difficulty, pulls: 1 });
  }
  const pointed = link.fightId !== null ? fights.find((f) => f.id === link.fightId) : undefined;
  const wanted = fights.filter((f) => f.encounterId === want.encounterId && (!want.difficulty || f.difficulty === want.difficulty));
  const boss = pointed ?? wanted[wanted.length - 1] ?? fights[fights.length - 1];
  const { encounterId, difficulty } = boss;

  // Numbered among all of the boss's pulls, resets included, so the numbers match what the raid counted.
  const ofBoss = fights.filter((f) => f.encounterId === encounterId && f.difficulty === difficulty).sort((a, b) => a.startTime - b.startTime);
  const numbered = ofBoss.map((f, i) => ({ f, number: i + 1 })).filter(({ f }) => f.durationMs >= MIN_PULL_MS).slice(-MAX_PULLS);

  const stored = await getUserPulls(link.code, numbered.map(({ f }) => f.id));
  const toFetch = numbered.filter(({ f }) => !stored.has(f.id));
  if (toFetch.length > 0) {
    try {
      const rl = await api().rateLimit();
      if (rl.limitPerHour - rl.pointsSpentThisHour >= RESERVE_POINTS) {
        const actors = await reportActors(api(), link.code);
        await inBatches(toFetch, PARALLEL, async ({ f }) => {
          const data = await fetchPull(api(), link.code, f, actors);
          await saveUserPull(link.code, f.id, data);
          stored.set(f.id, data);
        });
      }
    } catch (e) {
      if (stored.size === 0) {
        if (GONE.test((e as Error).message)) throw new ReportError("That log is private or doesn't exist. Only public logs can be checked.");
        throw new ReportError("Couldn't read the pulls in that log from Warcraft Logs. Try again in a minute.");
      }
    }
  }
  if (stored.size === 0) throw new ReportError("Warcraft Logs is busy right now. Try again later this hour.");

  const pulls: ReportPull[] = numbered
    .filter(({ f }) => stored.has(f.id))
    .map(({ f, number }) => ({
      fightId: f.id,
      number,
      kill: f.kill,
      durationMs: f.durationMs,
      bossPercent: f.bossPercent,
      phases: f.phases,
      ...stored.get(f.id)!,
    }));
  return { code: link.code, title: report.title, encounterId, difficulty, pulls, missing: numbered.length - pulls.length, bosses };
}
