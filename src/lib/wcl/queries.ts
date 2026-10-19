import type { KillDamage } from "../types";
import type { WclClient } from "./client";

export interface RankedFight {
  guildId: number;
  guildName: string;
  reportCode: string;
  fightId: number;
  startTime: number;
  durationMs: number;
}

interface FightRankingsJson {
  hasMorePages?: boolean;
  /** Missing when WCL has no page here; the reason, if any, is in `error`. */
  error?: string;
  rankings?: {
    duration: number;
    startTime: number;
    guild: { id: number; name: string };
    report: { code: string; fightID: number };
  }[];
}

/** "speed" ranks the fastest kills; "progress" ranks guilds' first kills in the order they happened. */
export type RankingMetric = "speed" | "progress";

/** Kills on one boss, ranked by the metric. Each page holds up to 100 fights, and the API serves at most 20 pages. */
export async function fightRankings(
  wcl: WclClient,
  encounterId: number,
  difficulty: number,
  page: number,
  metric: RankingMetric = "speed",
  /** Limits rankings to one region, e.g. "US"; each region has its own 20-page cap. */
  region?: string,
) {
  const d = await wcl.query<{ worldData: { encounter: { fightRankings: FightRankingsJson } } }>(
    `query($id: Int!, $difficulty: Int!, $page: Int!, $metric: FightRankingMetricType!, $region: String) {
      worldData { encounter(id: $id) { fightRankings(difficulty: $difficulty, metric: $metric, page: $page, serverRegion: $region) } }
    }`,
    { id: encounterId, difficulty, page, metric, region: region ?? null },
  );
  const json = d.worldData.encounter.fightRankings;
  if (!Array.isArray(json?.rankings)) {
    // Treated as the end of the list; `note` says why so the crawl can log it.
    return { fights: [], hasMorePages: false, note: json?.error ?? JSON.stringify(json).slice(0, 200) };
  }
  // Entries without a public report or guild can't be crawled.
  const fights: RankedFight[] = json.rankings.filter((r) => r.report?.code && r.guild?.id).map((r) => ({
    guildId: r.guild.id,
    guildName: r.guild.name,
    reportCode: r.report.code,
    fightId: r.report.fightID,
    startTime: r.startTime,
    durationMs: r.duration,
  }));
  return { fights, hasMorePages: json.hasMorePages ?? false, note: undefined };
}

export interface ReportSummary {
  code: string;
  startTime: number;
}

/** All of a guild's public reports in a zone, oldest first. */
export async function guildReports(wcl: WclClient, guildId: number, zoneId: number): Promise<ReportSummary[]> {
  const all: ReportSummary[] = [];
  for (let page = 1; ; page++) {
    const d = await wcl.query<{
      reportData: { reports: { data: ReportSummary[]; has_more_pages: boolean } };
    }>(
      `query($guildID: Int!, $zoneID: Int!, $page: Int!) {
        reportData { reports(guildID: $guildID, zoneID: $zoneID, page: $page, limit: 100) {
          data { code startTime } has_more_pages
        } }
      }`,
      { guildID: guildId, zoneID: zoneId, page },
    );
    all.push(...d.reportData.reports.data);
    if (!d.reportData.reports.has_more_pages) break;
  }
  return all.sort((a, b) => a.startTime - b.startTime);
}

export interface BossFight {
  id: number;
  kill: boolean;
  startTime: number;
  endTime: number;
  phaseTransitions: { id: number; startTime: number }[] | null;
}

/** Pulls (kills and wipes) of one boss and difficulty in a report. Fight times are relative to the report start. */
export async function reportPulls(wcl: WclClient, code: string, encounterId: number, difficulty: number) {
  const d = await wcl.query<{
    reportData: { report: { startTime: number; fights: (BossFight & { difficulty: number })[] } };
  }>(
    `query($code: String!, $encounterID: Int!) {
      reportData { report(code: $code) {
        startTime
        fights(encounterID: $encounterID) { id kill difficulty startTime endTime phaseTransitions { id startTime } }
      } }
    }`,
    { code, encounterID: encounterId },
  );
  const r = d.reportData.report;
  return { reportStart: r.startTime, fights: r.fights.filter((f) => f.difficulty === difficulty) };
}

export interface ReportFight extends BossFight {
  encounterID: number;
  difficulty: number | null;
  /** Boss health left at the end of the pull, in percent. */
  bossPercentage: number | null;
}

/** Every boss pull in a report, kills and wipes, with the report's title. Fight times are relative to the report start. */
export async function reportBossFights(wcl: WclClient, code: string) {
  const d = await wcl.query<{
    reportData: { report: { title: string; startTime: number; fights: ReportFight[] } | null };
  }>(
    `query($code: String!) {
      reportData { report(code: $code) {
        title startTime
        fights { id encounterID difficulty kill bossPercentage startTime endTime phaseTransitions { id startTime } }
      } }
    }`,
    { code },
  );
  const r = d.reportData.report;
  if (!r) throw new Error("report does not exist");
  return { title: r.title, startTime: r.startTime, fights: r.fights.filter((f) => f.encounterID > 0) };
}

interface PlayerDetailsJson {
  data: { playerDetails: { healers: { id: number; name: string; type: string; specs?: { spec: string }[] }[] } };
}

/** Healer names and specs in a fight, e.g. { name: "Foo", spec: "RestorationDruid" }. */
export async function fightHealers(wcl: WclClient, code: string, fightId: number) {
  const d = await wcl.query<{ reportData: { report: { playerDetails: PlayerDetailsJson } } }>(
    `query($code: String!, $fightIDs: [Int]!) {
      reportData { report(code: $code) { playerDetails(fightIDs: $fightIDs) } }
    }`,
    { code, fightIDs: [fightId] },
  );
  return d.reportData.report.playerDetails.data.playerDetails.healers.map((h) => ({
    actorId: h.id,
    name: h.name,
    spec: `${h.specs?.[0]?.spec ?? ""}${h.type}`,
  }));
}

export interface RawCast {
  timestamp: number;
  sourceID: number;
  abilityGameID: number;
}

/** Cast events for the given spell ids in one fight, following pagination. */
export async function fightCasts(
  wcl: WclClient,
  code: string,
  fight: { id: number; startTime: number; endTime: number },
  spellIds: number[],
): Promise<RawCast[]> {
  const out: RawCast[] = [];
  let start: number | null = fight.startTime;
  while (start !== null) {
    const d: { reportData: { report: { events: { data: RawCast[]; nextPageTimestamp: number | null } } } } =
      await wcl.query(
        `query($code: String!, $fightIDs: [Int]!, $start: Float!, $end: Float!, $filter: String!) {
          reportData { report(code: $code) {
            events(fightIDs: $fightIDs, startTime: $start, endTime: $end, dataType: Casts, filterExpression: $filter) {
              data nextPageTimestamp
            }
          } }
        }`,
        {
          code,
          fightIDs: [fight.id],
          start,
          end: fight.endTime,
          filter: `ability.id in (${spellIds.join(",")})`,
        },
      );
    out.push(...d.reportData.report.events.data);
    start = d.reportData.report.events.nextPageTimestamp;
  }
  return out;
}

interface GraphSeries {
  name?: string;
  /** The ability's game id when the graph is split by ability. */
  guid?: number;
  pointStart?: number;
  pointInterval?: number;
  /** One value per point, or [timestamp, value] pairs. */
  data?: (number | [number, number] | null)[];
}

/** Damage slices are this long. */
export const DAMAGE_BUCKET_MS = 5_000;
const TOP_ABILITIES = 3;

/**
 * Turns a damage-taken graph split by ability into per-slice totals and the top abilities per slice.
 * Each point is read as a rate over its interval and spread over the slices it overlaps, so the result
 * doesn't depend on the interval Warcraft Logs picked for the graph.
 */
export function toKillDamage(series: GraphSeries[], fight: { startTime: number; endTime: number }, bucketMs = DAMAGE_BUCKET_MS): KillDamage {
  const count = Math.max(1, Math.ceil((fight.endTime - fight.startTime) / bucketMs));
  const byAbility = new Map<number, number[]>();
  const names: Record<number, string> = {};
  for (const s of series) {
    if (typeof s.guid !== "number" || !s.data?.length) continue;
    const interval = s.pointInterval ?? 1_000;
    const amounts = byAbility.get(s.guid) ?? new Array<number>(count).fill(0);
    s.data.forEach((point, j) => {
      if (point === null) return;
      const [t, v] = Array.isArray(point) ? point : [(s.pointStart ?? fight.startTime) + j * interval, point];
      if (!(v > 0)) return;
      const from = t - fight.startTime;
      const to = from + interval;
      for (let b = Math.max(0, Math.floor(from / bucketMs)); b < count && b * bucketMs < to; b++) {
        const overlap = Math.min(to, (b + 1) * bucketMs) - Math.max(from, b * bucketMs);
        if (overlap > 0) amounts[b] += (v * overlap) / 1000;
      }
    });
    byAbility.set(s.guid, amounts);
    if (s.name) names[s.guid] = s.name;
  }
  if (byAbility.size === 0) return { bucketMs, total: [], top: [], names: {} };

  const round = (x: number) => Math.round(x);
  const total = new Array<number>(count).fill(0);
  const top: [number, number][][] = [];
  for (let b = 0; b < count; b++) {
    const hits: [number, number][] = [];
    for (const [id, amounts] of byAbility) {
      total[b] += amounts[b];
      if (amounts[b] > 0) hits.push([id, round(amounts[b])]);
    }
    top.push(hits.sort((a, b) => b[1] - a[1]).slice(0, TOP_ABILITIES));
  }
  const used = new Set(top.flat().map(([id]) => id));
  return {
    bucketMs,
    total: total.map(round),
    top,
    names: Object.fromEntries(Object.entries(names).filter(([id]) => used.has(Number(id)))),
  };
}

/** Damage the raid took in one fight, split by the ability that did it. */
export async function fightDamage(wcl: WclClient, code: string, fight: { id: number; startTime: number; endTime: number }) {
  const d = await wcl.query<{ reportData: { report: { graph: { data?: { series?: GraphSeries[] } } } } }>(
    `query($code: String!, $fightIDs: [Int]!, $start: Float!, $end: Float!) {
      reportData { report(code: $code) {
        graph(fightIDs: $fightIDs, startTime: $start, endTime: $end, dataType: DamageTaken, hostilityType: Friendlies, viewBy: Ability)
      } }
    }`,
    { code, fightIDs: [fight.id], start: fight.startTime, end: fight.endTime },
  );
  const series = d.reportData.report.graph?.data?.series;
  if (!Array.isArray(series)) {
    throw new Error(`Unexpected damage graph shape: ${JSON.stringify(d.reportData.report.graph).slice(0, 200)}`);
  }
  return toKillDamage(series, fight);
}

/** Maps actor ids to player names for a report. */
export async function reportActors(wcl: WclClient, code: string) {
  const d = await wcl.query<{
    reportData: { report: { masterData: { actors: { id: number; name: string }[] } } };
  }>(
    `query($code: String!) { reportData { report(code: $code) { masterData { actors(type: "Player") { id name } } } } }`,
    { code },
  );
  return new Map(d.reportData.report.masterData.actors.map((a) => [a.id, a.name]));
}

/** Boss encounters in a raid zone, in zone order. */
export async function zoneEncounters(wcl: WclClient, zoneId: number) {
  const d = await wcl.query<{ worldData: { zone: { name: string; encounters: { id: number; name: string }[] } | null } }>(
    `query($id: Int!) { worldData { zone(id: $id) { name encounters { id name } } } }`,
    { id: zoneId },
  );
  if (!d.worldData.zone) throw new Error(`Unknown Warcraft Logs zone ${zoneId}`);
  return d.worldData.zone;
}

/** Ability names for a report's spell ids. */
export async function reportAbilities(wcl: WclClient, code: string) {
  const d = await wcl.query<{
    reportData: { report: { masterData: { abilities: { gameID: number; name: string }[] } } };
  }>(`query($code: String!) { reportData { report(code: $code) { masterData { abilities { gameID name } } } } }`, { code });
  return new Map(d.reportData.report.masterData.abilities.map((a) => [a.gameID, a.name]));
}

/** Every cast event by the given actors in one fight, following pagination. Queries one actor at a time with sourceID. */
export async function actorCasts(
  wcl: WclClient,
  code: string,
  fight: { id: number; startTime: number; endTime: number },
  actorIds: number[],
): Promise<RawCast[]> {
  const out: RawCast[] = [];
  for (const sourceID of actorIds) {
    let start: number | null = fight.startTime;
    while (start !== null) {
      const d: { reportData: { report: { events: { data: RawCast[]; nextPageTimestamp: number | null } } } } =
        await wcl.query(
          `query($code: String!, $fightIDs: [Int]!, $start: Float!, $end: Float!, $sourceID: Int!) {
            reportData { report(code: $code) {
              events(fightIDs: $fightIDs, startTime: $start, endTime: $end, dataType: Casts, sourceID: $sourceID) {
                data nextPageTimestamp
              }
            } }
          }`,
          { code, fightIDs: [fight.id], start, end: fight.endTime, sourceID },
        );
      // Some events (begincast, for example) don't carry an ability; keep only real casts.
      out.push(...d.reportData.report.events.data.filter((e) => e.abilityGameID && (e as { type?: string }).type !== "begincast"));
      start = d.reportData.report.events.nextPageTimestamp;
    }
  }
  return out;
}
