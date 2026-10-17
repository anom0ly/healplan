import type { HealerSpec } from "@/lib/types";
import type { PlannedTiming } from "./plan";

export interface RosterEntry {
  name: string;
  spec: HealerSpec;
}

export const formatTime = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Exports timings as MRT-style timer lines: `{time:2:14,p2} Name Tranquility`.
 * When a spec has several players, its casts of each spell alternate between them.
 */
export function toNote(timings: PlannedTiming[], roster: RosterEntry[] = []): string {
  const turn = new Map<string, number>();
  const lines: string[] = [];
  for (const t of timings) {
    const players = t.spec ? roster.filter((r) => r.spec === t.spec) : [];
    let who = "";
    if (players.length > 0) {
      const key = `${t.spec}:${t.spellId}`;
      const i = turn.get(key) ?? 0;
      who = `${players[i % players.length].name} `;
      turn.set(key, i + 1);
    }
    const phase = t.phaseId > 1 ? `,p${t.phaseId}` : "";
    lines.push(`{time:${formatTime(t.tPhaseMs)}${phase}} ${who}${t.spellName}`);
  }
  return lines.join("\n");
}
