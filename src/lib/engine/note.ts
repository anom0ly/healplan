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
 * When a spec has several players, each line goes to the roster's player with the same number,
 * so the first Resto Druid listed takes Druid #1's presses.
 */
export function toNote(timings: PlannedTiming[], roster: RosterEntry[] = []): string {
  const lines: string[] = [];
  for (const t of timings) {
    const players = t.spec ? roster.filter((r) => r.spec === t.spec) : [];
    const who = players.length > 0 ? `${players[(t.slot - 1) % players.length].name} ` : "";
    const phase = t.phaseId > 1 ? `,p${t.phaseId}` : "";
    lines.push(`{time:${formatTime(t.tPhaseMs)}${phase}} ${who}${t.spellName}`);
  }
  return lines.join("\n");
}
