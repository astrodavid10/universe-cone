// =====================================================================
// The Play All timeline: one clock T -> the whole scene state
// =====================================================================
// Pure maths, no three.js. The dome drives the build with ~40 script lines per second (cone.json
// steps[k].animation: 0.225 s linear keyframes faking an ease, a drawRange command per rib). This file
// keeps what those cues MEAN and drops how Digistar had to say it:
//
//   * one reveal clock `reveal` (s, 0..1 along the cone) replaces every rib/ring/dot drawRange. Rib vertex i is
//     at s = i/(n-1), each ring has its s, dots/cards/bubbles get s from their story x (checked: the dots'
//     s-fractions reproduce the dome's dotsFracPercent exactly);
//   * one eased tween per beat replaces the keyframe ladders;
//   * the cone turns (CMB beat, final turn) and the Play All zoom are CAMERA moves here (`camAz`, `zoom`),
//     because the visitor owns the camera between them.
//
// state(T) is a pure function of T, so any step can be jumped to and scrubbed in either direction, and
// tests/timeline.test.ts checks it against the kit's `finishedState` for every step.
//
// The story -> true morph (`w`) is NOT on this clock: it is its own toggle (ConeView animates it), because the
// visitor can flip scales at any point of the story.

export interface ConeState {
  /** s of the shell front: ribs, rings, dots, cards, bubbles and the fog clip all follow it. */
  reveal: number;
  flare: number;
  dots: number;
  cmb: number;
  /** Fog opacity (the dome's 45 %). */
  fog: number;
  bubbles: number;
  cardsA: number;
  cardsB: number;
  webb: number;
  source: number;
  ray: number;
  /** Fraction of the light ray drawn, source to telescope. */
  rayReveal: number;
  /** Era label opacities by tag id ("1".."6", "S"). */
  tags: Record<string, number>;
  /** Extra camera azimuth, degrees (positive swings the camera toward +x, i.e. toward today). */
  camAz: number;
  /** Play All zoom: 3.4 = enlarged on the young end, 1 = the whole cone. */
  zoom: number;
}

// cone.json playAll.stepStarts (seconds into Play All) and steps[k].seconds. Kept as constants so the
// timeline has no load-order dependency; tests/timeline.test.ts checks them against the manifest.
export const STEP_STARTS = [0, 4.2, 14.7, 29.2, 38.7, 52.2, 67.7] as const;
export const STEP_SECONDS = [4.2, 9, 13, 8, 12, 14, 14] as const;
export const PLAY_ALL_SECONDS = 82.7;
export const PLAY_ZOOM = { scale: 3.4, focusX: -5.6 } as const;
export const CMB_BEAT = { deg: 45, start: 0.4, out: 4.5, hold: 3, back: 4.5 } as const;
export const FINAL_TURN = { deg: 18, delay: 1, seconds: 13 } as const;
/** The shell front at the end of steps 1, 3, 4, 5 (cone.json constants.shellFracPercent). */
export const SHELL_S = [0.14, 0.36, 0.6, 1] as const;

export function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function smooth(f: number): number { const x = clamp01(f); return x * x * (3 - 2 * x); }

/**
 * Trapezoidal-velocity ease: accelerate over the first `a` of the move, cruise, decelerate over the last `b`
 * (fractions). This is what the dome's "ease 6 s in, 10 s out" means.
 */
export function trapEase(f: number, a: number, b: number): number {
  const x = clamp01(f);
  const v = 1 / (1 - a / 2 - b / 2); // cruise speed so the area under the profile is 1
  if (x < a) { return (v * x * x) / (2 * a); }
  if (x <= 1 - b) { return (v * a) / 2 + v * (x - a); }
  const r = 1 - x;
  return 1 - (v * r * r) / (2 * b);
}

type Ease = (f: number) => number;
const linear: Ease = (f) => clamp01(f);

/** A tween: from wherever the track is at `t0`, go to `to` over `dur` seconds. */
interface Seg { t0: number; dur: number; to: number; ease?: Ease }

function track(T: number, initial: number, segs: Seg[]): number {
  let v = initial;
  for (const s of segs) {
    if (T < s.t0) { break; }
    const f = s.dur > 0 ? (T - s.t0) / s.dur : 1;
    v = f >= 1 ? s.to : v + (s.to - v) * (s.ease ?? smooth)(f);
  }
  return v;
}

const S = STEP_STARTS;
const beatOut = S[2] + CMB_BEAT.start;
const beatBack = beatOut + CMB_BEAT.out + CMB_BEAT.hold;
const beatEnd = beatBack + CMB_BEAT.back;
// The glide out runs from the end of the First-light beat to 4 s into step 5 (cone.json playAll.zoom).
const glideDur = S[5] + 4 - beatEnd;

const TRACKS: Record<Exclude<keyof ConeState, "tags">, (T: number) => number> = {
  reveal: (T) => track(T, 0, [
    { t0: S[1], dur: 7, to: SHELL_S[0], ease: linear },
    { t0: S[3], dur: 6, to: SHELL_S[1], ease: linear },
    { t0: S[4], dur: 10, to: SHELL_S[2], ease: linear },
    { t0: S[5], dur: 12, to: SHELL_S[3], ease: linear },
  ]),
  flare: (T) => track(T, 0, [{ t0: S[1], dur: 1.5, to: 1 }]),
  dots: (T) => track(T, 0, [{ t0: S[1], dur: 0.3, to: 1 }]),
  cmb: (T) => track(T, 0, [{ t0: S[2], dur: 3, to: 1 }]),
  fog: (T) => track(T, 0, [{ t0: S[3], dur: 1, to: 0.45 }]),
  bubbles: (T) => track(T, 0, [{ t0: S[4] + 2, dur: 8, to: 1 }]),
  cardsA: (T) => track(T, 0, [{ t0: S[5] + 3, dur: 4, to: 1 }]),
  cardsB: (T) => track(T, 0, [{ t0: S[5] + 8, dur: 4, to: 1 }]),
  webb: (T) => track(T, 0, [{ t0: S[6], dur: 3, to: 1 }]),
  source: (T) => track(T, 0, [{ t0: S[6], dur: 2, to: 1 }]),
  ray: (T) => track(T, 0, [{ t0: S[6], dur: 0.2, to: 1 }]),
  rayReveal: (T) => track(T, 0, [{ t0: S[6] + 2, dur: 9, to: 1, ease: linear }]),
  camAz: (T) => track(T, 0, [
    { t0: beatOut, dur: CMB_BEAT.out, to: CMB_BEAT.deg, ease: (f) => trapEase(f, 0.5, 0.5) },
    { t0: beatBack, dur: CMB_BEAT.back, to: 0, ease: (f) => trapEase(f, 0.5, 0.5) },
    { t0: S[6] + FINAL_TURN.delay, dur: FINAL_TURN.seconds, to: FINAL_TURN.deg, ease: (f) => trapEase(f, 4 / 13, 4 / 13) },
  ]),
  zoom: (T) => track(T, PLAY_ZOOM.scale, [
    { t0: beatEnd, dur: glideDur, to: 1, ease: (f) => trapEase(f, 6 / glideDur, 10 / glideDur) },
  ]),
};

const TAGS: Record<string, Seg[]> = {
  1: [{ t0: S[1], dur: 2, to: 1 }, { t0: beatOut, dur: 0.8, to: 0 }, { t0: beatEnd, dur: 1.2, to: 1 }],
  2: [{ t0: beatEnd, dur: 1.5, to: 1 }],
  3: [{ t0: S[3], dur: 2, to: 1 }],
  4: [{ t0: S[4], dur: 2, to: 1 }],
  5: [{ t0: S[5], dur: 2, to: 1 }],
  6: [{ t0: S[5] + 9, dur: 2, to: 1 }],
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the kit's tag id
  S: [{ t0: S[6], dur: 3, to: 1 }],
};

export function stateAt(T: number): ConeState {
  const tags: Record<string, number> = {};
  for (const [id, segs] of Object.entries(TAGS)) { tags[id] = track(T, 0, segs); }
  const out = { tags } as ConeState;
  for (const [k, f] of Object.entries(TRACKS)) { (out as unknown as Record<string, number>)[k] = f(T); }
  return out;
}

/** Which step (0 = intro, 1..6) the clock is in. */
export function stepAt(T: number): number {
  let k = 0;
  for (let i = 1; i < S.length; i++) { if (T >= S[i] - 1e-6) { k = i; } }
  return k;
}

/** End of step k's own animation (the moment its finishedState holds). */
export function stepEnd(k: number): number { return S[k] + STEP_SECONDS[k]; }

/** Where the clock stops when step k is played on its own: the start of the next step (or the end). */
export function stepStop(k: number): number { return k + 1 < S.length ? S[k + 1] : PLAY_ALL_SECONDS; }
