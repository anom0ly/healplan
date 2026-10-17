/**
 * Nightly crawl. Usage:
 *   npm run crawl -- --zone <zoneId> [--encounter <encounterId>,...] [--difficulty mythic,heroic] [--pages 2] [--metrics progress,speed]
 * --pages limits the speed crawl only; the progress crawl resumes where the last run stopped and walks to the end,
 * once per region in --regions (default US,EU,KR,TW,CN), because the API serves at most 20 pages of any ranking.
 * The zone id is in the raid's Warcraft Logs URL (warcraftlogs.com/zone/rankings/<zoneId>).
 * Without --encounter, every boss in the zone is crawled.
 * "progress" crawls guilds' first kills (cheap: one ranking entry is one first kill) and runs first, for every boss,
 * before "speed" fills in recent kills.
 */
import { parseArgs } from "node:util";
import { crawlBoss } from "@/lib/crawl";
import { db, migrate } from "@/lib/db";
import type { Difficulty } from "@/lib/types";
import type { RankingMetric } from "@/lib/wcl/queries";
import { WclClient } from "@/lib/wcl/client";
import { zoneEncounters } from "@/lib/wcl/queries";

const { values } = parseArgs({
  options: {
    zone: { type: "string" },
    encounter: { type: "string" },
    difficulty: { type: "string", default: "mythic,heroic" },
    pages: { type: "string", default: "2" },
    metrics: { type: "string", default: "progress,speed" },
    regions: { type: "string", default: "US,EU,KR,TW,CN" },
    reserve: { type: "string", default: "300" },
  },
});

if (!values.zone) {
  console.error("--zone is required");
  process.exit(1);
}

async function main() {
  const wcl = new WclClient();
  await migrate();
  let encounterIds = values.encounter?.split(",").map(Number);
  if (!encounterIds) {
    const zone = await zoneEncounters(wcl, Number(values.zone));
    console.log(`${zone.name}: ${zone.encounters.map((e) => `${e.name} (${e.id})`).join(", ")}`);
    encounterIds = zone.encounters.map((e) => e.id);
  }
  const before = await wcl.rateLimit();
  run: for (const metric of values.metrics!.split(",") as RankingMetric[]) {
    for (const encounterId of encounterIds) {
      for (const difficulty of values.difficulty!.split(",") as Difficulty[]) {
        // Rankings stop at 20 pages, so progress is crawled region by region to reach more guilds' first kills.
        for (const region of metric === "progress" ? values.regions!.split(",") : [undefined]) {
          const { saved, stopped } = await crawlBoss(wcl, {
            zoneId: Number(values.zone),
            encounterId,
            difficulty,
            metric,
            region,
            pages: Number(values.pages),
            reservePoints: Number(values.reserve),
          });
          console.log(`Encounter ${encounterId} ${difficulty} ${metric}${region ? ` ${region}` : ""}: ${saved} new kills`);
          if (stopped) break run;
        }
      }
    }
  }
  const after = await wcl.rateLimit();
  // The hour can roll over mid-run, which resets the counter.
  const used = after.pointsSpentThisHour >= before.pointsSpentThisHour ? after.pointsSpentThisHour - before.pointsSpentThisHour : after.pointsSpentThisHour;
  console.log(`Warcraft Logs points: ${used} used this run, ${after.pointsSpentThisHour}/${after.limitPerHour} this hour`);
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
