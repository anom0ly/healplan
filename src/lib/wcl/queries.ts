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
  hasMorePages: boolean;
  rankings: {
    duration: number;
    startTime: number;
    guild: { id: number; name: string };
    report: { code: string; fightID: number };
  }[];
}

/** Kills on one boss, ranked by speed. Each page holds up to 100 fights. */
export async function fightRankings(wcl: WclClient, encounterId: number, difficulty: number, page: number) {
  const d = await wcl.query<{ worldData: { encounter: { fightRankings: FightRankingsJson } } }>(
    `query($id: Int!, $difficulty: Int!, $page: Int!) {
      worldData { encounter(id: $id) { fightRankings(difficulty: $difficulty, metric: speed, page: $page) } }
    }`,
    { id: encounterId, difficulty, page },
  );
  const json = d.worldData.encounter.fightRankings;
  const fights: RankedFight[] = json.rankings.map((r) => ({
    guildId: r.guild.id,
    guildName: r.guild.name,
    reportCode: r.report.code,
    fightId: r.report.fightID,
    startTime: r.startTime,
    durationMs: r.duration,
  }));
  return { fights, hasMorePages: json.hasMorePages };
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

interface PlayerDetailsJson {
  data: { playerDetails: { healers: { name: string; type: string; specs?: { spec: string }[] }[] } };
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
