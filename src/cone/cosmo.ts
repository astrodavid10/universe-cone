// =====================================================================
// The cone's cosmology table: s (0..1 along the cone) <-> time, x and radius
// =====================================================================
// cone.json `cosmologyTable` samples flat LCDM (Planck 2018) at 201 points, so the app never ports the
// cosmology. s is the shared reveal clock: rib vertex i sits at s = i / (n - 1), each ring has its s,
// and every dot, card and bubble gets its s from its story x.

import type { CosmologyTable } from "./manifest";

/** Piecewise-linear interpolation of ys at x over ascending xs (clamped). */
export function interp(x: number, xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const n = xs.length;
  if (x <= xs[0]) { return ys[0]; }
  if (x >= xs[n - 1]) { return ys[n - 1]; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) { lo = mid; } else { hi = mid; }
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

export class Cosmology {
  constructor(private readonly t: CosmologyTable) {}

  sFromStoryX(x: number): number { return interp(x, this.t.x_story, this.t.s); }
  storyXFromS(s: number): number { return interp(s, this.t.s, this.t.x_story); }
  trueXFromS(s: number): number { return interp(s, this.t.s, this.t.x_true); }
  /** Cosmic time at s, in billions of years after the Big Bang. */
  gyrFromS(s: number): number { return interp(s, this.t.s, this.t.t_Gyr); }
}

/** "380,000 years", "200 million years", "1.2 billion years": cosmic time for a caption. */
export function formatAge(gyr: number): string {
  const yr = gyr * 1e9;
  if (yr < 1) { return "the first instant"; }
  if (yr < 1e6) {
    // To 20,000 years: the kit's Planck 2018 table puts the CMB at 371,000 years, and the caption's
    // conventional "380,000" should agree with the readout beside it.
    const r = yr < 1e4 ? Math.round(yr / 100) * 100 : Math.round(yr / 2e4) * 2e4;
    return `${r.toLocaleString("en-US")} years`;
  }
  if (yr < 1e9) {
    const m = yr / 1e6;
    return `${m < 100 ? Math.round(m) : Math.round(m / 10) * 10} million years`;
  }
  return `${(Math.round(gyr * 10) / 10).toFixed(1)} billion years`;
}
