/**
 * Nightly crawl. Usage:
 *   npm run crawl -- --zone <zoneId> --encounter <encounterId>[,<encounterId>...] [--difficulty mythic,heroic] [--pages 2]
 * Zone and encounter ids are on any Warcraft Logs boss page URL.
 */
import { parseArgs } from "node:util";
import { crawlBoss } from "@/lib/crawl";
import { db, migrate } from "@/lib/db";
import type { Difficulty } from "@/lib/types";
import { WclClient } from "@/lib/wcl/client";

const { values } = parseArgs({
  options: {
    zone: { type: "string" },
    encounter: { type: "string" },
    difficulty: { type: "string", default: "mythic,heroic" },
    pages: { type: "string", default: "2" },
    reserve: { type: "string", default: "300" },
  },
});

if (!values.zone || !values.encounter) {
  console.error("--zone and --encounter are required");
  process.exit(1);
}

async function main() {
  const wcl = new WclClient();
  await migrate();
  for (const encounterId of values.encounter!.split(",").map(Number)) {
    for (const difficulty of values.difficulty!.split(",") as Difficulty[]) {
      const saved = await crawlBoss(wcl, {
        zoneId: Number(values.zone),
        encounterId,
        difficulty,
        pages: Number(values.pages),
        reservePoints: Number(values.reserve),
      });
      console.log(`Encounter ${encounterId} ${difficulty}: ${saved} new kills`);
    }
  }
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
