/**
 * Lists what each healer spec actually casts in a few stored kills, to find the right spell ids for
 * src/data/cooldowns.ts. Usage:
 *   npm run spells -- --encounter <encounterId> [--difficulty mythic] [--kills 5] [--spec DisciplinePriest]
 * Only spells cast a few times per kill are listed, since cooldowns are cast rarely and fillers often.
 */
import { parseArgs } from "node:util";
import { db, loadKills } from "@/lib/db";
import type { Difficulty, HealerSpec } from "@/lib/types";
import { WclClient } from "@/lib/wcl/client";
import { actorCasts, fightHealers, reportAbilities, reportPulls } from "@/lib/wcl/queries";
import { DIFFICULTY_ID } from "@/lib/types";

const { values } = parseArgs({
  options: {
    encounter: { type: "string" },
    difficulty: { type: "string", default: "mythic" },
    kills: { type: "string", default: "5" },
    "max-per-kill": { type: "string", default: "6" },
    // Only kills with this healer spec, and only its spells, e.g. DisciplinePriest.
    spec: { type: "string" },
  },
});

if (!values.encounter) {
  console.error("--encounter is required");
  process.exit(1);
}

async function main() {
  const wcl = new WclClient();
  const difficulty = values.difficulty as Difficulty;
  const spec = values.spec as HealerSpec | undefined;
  const kills = (await loadKills(Number(values.encounter), difficulty))
    .filter((k) => !spec || k.healers.includes(spec))
    .slice(0, Number(values.kills));
  // spec -> spell id -> totals
  const bySpec = new Map<string, Map<number, { name: string; casts: number; kills: Set<string> }>>();
  const healersPerSpec = new Map<string, number>();

  for (const k of kills) {
    const { fights } = await reportPulls(wcl, k.reportCode, k.encounterId, DIFFICULTY_ID[difficulty]);
    const fight = fights.find((f) => f.id === k.fightId);
    if (!fight) continue;
    const healers = (await fightHealers(wcl, k.reportCode, k.fightId)).filter((h) => !spec || h.spec === spec);
    const specById = new Map(healers.map((h) => [h.actorId, h.spec]));
    for (const h of healers) healersPerSpec.set(h.spec, (healersPerSpec.get(h.spec) ?? 0) + 1);
    const names = await reportAbilities(wcl, k.reportCode);
    const casts = await actorCasts(wcl, k.reportCode, fight, [...specById.keys()]);
    for (const c of casts) {
      const spec = specById.get(c.sourceID)!;
      const spells = bySpec.get(spec) ?? new Map();
      const s = spells.get(c.abilityGameID) ?? { name: names.get(c.abilityGameID) ?? "?", casts: 0, kills: new Set<string>() };
      s.casts++;
      s.kills.add(`${k.reportCode}#${k.fightId}`);
      spells.set(c.abilityGameID, s);
      bySpec.set(spec, spells);
    }
    console.log(`Read ${k.guildName} ${k.reportCode}#${k.fightId}: ${healers.length} healers, ${casts.length} casts`);
  }

  if (bySpec.size === 0) console.log("No healer casts found in these kills.");
  for (const [spec, spells] of bySpec) {
    const healers = healersPerSpec.get(spec) ?? 1;
    console.log(`${spec} (${healers} healers across ${kills.length} kills)`);
    [...spells.entries()]
      .map(([id, s]) => ({ id, ...s, perHealer: s.casts / healers }))
      .filter((s) => s.perHealer <= Number(values["max-per-kill"]))
      .sort((a, b) => b.kills.size - a.kills.size || b.casts - a.casts)
      .slice(0, 25)
      .forEach((s) => console.log(`  ${s.id} | ${s.name} | ${s.casts} casts, ${s.perHealer.toFixed(1)} per healer, in ${s.kills.size} kills`));
  }
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
