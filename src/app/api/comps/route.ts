import { listComps } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Healer lineups stored for one boss: `?encounter=3009&difficulty=mythic`. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const encounterId = Number(params.get("encounter"));
  if (!Number.isInteger(encounterId) || encounterId <= 0) return Response.json({ error: "encounter is required" }, { status: 400 });
  return Response.json(await listComps(encounterId, params.get("difficulty") === "heroic" ? "heroic" : "mythic"));
}
