/**
 * Adds casts of newly listed cooldowns to kills crawled before they were in src/data/cooldowns.ts. Usage:
 *   npm run backfill -- --spec DisciplinePriest --spells 472433,421453 [--limit 500] [--reserve 300]
 * Only kills with a healer of --spec and none of --spells stored are read, newest first, so re-running carries on
 * where the last run stopped. Stops early when the hour's Warcraft Logs points fall to --reserve.
 */
import { parseArgs } from "node:util";
import { overBudget } from "@/lib/crawl";
import { db, killsMissingSpells, replaceSpellCasts } from "@/lib/db";
import { DIFFICULTY_ID, type HealerSpec } from "@/lib/types";
import { WclClient } from "@/lib/wcl/client";
import { fightCasts, reportActors, reportPulls } from "@/lib/wcl/queries";

const { values } = parseArgs({
  options: {
    spec: { type: "string" },
    spells: { type: "string" },
    limit: { type: "string", default: "500" },
    reserve: { type: "string", default: "300" },
  },
});

if (!values.spec || !values.spells) {
  console.error("--spec and --spells are required");
  process.exit(1);
}

async function main() {
  const wcl = new WclClient();
  const spec = values.spec as HealerSpec;
  const spellIds = values.spells!.split(",").map(Number);
  const kills = await killsMissingSpells(spec, spellIds, Number(values.limit));
  console.log(`${kills.length} ${spec} kills to backfill with ${spellIds.join(", ")}`);
  const before = await wcl.rateLimit();
  let done = 0;

  for (const k of kills) {
    if (await overBudget(wcl, Number(values.reserve))) break;
    const { fights } = await reportPulls(wcl, k.reportCode, k.encounterId, DIFFICULTY_ID[k.difficulty]);
    const fight = fights.find((f) => f.id === k.fightId);
    if (!fight) {
      console.log(`Skipped ${k.reportCode}#${k.fightId}: fight not found`);
      continue;
    }
    const actors = await reportActors(wcl, k.reportCode);
    const raw = await fightCasts(wcl, k.reportCode, fight, spellIds);
    // These are spec-only spells, so whoever cast them is the --spec healer.
    await replaceSpellCasts(
      k.reportCode,
      k.fightId,
      spellIds,
      raw.map((c) => ({
        spellId: c.abilityGameID,
        source: actors.get(c.sourceID) ?? `#${c.sourceID}`,
        sourceSpec: spec,
        timestampMs: c.timestamp - fight.startTime,
      })),
    );
    done++;
    console.log(`Backfilled ${k.reportCode}#${k.fightId}: ${raw.length} casts`);
  }

  const after = await wcl.rateLimit();
  console.log(`Backfilled ${done} of ${kills.length} kills, ${after.pointsSpentThisHour - before.pointsSpentThisHour} points used`);
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
