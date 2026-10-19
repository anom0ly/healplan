import type { HealerSpec } from "@/lib/types";

/** Sent on window when someone turns specs on or off in the any-comp picker, with the specs to show as its detail. */
export const SHOWN_SPECS_EVENT = "healplan:shown-specs";

export const announceShownSpecs = (specs: HealerSpec[]) =>
  window.dispatchEvent(new CustomEvent<HealerSpec[]>(SHOWN_SPECS_EVENT, { detail: specs }));
