import type { Plan } from "./plan";

/** A press this far from every press of the same cooldown in the other plan counts as pressed somewhere else. */
export const SHIFT_MS = 15_000;

type Press = { phaseId: number; tPhaseMs: number };

/** Where a comp presses one cooldown, against where every comp with that spec presses it. */
export interface CompShift {
  yours: Press[];
  every: Press[];
}

const presses = (plan: Plan, spellId: number): Press[] =>
  plan.timings
    .filter((t) => t.spellId === spellId && t.slot === 1)
    .map((t) => ({ phaseId: t.phaseId, tPhaseMs: t.tPhaseMs }))
    .sort((a, b) => a.phaseId - b.phaseId || a.tPhaseMs - b.tPhaseMs);

const unmatched = (from: Press[], to: Press[]) =>
  from.some((p) => !to.some((q) => q.phaseId === p.phaseId && Math.abs(q.tPhaseMs - p.tPhaseMs) <= SHIFT_MS));

/**
 * Healer cooldowns the comp presses somewhere else than every comp does, by spell id.
 * A cooldown counts only when the comp has a press every comp doesn't and every comp has one the comp doesn't,
 * so a press that one plan just keeps and the other just drops doesn't read as a move.
 */
export function compShifts(yours: Plan, every: Plan): Map<number, CompShift> {
  const out = new Map<number, CompShift>();
  const spells = new Set(yours.timings.filter((t) => t.spec !== null && t.slot === 1).map((t) => t.spellId));
  for (const spellId of spells) {
    const shift = { yours: presses(yours, spellId), every: presses(every, spellId) };
    if (shift.every.length > 0 && unmatched(shift.yours, shift.every) && unmatched(shift.every, shift.yours)) out.set(spellId, shift);
  }
  return out;
}
