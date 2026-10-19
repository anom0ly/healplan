"use client";

import { useEffect, useMemo, useState } from "react";
import { formatTime } from "@/lib/engine/note";
import { hideSpecs, type DamageSlice, type HeatSlice, type Timeline, type TimelineGroup, type TimelinePhase, type TimelineRow } from "@/lib/engine/timeline";
import { HEALER_SPECS, type HealerSpec } from "@/lib/types";
import { SHOWN_SPECS_EVENT } from "./shown-specs";

/** Heat level 0 to 4 for a value in [0, 1], such as a slice's share against its row's busiest slice. */
const level = (share: number) => (share <= 0 ? 0 : share < 0.15 ? 1 : share < 0.35 ? 2 : share < 0.6 ? 3 : 4);
const RARE = 0.15;

const fightRange = (p: TimelinePhase, s: { startMs: number; endMs: number }) =>
  `${formatTime(p.startMs + s.startMs)}–${formatTime(p.startMs + s.endMs)}`;
const phaseRange = (p: TimelinePhase, s: { startMs: number; endMs: number }) =>
  `P${p.id} +${formatTime(s.startMs)}–${formatTime(s.endMs)}`;

/** The plan's consensus press nearest this slice, in the same phase. */
function mostCommon(row: TimelineRow, p: TimelinePhase, s: HeatSlice, single: boolean): string | null {
  const mid = (s.startMs + s.endMs) / 2;
  const near = row.common
    .filter((c) => c.phaseId === p.id)
    .sort((a, b) => Math.abs(a.tPhaseMs - mid) - Math.abs(b.tPhaseMs - mid))[0];
  if (!near) return null;
  return single ? formatTime(near.tPhaseMs) : `${formatTime(p.startMs + near.tPhaseMs)} · P${p.id} +${formatTime(near.tPhaseMs)}`;
}

/** A spell name that opens on Wowhead, which also shows its tooltip on hover. Melee (id 1) has no page. */
function SpellLink({ id, name }: { id: number; name: string }) {
  if (id <= 1) return <>{name}</>;
  return (
    <a className="wh" href={`https://www.wowhead.com/spell=${id}`} target="_blank" rel="noopener noreferrer">
      {name}
    </a>
  );
}

/** CSS class that sets a group's heat color to its WoW class color. */
const classTone = (wowClass: string) => `hm-c-${wowClass.toLowerCase().replace(/\s+/g, "-")}`;

/** "#1" or "#2" when the comp has two of a spec, with how that player was picked in its tooltip. */
function SlotBadge({ group }: { group: TimelineGroup }) {
  if (group.slot === null) return null;
  const title =
    group.slot === 1
      ? `The ${group.name} whose cooldowns line up with kills that had one ${group.name}`
      : `The other ${group.name}, out of kills that had ${group.slot} or more`;
  return (
    <span className="hm-slot" title={title}>
      #{group.slot}
    </span>
  );
}

/** Width of the dashed box marking where every comp presses a cooldown. */
const EVERY_BOX_MS = 12_000;

/** Fight times of some presses, e.g. "0:40 · 3:30". */
function pressTimes(presses: { phaseId: number; tPhaseMs: number }[], phases: TimelinePhase[]) {
  return presses
    .map((p) => phases.find((ph) => ph.id === p.phaseId))
    .map((ph, i) => (ph ? formatTime(ph.startMs + presses[i].tPhaseMs) : null))
    .filter((t): t is string => t !== null)
    .join(" · ");
}

/** A "comp" tag on a cooldown your comp presses somewhere else than every comp, with both times in its tooltip. */
function ShiftTag({ row, phases }: { row: TimelineRow; phases: TimelinePhase[] }) {
  if (!row.shift) return null;
  return (
    <span className="hm-shift" tabIndex={0} aria-label={`${row.spellName} is pressed at a different time in your comp`}>
      comp
      <span className="hm-shift-card" role="tooltip">
        <span className="hm-tip-title">{row.spellName} moves with your comp</span>
        <span className="hm-shift-times">
          <span className="hm-tip-muted">Your comp</span>
          <span className="hm-mono">{pressTimes(row.shift.yours, phases) || "Rarely pressed"}</span>
          <span className="hm-tip-muted">Every comp</span>
          <span className="hm-mono">{pressTimes(row.shift.every, phases)}</span>
        </span>
        <span className="hm-tip-muted">Dashed boxes show where most guilds press it.</span>
      </span>
    </span>
  );
}

/** One line for cooldown tooltips: when every comp presses it, for a cooldown your comp presses elsewhere. */
function EveryCompNote({ row, phases }: { row: TimelineRow; phases: TimelinePhase[] }) {
  if (!row.shift) return null;
  return (
    <div className="hm-tip-muted">
      Every comp: <span className="hm-mono hm-tip-strong">{pressTimes(row.shift.every, phases)}</span>
    </div>
  );
}

/** Height of a damage bar, 0 to 1, against the slice that hurts most. */
const maxRatio = (damage: DamageSlice[][]) => Math.max(...damage.flat().map((d) => d.ratio ?? 0), 0.0001);
const ratioText = (r: number) => `${r < 10 ? r.toFixed(1) : Math.round(r)}×`;

/** The cooldowns most often pressed in one slice, busiest first. */
function pressedHere(timeline: Timeline, pi: number, si: number, limit = 3) {
  return timeline.groups
    .flatMap((g) => g.rows)
    .map((r) => ({ key: r.key, id: r.spellId, name: r.key.includes("#") ? `${r.spellName} #${r.slot}` : r.spellName, share: r.phases[pi][si].share }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share)
    .slice(0, limit);
}

/** Raid damage in a slice: how heavy it is and what's behind it. */
function DamageLines({ d }: { d: DamageSlice }) {
  if (d.ratio === null) return null;
  return (
    <>
      <div>
        Raid takes <strong>{ratioText(d.ratio)}</strong> the fight&apos;s average damage
      </div>
      {d.top && (
        <div className="hm-dmg-top">
          <span className="hm-dmg-dot" aria-hidden="true" />
          <span>
            Mostly{" "}
            <strong>
              <SpellLink id={d.top.id} name={d.top.name} />
            </strong>
          </span>
          <span className="hm-mono">{Math.round(d.top.share * 100)}%</span>
        </div>
      )}
    </>
  );
}

/** One line for cooldown tooltips: the raid damage in the same slice. */
function DamageNote({ d }: { d: DamageSlice | undefined }) {
  if (!d || d.ratio === null) return null;
  return (
    <div className="hm-tip-muted">
      Raid damage <span className="hm-tip-strong">{ratioText(d.ratio)}</span> average
      {d.top && (
        <>
          , mostly{" "}
          <span className="hm-tip-strong">
            <SpellLink id={d.top.id} name={d.top.name} />
          </span>
        </>
      )}
    </div>
  );
}

function PressedList({ timeline, pi, si }: { timeline: Timeline; pi: number; si: number }) {
  const list = pressedHere(timeline, pi, si);
  if (list.length === 0) return <div className="hm-tip-muted">No cooldown usually pressed here</div>;
  return (
    <div>
      <div className="hm-tip-muted">Pressed here in</div>
      {list.map((r) => (
        <div key={r.key} className="hm-pressed">
          <span>
            <SpellLink id={r.id} name={r.name} />
          </span>
          <span className="hm-mono">{Math.round(r.share * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function ticks(totalMs: number, fromMs = 0) {
  const step = totalMs > 480_000 ? 60_000 : 30_000;
  const out: number[] = [];
  for (let t = 0; t <= totalMs; t += step) out.push(t);
  return out.map((t) => ({ t, pct: (t / totalMs) * 100, label: formatTime(fromMs + t) }));
}

function Legend({ hint, phased, damage, every }: { hint: string; phased: boolean; damage: boolean; every: boolean }) {
  return (
    <div className="hm-legend">
      <span>Less often</span>
      <span className="hm-swatches" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`hm-l${l}`} />
        ))}
      </span>
      <span>Busiest time for that cooldown</span>
      {damage && (
        <span className="hm-legend-phase">
          <span className="hm-dmg-swatch" aria-hidden="true" /> Raid damage taken
        </span>
      )}
      {phased && (
        <span className="hm-legend-phase">
          <span className="hm-dotted" aria-hidden="true" /> Phase change
        </span>
      )}
      {every && (
        <span className="hm-legend-phase">
          <span className="hm-every-swatch" aria-hidden="true" /> Every comp
        </span>
      )}
      <span className="hm-hint">{hint}</span>
    </div>
  );
}

/** Shades each row against its own busiest slice, so every cooldown shows where it's mostly pressed. */
function rowShade(row: TimelineRow) {
  const max = Math.max(...row.phases.flat().map((s) => s.share), 0.0001);
  return (share: number) => level(share / max);
}

const hasShifts = (t: Timeline) => t.groups.some((g) => g.rows.some((r) => r.shift));

/**
 * `hidden` healer specs are left out. With `live` (any comp), the picker turns specs on and off in place.
 */
export function Heatmap({ desktop, phone, hidden = [], live = false }: { desktop: Timeline; phone: Timeline; hidden?: HealerSpec[]; live?: boolean }) {
  const [off, setOff] = useState(hidden);
  useEffect(() => {
    if (!live) return;
    const onShown = (e: Event) => {
      const shown = (e as CustomEvent<HealerSpec[]>).detail;
      setOff(HEALER_SPECS.filter((s) => !shown.includes(s)));
    };
    window.addEventListener(SHOWN_SPECS_EVENT, onShown);
    return () => window.removeEventListener(SHOWN_SPECS_EVENT, onShown);
  }, [live]);
  const d = useMemo(() => hideSpecs(desktop, off), [desktop, off]);
  const p = useMemo(() => hideSpecs(phone, off), [phone, off]);
  return (
    <section aria-label="Cooldown heat map">
      <DesktopHeatmap timeline={d} />
      <PhoneHeatmap timeline={p} />
    </section>
  );
}

type Hover = { key: string; pi: number; si: number } | null;

function DesktopHeatmap({ timeline }: { timeline: Timeline }) {
  const [hover, setHover] = useState<Hover>(null);
  // A clicked slice keeps its card open so the links in it can be clicked.
  const [pinned, setPinned] = useState<Hover>(null);
  const shown = pinned ?? hover;
  const { phases, totalMs } = timeline;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest(".hm-tip, .hm-cell, .hm-bar")) setPinned(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPinned(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  const pin = (h: NonNullable<Hover>) =>
    setPinned((p) => (p && p.key === h.key && p.pi === h.pi && p.si === h.si ? null : h));
  const tipClass = (extra = "") => `hm-tip${extra}${pinned ? " hm-tip-pinned" : ""}`;
  // A boss with no phase changes reads as one fight, with no phase labels.
  const single = phases.length === 1;
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
            const on = shown?.key === key && shown.pi === pi && shown.si === si;
            return (
              <div
                key={si}
                className={`hm-cell hm-l${c.level}${on ? " hm-on" : ""}`}
                style={{ flexGrow: s.endMs - s.startMs }}
                onMouseEnter={() => setHover({ key, pi, si })}
                onClick={() => pin({ key, pi, si })}
              />
            );
          })}
        </div>
      ))}
    </div>
  );

  const hovered = (key: string) => (shown?.key === key ? shown : null);

  return (
    <div className="hm-desktop">
      <Legend hint="Hover a slice for details, click to keep it open" phased={!single} damage={!!timeline.damage} every={hasShifts(timeline)} />
      <div className="hm-card">
        <div className="hm-row hm-head">
          <div />
          <div className="hm-track hm-phase-names">
            {phases.map((p, pi) => (
              <div key={p.id} className={pi > 0 ? "hm-phase-break" : ""} style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }}>
                <strong>{single ? "Whole fight" : `Phase ${p.id}`}</strong>
                <span className="muted">
                  {formatTime(p.startMs)}–{formatTime(p.startMs + p.lengthMs)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {timeline.damage && (
          <div className="hm-row hm-dmg">
            <div className="hm-label">
              <strong>Raid damage</strong>
            </div>
            <div className="hm-track" onMouseLeave={() => setHover(null)}>
              <div className="hm-bars">
                {phases.map((p, pi) => (
                  <div key={p.id} className={`hm-phase${pi > 0 ? " hm-phase-break" : ""}`} style={{ width: `${p.widthPct}%` }}>
                    {timeline.damage![pi].map((d, si) => (
                      <DamageBar
                        key={si}
                        d={d}
                        max={maxRatio(timeline.damage!)}
                        on={shown?.key === "dmg" && shown.pi === pi && shown.si === si}
                        onEnter={() => setHover({ key: "dmg", pi, si })}
                        onClick={() => pin({ key: "dmg", pi, si })}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {(() => {
                const h = hovered("dmg");
                if (!h) return null;
                const d = timeline.damage![h.pi][h.si];
                return (
                  <div className={tipClass(" hm-tip-below")} style={tipStyle(h.pi, d)}>
                    <div className="hm-tip-title">Raid damage</div>
                    <div>
                      <span className="hm-mono">{fightRange(phases[h.pi], d)}</span> into the fight
                    </div>
                    {!single && (
                      <div>
                        <span className="hm-mono">{phaseRange(phases[h.pi], d)}</span> since the phase change
                      </div>
                    )}
                    <div className="hm-tip-rule">
                      {d.ratio === null ? <div className="hm-tip-muted">No damage stored for this slice</div> : <DamageLines d={d} />}
                    </div>
                    <div className="hm-tip-rule">
                      <PressedList timeline={timeline} pi={h.pi} si={h.si} />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

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
                <div className={tipClass(" hm-tip-below")} style={tipStyle(h.pi, s)}>
                  <div className="hm-tip-title">All healing CDs</div>
                  <div>
                    <span className="hm-mono">{fightRange(phases[h.pi], s)}</span> into the fight
                  </div>
                  {!single && (
                    <div>
                      <span className="hm-mono">{phaseRange(phases[h.pi], s)}</span> since the phase change
                    </div>
                  )}
                  <div className="hm-tip-rule">
                    About <strong>{s.perKill.toFixed(1)}</strong> cooldowns pressed per kill in this slice
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {timeline.groups.map((g) => (
          <div key={g.label} className={classTone(g.wowClass)}>
            <div className="hm-row">
              <div className="hm-group">
                <span className="hm-dot" aria-hidden="true" />
                {g.name}
                <SlotBadge group={g} />
                <span className="muted hm-kind">{g.count > 0 ? "healer" : "raid CD"}</span>
              </div>
              <div />
            </div>
            {g.rows.map((row) => {
              const key = row.key;
              const h = hovered(key);
              return (
                <div key={row.key} className="hm-row">
                  <div className="hm-label">
                    <SpellLink id={row.spellId} name={row.spellName} />
                    <ShiftTag row={row} phases={phases} />
                  </div>
                  <div className="hm-track" onMouseLeave={() => setHover(null)}>
                    {strip(key, row.phases.map((slices) => slices.map((s) => ({ level: rowShade(row)(s.share) }))))}
                    {row.shift?.every.map((e, i) => {
                      const ph = phases.find((x) => x.id === e.phaseId);
                      if (!ph) return null;
                      const at = Math.min(ph.startMs + e.tPhaseMs, totalMs - EVERY_BOX_MS / 2);
                      return (
                        <span
                          key={i}
                          className="hm-every"
                          aria-hidden="true"
                          style={{ left: `${(Math.max(0, at - EVERY_BOX_MS / 2) / totalMs) * 100}%`, width: `${(EVERY_BOX_MS / totalMs) * 100}%` }}
                        />
                      );
                    })}
                    {h && (
                      <SliceTip
                        row={row}
                        phase={phases[h.pi]}
                        slice={row.phases[h.pi][h.si]}
                        killCount={row.killCount}
                        single={single}
                        phases={phases}
                        damage={timeline.damage?.[h.pi][h.si]}
                        style={tipStyle(h.pi, row.phases[h.pi][h.si])}
                        className={tipClass()}
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

function DamageBar(props: { d: DamageSlice; max: number; on: boolean; onEnter: () => void; onClick: () => void }) {
  const { d, max, on } = props;
  const h = d.ratio === null ? 0 : d.ratio / max;
  return (
    <div className={`hm-bar${on ? " hm-bar-on" : ""}`} style={{ flexGrow: d.endMs - d.startMs }} onMouseEnter={props.onEnter} onClick={props.onClick}>
      <span style={{ height: `${Math.max(h > 0 ? 4 : 0, h * 100)}%`, opacity: 0.35 + 0.65 * h }} />
    </div>
  );
}

function SliceTip(props: {
  row: TimelineRow;
  phase: TimelinePhase;
  slice: HeatSlice;
  killCount: number;
  single: boolean;
  phases: TimelinePhase[];
  damage: DamageSlice | undefined;
  style: React.CSSProperties;
  className: string;
}) {
  const { row, phase, slice } = props;
  const common = mostCommon(row, phase, slice, props.single);
  return (
    <div className={props.className} style={props.style}>
      <div className="hm-tip-title">
        <SpellLink id={row.spellId} name={row.spellName} />
      </div>
      <div>
        <span className="hm-mono">{fightRange(phase, slice)}</span> into the fight
      </div>
      {!props.single && (
        <div>
          <span className="hm-mono">{phaseRange(phase, slice)}</span> since the phase change
        </div>
      )}
      <div className="hm-tip-rule">
        Pressed around here in <strong>{Math.round(slice.share * 100)}%</strong> of kills{" "}
        <span className="hm-tip-muted">
          ({slice.kills} of {props.killCount})
        </span>
      </div>
      {common && (
        <div className="hm-tip-muted">
          Most common: <span className="hm-mono hm-tip-strong">{common}</span>
        </div>
      )}
      <EveryCompNote row={row} phases={props.phases} />
      <DamageNote d={props.damage} />
    </div>
  );
}

/** One tab on phones: a phase, or for a boss with no phases, a two-minute stretch of the fight. */
interface PhoneView {
  label: string;
  pi: number;
  fromMs: number;
  toMs: number;
}

const CHUNK_MS = 120_000;

function phoneViews(phases: TimelinePhase[]): PhoneView[] {
  if (phases.length > 1) return phases.map((p, pi) => ({ label: `Phase ${p.id}`, pi, fromMs: 0, toMs: p.lengthMs }));
  // A leftover under half a chunk joins the last tab.
  const len = phases[0].lengthMs;
  const count = Math.max(1, Math.round(len / CHUNK_MS));
  return Array.from({ length: count }, (_, i) => ({
    label: count === 1 ? "Whole fight" : `Part ${i + 1}`,
    pi: 0,
    fromMs: i * CHUNK_MS,
    toMs: i === count - 1 ? len : (i + 1) * CHUNK_MS,
  }));
}

function PhoneHeatmap({ timeline }: { timeline: Timeline }) {
  const { phases, totalMs } = timeline;
  const views = phoneViews(phases);
  const [vi, setVi] = useState(0);
  const [spec, setSpec] = useState<string | null>(null);
  // rowKey null is the raid damage row.
  const [picked, setPicked] = useState<{ rowKey: string | null; si: number } | null>(null);
  const view = views[vi];
  const phase = phases[view.pi];
  const single = phases.length === 1;
  const inView = (s: { startMs: number }) => s.startMs >= view.fromMs && s.startMs < view.toMs;
  const maxAll = Math.max(...timeline.all.flat().map((s) => s.perKill), 0.0001);
  const healerGroups = timeline.groups.filter((g) => g.count > 0);
  // A spec turned off in the picker can't stay picked here.
  const only = spec !== null && healerGroups.some((g) => g.label === spec) ? spec : null;
  const shown = timeline.groups.filter((g) => g.count === 0 || only === null || g.label === only);
  const pickedRow = picked && picked.rowKey !== null && timeline.groups.flatMap((g) => g.rows).find((r) => r.key === picked.rowKey);
  const pickedDamage = picked && picked.rowKey === null ? timeline.damage?.[view.pi][picked.si] : undefined;
  const pickedGroup = pickedRow && timeline.groups.find((g) => g.rows.includes(pickedRow));

  return (
    <div className={`hm-phone${pickedRow || pickedDamage ? " hm-sheet-open" : ""}`}>
      {views.length > 1 && (
        <>
          <div className="hm-tabs" role="tablist" aria-label={single ? "Part of the fight" : "Phase"}>
            {views.map((v, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === vi}
                className={i === vi ? "hm-tab-on" : ""}
                onClick={() => {
                  setVi(i);
                  setPicked(null);
                }}
              >
                <strong>{v.label}</strong>
                <span className="hm-mono">
                  {formatTime(phases[v.pi].startMs + v.fromMs)}–{formatTime(phases[v.pi].startMs + v.toMs)}
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
              <div
                className="hm-window"
                style={{
                  left: `${((phase.startMs + view.fromMs) / totalMs) * 100}%`,
                  width: `${((view.toMs - view.fromMs) / totalMs) * 100}%`,
                }}
              />
            </div>
            <div className="hm-overview-labels hm-mono">
              <span>0:00</span>
              <span>Whole fight</span>
              <span>{formatTime(totalMs)}</span>
            </div>
          </div>
        </>
      )}

      {healerGroups.length > 1 && (
        <div className="hm-chips">
          {[null, ...healerGroups.map((g) => g.label)].map((label) => (
            <button
              key={label ?? "all"}
              type="button"
              aria-pressed={only === label}
              className={only === label ? "hm-chip-on" : ""}
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
          {ticks(view.toMs - view.fromMs, view.fromMs).map((t) => (
            <span key={t.t} style={{ left: `${t.pct}%` }} className={t.pct === 0 ? "hm-first" : t.pct > 90 ? "hm-last" : ""}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="muted hm-small">{single ? "Fight time" : `Time since phase ${phase.id} started`}</div>
        {timeline.damage && (
          <div className="hm-phone-row hm-phone-dmg">
            <div className="hm-phone-name">
              <strong>Raid damage</strong>
            </div>
            <div className="hm-phone-bars">
              {timeline.damage[view.pi]
                .map((d, si) => ({ d, si }))
                .filter(({ d }) => inView(d))
                .map(({ d, si }) => {
                  const h = d.ratio === null ? 0 : d.ratio / maxRatio(timeline.damage!);
                  return (
                    <button
                      key={si}
                      type="button"
                      className={picked?.rowKey === null && picked.si === si ? "hm-bar-on" : ""}
                      style={{ flexGrow: d.endMs - d.startMs }}
                      aria-label={`Raid damage, ${formatTime(d.startMs)} into ${single ? "the fight" : `phase ${phase.id}`}${d.ratio === null ? "" : `, ${ratioText(d.ratio)} average`}`}
                      onClick={() => setPicked({ rowKey: null, si })}
                    >
                      <span style={{ height: `${Math.max(h > 0 ? 4 : 0, h * 100)}%`, opacity: 0.35 + 0.65 * h }} />
                    </button>
                  );
                })}
            </div>
          </div>
        )}
        {shown.map((g, gi) => (
          <div
            key={g.label}
            className={`${classTone(g.wowClass)}${gi > 0 && g.count === 0 && shown[gi - 1].count > 0 ? " hm-raid-start" : ""}`}
          >
            <div className="hm-group">
              <span className="hm-dot" aria-hidden="true" />
              {g.name}
              <SlotBadge group={g} />
              <span className="muted hm-kind">{g.count > 0 ? "healer" : "raid CD"}</span>
            </div>
            {g.rows.map((row) => {
              const slices = row.phases[view.pi].map((s, si) => ({ ...s, si })).filter(inView);
              return (
                <div key={row.key} className="hm-phone-row">
                  <div className="hm-phone-name">
                    <span>
                      <SpellLink id={row.spellId} name={row.spellName} />
                      <ShiftTag row={row} phases={phases} />
                    </span>
                    {Math.max(...slices.map((s) => s.share)) < RARE && (
                      <span className="muted hm-small">{single ? "Rarely used here" : "Rarely used this phase"}</span>
                    )}
                  </div>
                  <div className="hm-phone-strip">
                    {slices.map((s) => (
                      <button
                        key={s.si}
                        type="button"
                        className={`hm-l${rowShade(row)(s.share)}${picked?.rowKey === row.key && picked.si === s.si ? " hm-on" : ""}`}
                        style={{ flexGrow: s.endMs - s.startMs }}
                        aria-label={`${row.spellName}, ${formatTime(s.startMs)} into ${single ? "the fight" : `phase ${phase.id}`}, ${Math.round(s.share * 100)}% of kills`}
                        onClick={() => setPicked({ rowKey: row.key, si: s.si })}
                      />
                    ))}
                    {row.shift?.every
                      .filter((e) => e.phaseId === phase.id && e.tPhaseMs >= view.fromMs && e.tPhaseMs < view.toMs)
                      .map((e, i) => {
                        const span = view.toMs - view.fromMs;
                        const left = Math.max(0, Math.min(e.tPhaseMs - view.fromMs - EVERY_BOX_MS / 2, span - EVERY_BOX_MS));
                        return (
                          <span key={i} className="hm-every" aria-hidden="true" style={{ left: `${(left / span) * 100}%`, width: `${(EVERY_BOX_MS / span) * 100}%` }} />
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Legend hint="Tap a slice for details" phased={!single} damage={!!timeline.damage} every={hasShifts(timeline)} />

      {pickedRow && pickedGroup && picked && (
        <PhoneSheet
          row={pickedRow}
          group={pickedGroup.label}
          phase={phase}
          slice={pickedRow.phases[view.pi][picked.si]}
          killCount={pickedRow.killCount}
          single={single}
          phases={phases}
          damage={timeline.damage?.[view.pi][picked.si]}
          onClose={() => setPicked(null)}
        />
      )}
      {pickedDamage && picked && (
        <DamageSheet timeline={timeline} d={pickedDamage} pi={view.pi} si={picked.si} single={single} onClose={() => setPicked(null)} />
      )}
    </div>
  );
}

function SheetHead({ title, sub, onClose }: { title: React.ReactNode; sub?: string; onClose: () => void }) {
  return (
    <div className="hm-sheet-head">
      <div>
        <div className="hm-tip-title">{title}</div>
        {sub && <div className="hm-tip-muted">{sub}</div>}
      </div>
      <button type="button" aria-label="Close details" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      </button>
    </div>
  );
}

function SheetTimes({ phase, slice, single }: { phase: TimelinePhase; slice: { startMs: number; endMs: number }; single: boolean }) {
  return (
    <div className="hm-sheet-times">
      <div>
        <span className="hm-tip-muted">Into the fight</span>
        <span className="hm-mono">{fightRange(phase, slice)}</span>
      </div>
      {!single && (
        <div>
          <span className="hm-tip-muted">Since phase change</span>
          <span className="hm-mono">{phaseRange(phase, slice)}</span>
        </div>
      )}
    </div>
  );
}

function DamageSheet(props: { timeline: Timeline; d: DamageSlice; pi: number; si: number; single: boolean; onClose: () => void }) {
  const { d } = props;
  return (
    <div className="hm-sheet" role="dialog" aria-label="Raid damage details">
      <SheetHead title="Raid damage" onClose={props.onClose} />
      <SheetTimes phase={props.timeline.phases[props.pi]} slice={d} single={props.single} />
      {d.ratio === null ? <div className="hm-tip-muted">No damage stored for this slice</div> : <DamageLines d={d} />}
      <PressedList timeline={props.timeline} pi={props.pi} si={props.si} />
    </div>
  );
}

function PhoneSheet(props: {
  row: TimelineRow;
  group: string;
  phase: TimelinePhase;
  slice: HeatSlice;
  killCount: number;
  single: boolean;
  phases: TimelinePhase[];
  damage: DamageSlice | undefined;
  onClose: () => void;
}) {
  const { row, phase, slice } = props;
  const common = mostCommon(row, phase, slice, props.single);
  return (
    <div className="hm-sheet" role="dialog" aria-label={`${row.spellName} details`}>
      <SheetHead title={<SpellLink id={row.spellId} name={row.spellName} />} sub={props.group} onClose={props.onClose} />
      <SheetTimes phase={phase} slice={slice} single={props.single} />
      <div>
        Pressed around here in <strong>{Math.round(slice.share * 100)}%</strong> of kills{" "}
        <span className="hm-tip-muted">
          ({slice.kills} of {props.killCount})
        </span>
      </div>
      {common && (
        <div className="hm-tip-muted">
          Most common: <span className="hm-mono hm-tip-strong">{common}</span>
        </div>
      )}
      <EveryCompNote row={row} phases={props.phases} />
      <DamageNote d={props.damage} />
    </div>
  );
}
