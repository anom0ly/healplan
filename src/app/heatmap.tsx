"use client";

import { useState } from "react";
import { formatTime } from "@/lib/engine/note";
import type { HeatSlice, Timeline, TimelinePhase, TimelineRow } from "@/lib/engine/timeline";

/** Heat level 0 to 4 for a share of kills; fixed steps so the same shade means the same share everywhere. */
const level = (share: number) => (share <= 0 ? 0 : share < 0.15 ? 1 : share < 0.35 ? 2 : share < 0.6 ? 3 : 4);
const RARE = 0.15;

const fightRange = (p: TimelinePhase, s: { startMs: number; endMs: number }) =>
  `${formatTime(p.startMs + s.startMs)}–${formatTime(p.startMs + s.endMs)}`;
const phaseRange = (p: TimelinePhase, s: { startMs: number; endMs: number }) =>
  `P${p.id} +${formatTime(s.startMs)}–${formatTime(s.endMs)}`;

/** The plan's consensus press nearest this slice, in the same phase. */
function mostCommon(row: TimelineRow, p: TimelinePhase, s: HeatSlice): string | null {
  const mid = (s.startMs + s.endMs) / 2;
  const near = row.common
    .filter((c) => c.phaseId === p.id)
    .sort((a, b) => Math.abs(a.tPhaseMs - mid) - Math.abs(b.tPhaseMs - mid))[0];
  return near ? `${formatTime(p.startMs + near.tPhaseMs)} · P${p.id} +${formatTime(near.tPhaseMs)}` : null;
}

function ticks(totalMs: number, fromMs = 0) {
  const step = totalMs > 480_000 ? 60_000 : 30_000;
  const out: number[] = [];
  for (let t = 0; t <= totalMs; t += step) out.push(t);
  return out.map((t) => ({ t, pct: (t / totalMs) * 100, label: formatTime(fromMs + t) }));
}

function Legend({ hint }: { hint: string }) {
  return (
    <div className="hm-legend">
      <span>Rarely pressed</span>
      <span className="hm-swatches" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`hm-l${l}`} />
        ))}
      </span>
      <span>Most kills press here</span>
      <span className="hm-legend-phase">
        <span className="hm-dotted" aria-hidden="true" /> Phase change
      </span>
      <span className="hm-hint">{hint}</span>
    </div>
  );
}

export function Heatmap({ desktop, phone }: { desktop: Timeline; phone: Timeline }) {
  return (
    <section aria-label="Cooldown heat map">
      <DesktopHeatmap timeline={desktop} />
      <PhoneHeatmap timeline={phone} />
    </section>
  );
}

type Hover = { key: string; pi: number; si: number } | null;

function DesktopHeatmap({ timeline }: { timeline: Timeline }) {
  const [hover, setHover] = useState<Hover>(null);
  const { phases, totalMs } = timeline;
  const maxAll = Math.max(...timeline.all.flat().map((s) => s.perKill), 0.0001);

  const tipStyle = (pi: number, s: { startMs: number; endMs: number }) => {
    const at = ((phases[pi].startMs + (s.startMs + s.endMs) / 2) / totalMs) * 100;
    return { left: `${at}%`, transform: `translateX(${at < 14 ? -12 : at > 86 ? -88 : -50}%)` };
  };

  const strip = (key: string, cells: { level: number }[][]) => (
    <div className="hm-strip">
      {phases.map((p, pi) => (
        <div key={p.id} className={`hm-phase${pi > 0 ? " hm-phase-break" : ""}`} style={{ width: `${p.widthPct}%` }}>
          {cells[pi].map((c, si) => {
            const s = timeline.all[pi][si];
            const on = hover?.key === key && hover.pi === pi && hover.si === si;
            return (
              <div
                key={si}
                className={`hm-cell hm-l${c.level}${on ? " hm-on" : ""}`}
                style={{ flexGrow: s.endMs - s.startMs }}
                onMouseEnter={() => setHover({ key, pi, si })}
              />
            );
          })}
        </div>
      ))}
    </div>
  );

  const hovered = (key: string) => (hover?.key === key ? hover : null);

  return (
    <div className="hm-desktop">
      <Legend hint="Hover a slice for times and how often it's pressed" />
      <div className="hm-card">
        <div className="hm-row hm-head">
          <div />
          <div className="hm-track hm-phase-names">
            {phases.map((p, pi) => (
              <div key={p.id} className={pi > 0 ? "hm-phase-break" : ""} style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }}>
                <strong>Phase {p.id}</strong>
                <span className="muted">
                  {formatTime(p.startMs)}–{formatTime(p.startMs + p.lengthMs)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="hm-row hm-all">
          <div className="hm-label">
            <strong>All healing CDs</strong>
          </div>
          <div className="hm-track" onMouseLeave={() => setHover(null)}>
            {strip("all", timeline.all.map((slices) => slices.map((s) => ({ level: level(s.perKill / maxAll) }))))}
            {(() => {
              const h = hovered("all");
              if (!h) return null;
              const s = timeline.all[h.pi][h.si];
              return (
                <div className="hm-tip hm-tip-below" style={tipStyle(h.pi, s)}>
                  <div className="hm-tip-title">All healing CDs</div>
                  <div>
                    <span className="hm-mono">{fightRange(phases[h.pi], s)}</span> into the fight
                  </div>
                  <div>
                    <span className="hm-mono">{phaseRange(phases[h.pi], s)}</span> since the phase change
                  </div>
                  <div className="hm-tip-rule">
                    About <strong>{s.perKill.toFixed(1)}</strong> cooldowns pressed per kill in this slice
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {timeline.groups.map((g) => (
          <div key={g.label}>
            <div className="hm-row">
              <div className="hm-group">
                {g.label}
                {g.count > 1 && <span className="muted"> ×{g.count}</span>}
                <span className="muted hm-kind">{g.count > 0 ? "healer" : "raid CD"}</span>
              </div>
              <div />
            </div>
            {g.rows.map((row) => {
              const key = String(row.spellId);
              const h = hovered(key);
              return (
                <div key={row.spellId} className="hm-row">
                  <div className="hm-label">{row.spellName}</div>
                  <div className="hm-track" onMouseLeave={() => setHover(null)}>
                    {strip(key, row.phases.map((slices) => slices.map((s) => ({ level: level(s.share) }))))}
                    {h && (
                      <SliceTip
                        row={row}
                        phase={phases[h.pi]}
                        slice={row.phases[h.pi][h.si]}
                        killCount={timeline.killCount}
                        style={tipStyle(h.pi, row.phases[h.pi][h.si])}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div className="hm-row hm-axis">
          <div className="muted">Fight time</div>
          <div className="hm-track">
            {ticks(totalMs).map((t) => (
              <span key={t.t} style={{ left: `${t.pct}%` }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SliceTip(props: { row: TimelineRow; phase: TimelinePhase; slice: HeatSlice; killCount: number; style: React.CSSProperties }) {
  const { row, phase, slice } = props;
  const common = mostCommon(row, phase, slice);
  return (
    <div className="hm-tip" style={props.style}>
      <div className="hm-tip-title">{row.spellName}</div>
      <div>
        <span className="hm-mono">{fightRange(phase, slice)}</span> into the fight
      </div>
      <div>
        <span className="hm-mono">{phaseRange(phase, slice)}</span> since the phase change
      </div>
      <div className="hm-tip-rule">
        Pressed here in <strong>{Math.round(slice.share * 100)}%</strong> of kills{" "}
        <span className="hm-tip-muted">
          ({slice.kills} of {props.killCount})
        </span>
      </div>
      {common && (
        <div className="hm-tip-muted">
          Most common: <span className="hm-mono hm-tip-strong">{common}</span>
        </div>
      )}
    </div>
  );
}

function PhoneHeatmap({ timeline }: { timeline: Timeline }) {
  const { phases, totalMs } = timeline;
  const [pi, setPi] = useState(0);
  const [spec, setSpec] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ spellId: number; si: number } | null>(null);
  const phase = phases[pi];
  const maxAll = Math.max(...timeline.all.flat().map((s) => s.perKill), 0.0001);
  const healerGroups = timeline.groups.filter((g) => g.count > 0);
  const shown = timeline.groups.filter((g) => g.count === 0 || spec === null || g.label === spec);
  const pickedRow = picked && timeline.groups.flatMap((g) => g.rows).find((r) => r.spellId === picked.spellId);
  const pickedGroup = pickedRow && timeline.groups.find((g) => g.rows.includes(pickedRow));

  return (
    <div className={`hm-phone${pickedRow ? " hm-sheet-open" : ""}`}>
      <div className="hm-tabs" role="tablist" aria-label="Phase">
        {phases.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={i === pi}
            className={i === pi ? "hm-tab-on" : ""}
            onClick={() => {
              setPi(i);
              setPicked(null);
            }}
          >
            <strong>Phase {p.id}</strong>
            <span className="hm-mono">
              {formatTime(p.startMs)}–{formatTime(p.startMs + p.lengthMs)}
            </span>
          </button>
        ))}
      </div>

      <div className="hm-overview">
        <div className="hm-overview-strip" aria-hidden="true">
          {phases.map((p, i) => (
            <div key={p.id} className={`hm-phase${i > 0 ? " hm-phase-break" : ""}`} style={{ width: `${p.widthPct}%` }}>
              {timeline.all[i].map((s, si) => (
                <div key={si} className={`hm-cell hm-l${level(s.perKill / maxAll)}`} style={{ flexGrow: s.endMs - s.startMs }} />
              ))}
            </div>
          ))}
          <div className="hm-window" style={{ left: `${phase.leftPct}%`, width: `${phase.widthPct}%` }} />
        </div>
        <div className="hm-overview-labels hm-mono">
          <span>0:00</span>
          <span>Whole fight</span>
          <span>{formatTime(totalMs)}</span>
        </div>
      </div>

      {healerGroups.length > 1 && (
        <div className="hm-chips">
          {[null, ...healerGroups.map((g) => g.label)].map((label) => (
            <button
              key={label ?? "all"}
              type="button"
              aria-pressed={spec === label}
              className={spec === label ? "hm-chip-on" : ""}
              onClick={() => {
                setSpec(label);
                setPicked(null);
              }}
            >
              {label ?? "All"}
            </button>
          ))}
        </div>
      )}

      <div className="hm-card">
        <div className="hm-phone-axis hm-mono">
          {ticks(phase.lengthMs).map((t) => (
            <span key={t.t} style={{ left: `${t.pct}%` }} className={t.pct === 0 ? "hm-first" : t.pct > 90 ? "hm-last" : ""}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="muted hm-small">Time since phase {phase.id} started</div>
        {shown.map((g, gi) => (
          <div key={g.label} className={gi > 0 && g.count === 0 && shown[gi - 1].count > 0 ? "hm-raid-start" : ""}>
            <div className="hm-group">
              {g.label}
              {g.count > 1 && <span className="muted"> ×{g.count}</span>}
              <span className="muted hm-kind">{g.count > 0 ? "healer" : "raid CD"}</span>
            </div>
            {g.rows.map((row) => {
              const slices = row.phases[pi];
              return (
                <div key={row.spellId} className="hm-phone-row">
                  <div className="hm-phone-name">
                    <span>{row.spellName}</span>
                    {Math.max(...slices.map((s) => s.share)) < RARE && <span className="muted hm-small">Rarely used this phase</span>}
                  </div>
                  <div className="hm-phone-strip">
                    {slices.map((s, si) => (
                      <button
                        key={si}
                        type="button"
                        className={`hm-l${level(s.share)}${picked?.spellId === row.spellId && picked.si === si ? " hm-on" : ""}`}
                        style={{ flexGrow: s.endMs - s.startMs }}
                        aria-label={`${row.spellName}, ${formatTime(s.startMs)} into phase ${phase.id}, ${Math.round(s.share * 100)}% of kills`}
                        onClick={() => setPicked({ spellId: row.spellId, si })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Legend hint="Tap a slice for details" />

      {pickedRow && pickedGroup && picked && (
        <PhoneSheet
          row={pickedRow}
          group={pickedGroup.label}
          phase={phase}
          slice={pickedRow.phases[pi][picked.si]}
          killCount={timeline.killCount}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}

function PhoneSheet(props: { row: TimelineRow; group: string; phase: TimelinePhase; slice: HeatSlice; killCount: number; onClose: () => void }) {
  const { row, phase, slice } = props;
  const common = mostCommon(row, phase, slice);
  return (
    <div className="hm-sheet" role="dialog" aria-label={`${row.spellName} details`}>
      <div className="hm-sheet-head">
        <div>
          <div className="hm-tip-title">{row.spellName}</div>
          <div className="hm-tip-muted">{props.group}</div>
        </div>
        <button type="button" aria-label="Close details" onClick={props.onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>
      <div className="hm-sheet-times">
        <div>
          <span className="hm-tip-muted">Into the fight</span>
          <span className="hm-mono">{fightRange(phase, slice)}</span>
        </div>
        <div>
          <span className="hm-tip-muted">Since phase change</span>
          <span className="hm-mono">{phaseRange(phase, slice)}</span>
        </div>
      </div>
      <div>
        Pressed here in <strong>{Math.round(slice.share * 100)}%</strong> of kills{" "}
        <span className="hm-tip-muted">
          ({slice.kills} of {props.killCount})
        </span>
      </div>
      {common && (
        <div className="hm-tip-muted">
          Most common: <span className="hm-mono hm-tip-strong">{common}</span>
        </div>
      )}
    </div>
  );
}
