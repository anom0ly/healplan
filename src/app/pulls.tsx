"use client";

import { useEffect, useRef, useState } from "react";
import { toPhaseTime } from "@/lib/engine/cluster";
import type { Comparison, Mark, PlanLine, PullResult } from "@/lib/engine/compare";
import { formatTime } from "@/lib/engine/note";
import { HEALER_SPECS, SPEC_CLASS, type ReportPull } from "@/lib/types";

/** CSS class that sets a healer's color to their WoW class color. */
const classTone = (line: Pick<PlanLine, "spec">) => `hm-c-${SPEC_CLASS[line.spec].toLowerCase()}`;

const outcome = (p: ReportPull) => (p.kill ? "Kill" : `Wipe ${formatTime(p.durationMs)}`);
const verdictClass = (m: Mark) => `pv-${m.verdict}`;
const secs = (ms: number) => `${Math.round(Math.abs(ms) / 1000)}s`;

/** What happened to one planned press, in a few words. */
function verdictText(m: Mark): string {
  switch (m.verdict) {
    case "on":
      return "On time";
    case "early":
      return `${secs(m.deltaMs!)} early`;
    case "late":
      return `${secs(m.deltaMs!)} late`;
    case "missed":
      return "Missed";
    default:
      return "Pull ended first";
  }
}

/** "P2 0:40", or "0:40" for a boss with one phase. */
const whenText = (phaseId: number, tPhaseMs: number, single: boolean) => (single ? formatTime(tPhaseMs) : `P${phaseId} ${formatTime(tPhaseMs)}`);
const whenLong = (phaseId: number, tPhaseMs: number, single: boolean) =>
  single ? formatTime(tPhaseMs) : `Phase ${phaseId} · ${formatTime(tPhaseMs)}`;

/** Raid damage at a moment of the pull against the pull's own average, e.g. 2.4. */
function damageRatio(pull: ReportPull, atMs: number): number | null {
  const d = pull.damage;
  if (!d || d.total.length === 0) return null;
  const mean = d.total.reduce((a, b) => a + b, 0) / d.total.length;
  const v = d.total[Math.min(d.total.length - 1, Math.floor(atMs / d.bucketMs))];
  return mean > 0 ? v / mean : null;
}

function SpellLink({ id, name }: { id: number; name: string }) {
  return (
    <a className="wh" href={`https://www.wowhead.com/spell=${id}`} target="_blank" rel="noopener noreferrer">
      {name}
    </a>
  );
}

/** The lines of a press's details, shared by desktop tooltips and the phone sheet. */
function MarkDetails({ line, mark, pull, single }: { line: PlanLine; mark: Mark; pull: ReportPull; single: boolean }) {
  const pressed = mark.pressedMs !== null ? toPhaseTime(mark.pressedMs, pull.phases) : null;
  const ratio = damageRatio(pull, mark.pressedMs ?? mark.plannedMs ?? -1);
  return (
    <>
      <div className="pv-tip-row">
        <span className="hm-tip-muted">Plan</span>
        <span className="hm-mono">{whenLong(line.phaseId, line.tPhaseMs, single)}</span>
      </div>
      <div className="pv-tip-row">
        <span className="hm-tip-muted">Pressed</span>
        <span className="hm-mono">{pressed ? whenLong(pressed.phaseId, pressed.tPhaseMs, single) : "Not pressed"}</span>
      </div>
      <div className={`pv-verdict-text ${verdictClass(mark)}`}>{verdictText(mark)}</div>
      {ratio !== null && mark.verdict !== "unreached" && (
        <div className="hm-tip-rule hm-tip-muted">
          Raid damage then <span className="hm-tip-strong">{ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}×</span> this pull&apos;s average
        </div>
      )}
    </>
  );
}

const legend = (
  <div className="pv-legend">
    <span>
      <span className="pv-key pv-key-on" aria-hidden="true" />
      On time
    </span>
    <span>
      <span className="pv-key pv-key-off" aria-hidden="true" />
      Off by more than 5s
    </span>
    <span>
      <span className="pv-key pv-key-missed" aria-hidden="true">
        ×
      </span>
      Missed
    </span>
    <span>
      <span className="pv-key pv-key-unreached" aria-hidden="true" />
      Pull ended first
    </span>
  </div>
);

type Tip = { li: number; pi: number; x: number; y: number } | null;

/** Every pull against every planned press: planned presses down the side, pulls across, oldest to newest. */
export function PullsOverview({ comparison, pullHref, single }: { comparison: Comparison; pullHref: string; single: boolean }) {
  const { lines, pulls } = comparison;
  const [tip, setTip] = useState<Tip>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Newest pulls are on the right, so start scrolled there.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, []);

  if (lines.length === 0) return <p className="muted">No planned cooldowns for this comp yet, so there&apos;s nothing to compare.</p>;
  const onTime = pulls.reduce((s, p) => s + p.onTime, 0);
  const judged = pulls.reduce((s, p) => s + p.judged, 0);
  const kills = pulls.filter((p) => p.pull.kill).length;

  const show = (li: number, pi: number) => (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ li, pi, x: r.left + r.width / 2, y: r.top });
  };

  return (
    <section aria-label="Every pull against the plan" className="pv">
      <div className="pv-summary">
        <span>
          <strong>
            {pulls.length} {pulls.length === 1 ? "pull" : "pulls"}
          </strong>
          {kills > 0 && ` · ${kills} ${kills === 1 ? "kill" : "kills"}`}
          {judged > 0 && (
            <>
              {" "}
              · planned cooldowns on time <strong>{Math.round((onTime / judged) * 100)}%</strong> of the time
            </>
          )}
        </span>
        {legend}
      </div>
      <div className="pv-scroll" ref={scroller} onScroll={() => setTip(null)}>
        <table className="pv-grid">
          <thead>
            <tr>
              <th scope="col" className="pv-line-head">
                Planned cooldown
              </th>
              {pulls.map((p) => (
                <th key={p.pull.fightId} scope="col">
                  <a href={`${pullHref}${p.pull.number}`} className="pv-pull-head">
                    <strong>#{p.pull.number}</strong>
                    <span className={p.pull.kill ? "pv-kill" : "muted"}>{p.pull.kill ? "Kill" : formatTime(p.pull.durationMs)}</span>
                  </a>
                </th>
              ))}
              <th scope="col" className="pv-rate-head">
                On time
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, li) => {
              const marks = pulls.map((p) => p.marks[li]);
              const lineJudged = marks.filter((m) => m.verdict !== "unreached").length;
              const lineOn = marks.filter((m) => m.verdict === "on").length;
              const weak = lineJudged >= 3 && lineOn / lineJudged < 0.6;
              return (
                <tr key={li} className={weak ? "pv-weak" : undefined}>
                  <th scope="row" className={`pv-line ${classTone(line)}`}>
                    <span className="hm-dot" aria-hidden="true" />
                    <span className="pv-line-name">
                      <SpellLink id={line.spellId} name={line.spellName} />
                    </span>
                    <span className="muted pv-line-who">
                      {line.group} · {whenText(line.phaseId, line.tPhaseMs, single)}
                    </span>
                  </th>
                  {pulls.map((p, pi) => {
                    const m = p.marks[li];
                    return (
                      <td key={p.pull.fightId}>
                        <a
                          href={`${pullHref}${p.pull.number}`}
                          className={`pv-cell ${verdictClass(m)}`}
                          aria-label={`${line.spellName}, ${line.group}, pull ${p.pull.number}: ${verdictText(m)}`}
                          onMouseEnter={show(li, pi)}
                          onFocus={show(li, pi)}
                          onMouseLeave={() => setTip(null)}
                          onBlur={() => setTip(null)}
                        >
                          {m.verdict === "missed" ? "×" : ""}
                        </a>
                      </td>
                    );
                  })}
                  <td className="pv-rate">
                    {lineOn}/{lineJudged}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {tip && <OverviewTip line={lines[tip.li]} result={pulls[tip.pi]} li={tip.li} x={tip.x} y={tip.y} single={single} />}
    </section>
  );
}

function OverviewTip({ line, result, li, x, y, single }: { line: PlanLine; result: PullResult; li: number; x: number; y: number; single: boolean }) {
  return (
    <div className="hm-tip pv-float" style={{ left: x, top: y }}>
      <div className="hm-tip-title">
        {line.spellName} <span className="hm-tip-muted">· {line.player ?? line.group} · pull {result.pull.number}</span>
      </div>
      <div className="hm-tip-rule">
        <MarkDetails line={line} mark={result.marks[li]} pull={result.pull} single={single} />
      </div>
    </div>
  );
}

/** One row of the pull view: a healer's cooldown, with every planned press of it and every press made. */
interface DetailRow {
  key: string;
  line: PlanLine;
  /** Indexes into the comparison's lines. */
  lineIdx: number[];
  extras: number[];
}

interface DetailGroup {
  group: string;
  player: string | null;
  tone: string;
  rows: DetailRow[];
}

function detailGroups(lines: PlanLine[], result: PullResult): DetailGroup[] {
  const groups: DetailGroup[] = [];
  lines.forEach((line, i) => {
    let g = groups.find((x) => x.group === line.group);
    if (!g) groups.push((g = { group: line.group, player: line.player, tone: classTone(line), rows: [] }));
    const key = `${line.spellId}#${line.slot}`;
    const row = g.rows.find((r) => r.key === key);
    if (row) row.lineIdx.push(i);
    else g.rows.push({ key, line, lineIdx: [i], extras: [] });
  });
  for (const e of result.extras) {
    const row = groups.flatMap((g) => g.rows).find((r) => r.key === `${e.spellId}#${e.slot}`);
    row?.extras.push(e.pressedMs);
  }
  // Healers in the site's usual spec order, #1 before #2.
  groups.sort((a, b) => {
    const [la, lb] = [a.rows[0].line, b.rows[0].line];
    return HEALER_SPECS.indexOf(la.spec) - HEALER_SPECS.indexOf(lb.spec) || la.slot - lb.slot;
  });
  for (const g of groups) g.rows.sort((a, b) => a.line.spellName.localeCompare(b.line.spellName));
  return groups;
}

/** Pull buttons, newest first. */
function PullPicker({ pulls, selected, pullHref }: { pulls: PullResult[]; selected: number; pullHref: string }) {
  return (
    <nav className="pv-pulls" aria-label="Pulls">
      {[...pulls].reverse().map((p) => {
        const share = p.judged > 0 ? p.onTime / p.judged : 1;
        return (
          <a
            key={p.pull.fightId}
            href={`${pullHref}${p.pull.number}`}
            className={`pv-pull${p.pull.number === selected ? " pv-pull-on" : ""}`}
            aria-current={p.pull.number === selected ? "page" : undefined}
          >
            <strong>#{p.pull.number}</strong>
            <span className={p.pull.kill ? "pv-kill" : "muted"}>{outcome(p.pull)}</span>
            <span className="pv-bar" aria-label={`${p.onTime} of ${p.judged} on time`}>
              <span className={share >= 0.8 ? "pv-bar-good" : share >= 0.6 ? "pv-bar-mid" : "pv-bar-low"} style={{ width: `${share * 100}%` }} />
            </span>
          </a>
        );
      })}
    </nav>
  );
}

const pct = (ms: number, axisMs: number) => `${(ms / axisMs) * 100}%`;

/** The phases of one pull, from its own phase changes. */
function pullPhases(pull: ReportPull, axisMs: number) {
  const phases = [{ id: 1, startMs: 0 }, ...pull.phases.filter((p) => p.id !== 1)].sort((a, b) => a.startMs - b.startMs);
  return phases.map((p, i) => ({ id: p.id, startMs: p.startMs, endMs: i + 1 < phases.length ? phases[i + 1].startMs : Math.max(pull.durationMs, p.startMs) })).filter((p) => p.startMs < axisMs);
}

/** One pull against the plan: each planned press as a 10-second window, with a dot where it was actually pressed. */
export function PullDetail(props: { comparison: Comparison; selected: number; pullHref: string; axisMs: number; single: boolean }) {
  const { comparison, single } = props;
  const result = comparison.pulls.find((p) => p.pull.number === props.selected) ?? comparison.pulls[comparison.pulls.length - 1];
  if (!result) return null;
  if (comparison.lines.length === 0) return <p className="muted">No planned cooldowns for this comp yet, so there&apos;s nothing to compare.</p>;
  const pull = result.pull;
  return (
    <section aria-label={`Pull ${pull.number} against the plan`} className="pv">
      <PullPicker pulls={comparison.pulls} selected={pull.number} pullHref={props.pullHref} />
      <div className="pv-summary">
        <span>
          <strong>Pull {pull.number}</strong> · {pull.kill ? "kill" : `wipe at ${formatTime(pull.durationMs)}`}
          {!pull.kill && pull.bossPercent !== null && <span className="muted"> (boss at {Math.round(pull.bossPercent)}%)</span>}
          {result.judged > 0 && (
            <>
              {" "}
              · <strong>
                {result.onTime} of {result.judged}
              </strong>{" "}
              on time
            </>
          )}
        </span>
      </div>
      <DesktopPull result={result} lines={comparison.lines} axisMs={Math.max(props.axisMs, pull.durationMs)} single={single} />
      <PhonePull result={result} lines={comparison.lines} single={single} />
    </section>
  );
}

type Hover = { kind: "mark"; li: number } | { kind: "extra"; row: string; at: number } | null;

function DesktopPull({ result, lines, axisMs, single }: { result: PullResult; lines: PlanLine[]; axisMs: number; single: boolean }) {
  const [hover, setHover] = useState<Hover>(null);
  const pull = result.pull;
  const groups = detailGroups(lines, result);
  const phases = pullPhases(pull, axisMs);
  const ended = pull.durationMs < axisMs;
  const d = pull.damage && pull.damage.total.length > 0 ? pull.damage : null;
  const maxDamage = d ? Math.max(...d.total, 1) : 1;
  const step = axisMs > 480_000 ? 60_000 : 30_000;
  const ticks: number[] = [];
  for (let t = 0; t <= axisMs; t += step) ticks.push(t);

  const backdrop = (
    <>
      <div className="pv-track-bg" />
      {phases.slice(1).map((p) => (
        <div key={p.id} className="pv-phase-line" style={{ left: pct(p.startMs, axisMs) }} />
      ))}
      {ended && <div className="pv-ended" style={{ left: pct(pull.durationMs, axisMs) }} />}
    </>
  );

  return (
    <div className="hm-desktop">
      {legend}
      <div className="hm-card pv-card" onMouseLeave={() => setHover(null)}>
        <div className="hm-row hm-head">
          <div />
          <div className="hm-track hm-phase-names">
            {phases.map((p, i) => (
              <div key={p.id} className={i > 0 ? "hm-phase-break" : ""} style={{ left: pct(p.startMs, axisMs), width: pct(Math.min(p.endMs, axisMs) - p.startMs, axisMs) }}>
                <strong>{single ? "Whole fight" : `Phase ${p.id}`}</strong>
                <span className="muted">
                  {formatTime(p.startMs)}–{formatTime(p.endMs)}
                </span>
              </div>
            ))}
            {ended && (
              <div className="pv-ended-label" style={{ left: pct(pull.durationMs, axisMs) }}>
                {pull.kill ? "Kill" : `Wipe ${formatTime(pull.durationMs)}`}
              </div>
            )}
          </div>
        </div>

        {d && (
          <div className="hm-row hm-dmg">
            <div className="hm-label">
              <strong>Raid damage</strong>
            </div>
            <div className="hm-track">
              <div className="pv-bars">
                {d.total.map((v, i) => (
                  <span key={i} style={{ left: pct(i * d.bucketMs, axisMs), width: `calc(${pct(d.bucketMs, axisMs)} - 1px)`, height: `${(v / maxDamage) * 100}%` }} />
                ))}
              </div>
              {ended && <div className="pv-ended" style={{ left: pct(pull.durationMs, axisMs) }} />}
            </div>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.group} className={g.tone}>
            <div className="hm-row">
              <div className="hm-group">
                <span className="hm-dot" aria-hidden="true" />
                {g.group}
                {g.player && <span className="muted hm-kind">{g.player}</span>}
              </div>
              <div />
            </div>
            {g.rows.map((row) => (
              <div key={row.key} className="hm-row">
                <div className="hm-label">
                  <SpellLink id={row.line.spellId} name={row.line.spellName} />
                </div>
                <div className="hm-track">
                  {backdrop}
                  {row.lineIdx.map((li) => {
                    const m = result.marks[li];
                    if (m.plannedMs === null || m.plannedMs > axisMs) return null;
                    const on = hover?.kind === "mark" && hover.li === li;
                    const from = m.pressedMs === null ? m.plannedMs : Math.min(m.plannedMs, m.pressedMs);
                    const to = m.pressedMs === null ? m.plannedMs : Math.max(m.plannedMs, m.pressedMs);
                    return (
                      <div key={li}>
                        <div
                          className={`pv-window pv-window-${m.verdict}`}
                          style={{ left: pct(m.plannedMs - 5_000, axisMs), width: pct(10_000, axisMs) }}
                          onMouseEnter={() => setHover({ kind: "mark", li })}
                        >
                          {m.verdict === "missed" ? "×" : ""}
                        </div>
                        {(m.verdict === "early" || m.verdict === "late") && (
                          <div className="pv-link" style={{ left: pct(from, axisMs), width: pct(to - from, axisMs) }} />
                        )}
                        {m.pressedMs !== null && (
                          <button
                            type="button"
                            className={`pv-dot ${verdictClass(m)}${on ? " pv-dot-on" : ""}`}
                            style={{ left: pct(m.pressedMs, axisMs) }}
                            aria-label={`${row.line.spellName}: ${verdictText(m)}`}
                            onMouseEnter={() => setHover({ kind: "mark", li })}
                            onFocus={() => setHover({ kind: "mark", li })}
                          />
                        )}
                        {on && (
                          <div className="hm-tip" style={{ left: pct(m.pressedMs ?? m.plannedMs, axisMs), transform: "translateX(-50%)" }}>
                            <div className="hm-tip-title">
                              <SpellLink id={row.line.spellId} name={row.line.spellName} />{" "}
                              <span className="hm-tip-muted">· {g.player ?? g.group}</span>
                            </div>
                            <div className="hm-tip-rule">
                              <MarkDetails line={lines[li]} mark={m} pull={pull} single={single} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {row.extras.map((at) => {
                    const on = hover?.kind === "extra" && hover.row === row.key && hover.at === at;
                    const t = toPhaseTime(at, pull.phases);
                    return (
                      <div key={`x${at}`}>
                        <button
                          type="button"
                          className="pv-dot pv-extra"
                          style={{ left: pct(at, axisMs) }}
                          aria-label={`${row.line.spellName}: pressed outside the plan`}
                          onMouseEnter={() => setHover({ kind: "extra", row: row.key, at })}
                          onFocus={() => setHover({ kind: "extra", row: row.key, at })}
                        />
                        {on && (
                          <div className="hm-tip" style={{ left: pct(at, axisMs), transform: "translateX(-50%)" }}>
                            <div className="hm-tip-title">{row.line.spellName}</div>
                            <div className="pv-tip-row">
                              <span className="hm-tip-muted">Pressed</span>
                              <span className="hm-mono">{whenLong(t.phaseId, t.tPhaseMs, single)}</span>
                            </div>
                            <div className="hm-tip-muted">Not in the plan</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}

        <div className="hm-row hm-axis">
          <div className="muted">Pull time</div>
          <div className="hm-track">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t, axisMs) }}>
                {formatTime(t)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Phones: a tab per phase the pull reached, listing that phase's planned presses in time order. Tap one for details. */
function PhonePull({ result, lines, single }: { result: PullResult; lines: PlanLine[]; single: boolean }) {
  const pull = result.pull;
  const phaseIds = [...new Set(lines.map((l) => l.phaseId))].sort((a, b) => a - b);
  const reachedIds = phaseIds.filter((id) => result.marks.some((m, i) => lines[i].phaseId === id && m.plannedMs !== null));
  const [phaseId, setPhaseId] = useState(reachedIds[reachedIds.length - 1] ?? phaseIds[0]);
  const [picked, setPicked] = useState<number | null>(null);
  const inPhase = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.phaseId === phaseId);
  const count = (id: number) => {
    const ms = lines.map((l, i) => ({ l, m: result.marks[i] })).filter(({ l, m }) => l.phaseId === id && m.verdict !== "unreached");
    return { on: ms.filter(({ m }) => m.verdict === "on").length, judged: ms.length };
  };
  const counts = { off: 0, missed: 0 };
  for (const m of result.marks) {
    if (m.verdict === "early" || m.verdict === "late") counts.off++;
    if (m.verdict === "missed") counts.missed++;
  }

  // Damage over this phase of the pull.
  const span = pullPhases(pull, Infinity).find((p) => p.id === phaseId);
  const d = pull.damage && pull.damage.total.length > 0 ? pull.damage : null;
  const bars =
    d && span
      ? d.total.map((v, i) => ({ v, at: i * d.bucketMs })).filter(({ at }) => at >= span.startMs && at < span.endMs)
      : [];
  const maxDamage = d ? Math.max(...d.total, 1) : 1;
  const pickedLine = picked !== null ? lines[picked] : null;

  return (
    <div className={`hm-phone${pickedLine ? " hm-sheet-open" : ""}`}>
      <div className="pv-phone-counts">
        <span className="pv-count">
          <span className="pv-key pv-key-off" aria-hidden="true" />
          {counts.off} off
        </span>
        <span className="pv-count">
          <span className="pv-key pv-key-missed" aria-hidden="true">
            ×
          </span>
          {counts.missed} missed
        </span>
      </div>
      {phaseIds.length > 1 && (
        <div className="hm-tabs" role="tablist" aria-label="Phase">
          {phaseIds.map((id) => {
            const c = count(id);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === phaseId}
                className={id === phaseId ? "hm-tab-on" : ""}
                onClick={() => {
                  setPhaseId(id);
                  setPicked(null);
                }}
              >
                <strong>Phase {id}</strong>
                <span>{c.judged > 0 ? `${c.on} of ${c.judged}` : "Not reached"}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="hm-card">
        {bars.length > 0 && (
          <div className="hm-phone-dmg">
            <div className="hm-phone-bars" aria-hidden="true">
              {bars.map(({ v, at }) => (
                <button key={at} type="button" tabIndex={-1}>
                  <span style={{ height: `${(v / maxDamage) * 100}%` }} />
                </button>
              ))}
            </div>
            <div className="pv-phone-dmg-label hm-mono">
              <span>{formatTime(0)}</span>
              <span>Raid damage</span>
              <span>{formatTime(span!.endMs - span!.startMs)}</span>
            </div>
          </div>
        )}
        {inPhase.map(({ l, i }) => {
          const m = result.marks[i];
          return (
            <button
              key={i}
              type="button"
              className={`pv-item ${classTone(l)}${picked === i ? " pv-item-on" : ""}`}
              onClick={() => setPicked(i)}
            >
              <span className="hm-mono muted pv-item-time">{formatTime(l.tPhaseMs)}</span>
              <span className={`pv-icon ${verdictClass(m)}`} aria-hidden="true">
                {m.verdict === "missed" ? "×" : ""}
              </span>
              <span className="pv-item-name">
                <span>{l.spellName}</span>
                <span className="muted pv-item-who">
                  <span className="hm-dot" aria-hidden="true" />
                  {l.group}
                </span>
              </span>
              <span className={`pv-item-verdict ${verdictClass(m)}`}>{m.verdict === "on" ? "On time" : verdictText(m)}</span>
            </button>
          );
        })}
      </div>
      {legend}
      {pickedLine && picked !== null && (
        <div className="hm-sheet" role="dialog" aria-label={`${pickedLine.spellName} details`}>
          <div className="hm-sheet-head">
            <div>
              <div className="hm-tip-title">
                <SpellLink id={pickedLine.spellId} name={pickedLine.spellName} />
              </div>
              <div className="hm-tip-muted">{pickedLine.player ? `${pickedLine.group} · ${pickedLine.player}` : pickedLine.group}</div>
            </div>
            <button type="button" aria-label="Close details" onClick={() => setPicked(null)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </div>
          <MarkDetails line={pickedLine} mark={result.marks[picked]} pull={pull} single={single} />
        </div>
      )}
    </div>
  );
}
