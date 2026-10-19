"use client";

import { useEffect, useState } from "react";
import type { BossOption } from "@/lib/db";
import { matchCounts, sortComp, type CompSummary } from "@/lib/engine/comp";
import { DEFAULT_WEIGHT_OPTIONS } from "@/lib/engine/weighting";
import { HEALER_SPECS, SPEC_LABEL, type Difficulty, type HealerSpec } from "@/lib/types";

const MAX_HEALERS = 6;
const POPULAR = 5;

/** Class colours, with initials standing in for spec icons. */
const BADGE: Record<HealerSpec, { abbr: string; bg: string; fg: string }> = {
  RestorationDruid: { abbr: "RD", bg: "#ff7c0a", fg: "#1c1917" },
  HolyPaladin: { abbr: "HPa", bg: "#f48cba", fg: "#1c1917" },
  DisciplinePriest: { abbr: "Di", bg: "#f5f5f4", fg: "#1c1917" },
  HolyPriest: { abbr: "HPr", bg: "#f5f5f4", fg: "#1c1917" },
  RestorationShaman: { abbr: "RS", bg: "#0070dd", fg: "#ffffff" },
  MistweaverMonk: { abbr: "MW", bg: "#00ff98", fg: "#1c1917" },
  PreservationEvoker: { abbr: "Pr", bg: "#33937f", fg: "#ffffff" },
};

const sameComp = (a: HealerSpec[], b: HealerSpec[]) => sortComp(a).join() === sortComp(b).join();

function Badge({ spec, className = "pk-badge" }: { spec: HealerSpec; className?: string }) {
  const b = BADGE[spec];
  return (
    <span className={className} style={{ background: b.bg, color: b.fg }} title={SPEC_LABEL[spec]}>
      {b.abbr}
    </span>
  );
}

export interface PickerInitial {
  encounter: string;
  difficulty: Difficulty;
  comp: HealerSpec[];
  firstKillsOnly: boolean;
}

type CompsState = { encounter: string; difficulty: Difficulty; comps: CompSummary[] | null; failed?: boolean };

/** `keep` holds query params the form carries along unchanged, such as a pasted log. */
export function Picker({ bosses, initial, keep = {} }: { bosses: BossOption[]; initial: PickerInitial; keep?: Record<string, string> }) {
  const [encounter, setEncounter] = useState(initial.encounter);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [comp, setComp] = useState<HealerSpec[]>(sortComp(initial.comp));
  const [firstKillsOnly, setFirstKillsOnly] = useState(initial.firstKillsOnly);
  // null until the person chooses, so the picker can open build-your-own on its own.
  const [buildOwn, setBuildOwn] = useState<boolean | null>(null);
  const [info, setInfo] = useState(false);
  const [loaded, setLoaded] = useState<CompsState>({ encounter: "", difficulty: "mythic", comps: null });

  useEffect(() => {
    if (!encounter) return;
    let live = true;
    fetch(`/api/comps?encounter=${encodeURIComponent(encounter)}&difficulty=${difficulty}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((comps: CompSummary[]) => live && setLoaded({ encounter, difficulty, comps }))
      .catch(() => live && setLoaded({ encounter, difficulty, comps: [], failed: true }));
    return () => {
      live = false;
    };
  }, [encounter, difficulty]);

  const current = loaded.encounter === encounter && loaded.difficulty === difficulty ? loaded : null;
  const comps = current?.comps ?? null;
  const popular = (comps ?? []).slice(0, POPULAR);
  const pickedPopular = popular.some((p) => sameComp(p.healers, comp));
  // A comp from a link that isn't one of the popular ones opens straight into build-your-own.
  const showBuild = buildOwn ?? (comps !== null && (popular.length === 0 || (comp.length > 0 && !pickedPopular)));
  const counts = HEALER_SPECS.map((s) => [s, comp.filter((x) => x === s).length] as const).filter(([, n]) => n > 0);
  const m = matchCounts(comp, comps ?? [], DEFAULT_WEIGHT_OPTIONS.minCompSimilarity);
  const matching = firstKillsOnly ? m.firstKills : m.exact + m.close;

  const add = (spec: HealerSpec) => setComp((c) => (c.length < MAX_HEALERS ? sortComp([...c, spec]) : c));
  const removeAt = (i: number) => setComp((c) => c.filter((_, j) => j !== i));

  let pill = "Pick your healers";
  if (comps === null && comp.length > 0) pill = "Counting kills…";
  else if (comp.length > 0) pill = matching ? `${matching.toLocaleString("en-US")} matching kills` : "No matching kills yet";

  return (
    <form method="get" className="pk">
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="pk-top">
        {bosses.length > 0 ? (
          <label className="pk-field">
            Boss
            <select name="encounter" value={encounter} onChange={(e) => setEncounter(e.target.value)} required>
              <option value="">Choose a boss</option>
              {groupByZone(bosses).map(([zoneName, zoneBosses]) => (
                <optgroup key={zoneName} label={zoneName}>
                  {zoneBosses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : (
          <label className="pk-field">
            Encounter id
            <input name="encounter" type="number" value={encounter} onChange={(e) => setEncounter(e.target.value)} required />
          </label>
        )}
        <fieldset className="pk-seg">
          <legend className="pk-sr">Difficulty</legend>
          {(["mythic", "heroic"] as const).map((d) => (
            <label key={d} className={difficulty === d ? "pk-on" : undefined}>
              <input type="radio" name="difficulty" value={d} checked={difficulty === d} onChange={() => setDifficulty(d)} />
              {d === "mythic" ? "Mythic" : "Heroic"}
            </label>
          ))}
        </fieldset>
      </div>

      {!encounter ? (
        <p className="muted pk-hint">Pick a boss to see the comps guilds used on it.</p>
      ) : (
        <>
          {counts.map(([s, n]) => (
            <input key={s} type="hidden" name={s} value={n} />
          ))}

          <div className="pk-section">
            <span className="pk-title">Pick your healing comp</span>
            {comps === null ? (
              <p className="muted">Loading comps…</p>
            ) : current?.failed ? (
              <p className="muted">Couldn&apos;t load comps for this boss. Build yours below.</p>
            ) : popular.length === 0 ? (
              <p className="muted">No kills stored for this boss yet.</p>
            ) : null}
            {(popular.length > 0 || comps === null) && (
              <div className="pk-popular">
                {popular.map((p) => {
                  const on = !showBuild && sameComp(p.healers, comp);
                  return (
                    <button
                      key={p.healers.join()}
                      type="button"
                      className={on ? "pk-card pk-on" : "pk-card"}
                      aria-pressed={on}
                      title={`${p.firstKills.toLocaleString("en-US")} of these are guild first kills`}
                      onClick={() => {
                        setComp(p.healers);
                        setBuildOwn(false);
                      }}
                    >
                      <span className="pk-badges">
                        {p.healers.map((s, i) => (
                          <Badge key={i} spec={s} />
                        ))}
                      </span>
                      <span className="muted">{p.kills.toLocaleString("en-US")} kills</span>
                    </button>
                  );
                })}
                {popular.length > 0 && (
                  <button
                    type="button"
                    className={showBuild ? "pk-card pk-own pk-on" : "pk-card pk-own"}
                    aria-pressed={showBuild}
                    onClick={() => setBuildOwn(true)}
                  >
                    Build your own
                  </button>
                )}
              </div>
            )}
          </div>

          {showBuild && (
            <div className="pk-build">
              <div className="pk-slots">
                {Array.from({ length: MAX_HEALERS }, (_, i) =>
                  comp[i] ? (
                    <button
                      key={i}
                      type="button"
                      className="pk-slot"
                      style={{ background: BADGE[comp[i]].bg, color: BADGE[comp[i]].fg }}
                      aria-label={`Remove ${SPEC_LABEL[comp[i]]}`}
                      title={`${SPEC_LABEL[comp[i]]}, click to remove`}
                      onClick={() => removeAt(i)}
                    >
                      {BADGE[comp[i]].abbr}
                    </button>
                  ) : (
                    <span key={i} className="pk-slot pk-empty" aria-hidden="true" />
                  ),
                )}
              </div>
              <div className="pk-tray">
                {HEALER_SPECS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={comp.length >= MAX_HEALERS}
                    aria-label={`Add ${SPEC_LABEL[s]}`}
                    title={`Add ${SPEC_LABEL[s]}`}
                    onClick={() => add(s)}
                  >
                    <Badge spec={s} className="pk-badge pk-badge-lg" />
                    <span className="pk-tray-name">{SPEC_LABEL[s]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pk-bar">
            <div className="pk-match">
              <button type="button" className="pk-pill" aria-expanded={info} disabled={comp.length === 0} onClick={() => setInfo((v) => !v)}>
                {pill} <span className="muted" aria-hidden="true">ⓘ</span>
              </button>
              {info && comp.length > 0 && comps !== null && (
                <div className="pk-info">
                  <span>{m.exact.toLocaleString("en-US")} exact comp</span>
                  <span>{m.close.toLocaleString("en-US")} close comp</span>
                  <span className="pk-info-muted">{m.firstKills.toLocaleString("en-US")} are guild first kills</span>
                </div>
              )}
            </div>
            <label className="pk-check">
              <input name="firstKillsOnly" type="checkbox" value="1" checked={firstKillsOnly} onChange={(e) => setFirstKillsOnly(e.target.checked)} />
              First kills only
            </label>
            <button type="submit" className="pk-go" disabled={comp.length === 0}>
              Show cooldowns
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function groupByZone(bosses: BossOption[]): [string, BossOption[]][] {
  const zones = new Map<string, BossOption[]>();
  for (const b of bosses) zones.set(b.zoneName, [...(zones.get(b.zoneName) ?? []), b]);
  return [...zones];
}
