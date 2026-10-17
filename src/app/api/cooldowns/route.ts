import { COOLDOWNS } from "@/data/cooldowns";
import { castCounts } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * How often each tracked cooldown appears in crawled kills. A spell id that never shows up is
 * probably wrong for the current patch and drops that cooldown from every plan.
 */
export async function GET() {
  const counts = await castCounts();
  return Response.json(
    COOLDOWNS.map((c) => ({ spellId: c.spellId, name: c.name, verified: c.verified, ...(counts.get(c.spellId) ?? { casts: 0, kills: 0 }) })),
  );
}
