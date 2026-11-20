// The web timeline must land every step exactly where the dome does: at the end of each step's own animation,
// the scene state equals the kit's `finishedState` (cone.json steps[k]).
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  PLAY_ALL_SECONDS, PLAY_ZOOM, STEP_SECONDS, STEP_STARTS, stateAt, stepAt, stepStop, trapEase,
} from "../src/cone/timeline";

interface Fs { intensity?: number; drawRange?: number }
const M = JSON.parse(readFileSync(join(__dirname, "../public/data/cone/cone.json"), "utf8"));

describe("timeline constants match cone.json", () => {
  it("step starts, durations and zoom", () => {
    for (let k = 1; k <= 6; k++) {
      expect(STEP_STARTS[k]).toBeCloseTo(M.playAll.stepStarts[String(k)], 6);
      expect(STEP_SECONDS[k]).toBeCloseTo(M.steps[k].seconds, 6);
    }
    expect(PLAY_ALL_SECONDS).toBeCloseTo(M.playAll.seconds, 6);
    expect(PLAY_ZOOM.scale).toBeCloseTo(M.playAll.zoom.scale, 6);
    expect(PLAY_ZOOM.focusX).toBeCloseTo(M.playAll.zoom.focusX, 6);
  });
});

describe("each step ends in the dome's finishedState", () => {
  for (let k = 1; k <= 6; k++) {
    it(`step ${k} (${M.steps[k].name})`, () => {
      const fs: Record<string, Fs> = M.steps[k].finishedState;
      // At the stop (next step start): the dome cuts step 2 at 13 s while its label fade (12.4 + 1.5 s) runs on.
      const st = stateAt(stepStop(k) - 1e-6);
      const pct = (name: string, key: keyof Fs = "intensity") => (fs[name][key] ?? 0) / 100;
      expect(st.reveal).toBeCloseTo(pct("ConeRib01", "drawRange"), 4);
      expect(st.flare).toBeCloseTo(pct("ConeFlare"), 4);
      expect(st.dots).toBeCloseTo(pct("ConeDots"), 4);
      expect(st.cmb).toBeCloseTo(pct("ConeCMB"), 4);
      expect(st.fog).toBeCloseTo(pct("ConeFog"), 4);
      expect(st.bubbles).toBeCloseTo(pct("ConeBubbles"), 4);
      expect(st.cardsA).toBeCloseTo(pct("ConeCardsA"), 4);
      expect(st.cardsB).toBeCloseTo(pct("ConeCardsB"), 4);
      expect(st.webb).toBeCloseTo(pct("ConeWebb"), 4);
      expect(st.source).toBeCloseTo(pct("ConeSource"), 4);
      expect(st.ray).toBeCloseTo(pct("ConeRay"), 4);
      expect(st.rayReveal).toBeCloseTo(pct("ConeRay", "drawRange"), 4);
      for (const id of ["1", "2", "3", "4", "5", "6", "S"]) {
        expect(st.tags[id], `tag ${id}`).toBeCloseTo(pct(`ConeTag${id}`), 4);
      }
      // Rings: on once the front has passed them (the shader fades each in over 0.02 in s).
      const rings = M.layers.grid.objects.filter((o: { kind: string }) => o.kind === "ring");
      for (const r of rings) {
        const on = fs[r.name].intensity! > 0;
        expect(on, r.name).toBe(r.s <= st.reveal + 1e-6);
      }
    });
  }
});

describe("clock behaviour", () => {
  it("is monotone in reveal and scrubs backwards", () => {
    let prev = -1;
    for (let T = 0; T <= PLAY_ALL_SECONDS; T += 0.1) {
      const r = stateAt(T).reveal;
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
    expect(stateAt(0).reveal).toBe(0);
  });
  it("zooms out to the whole cone during steps 3 to 5", () => {
    expect(stateAt(0).zoom).toBeCloseTo(3.4, 6);
    expect(stateAt(STEP_STARTS[5] + 4).zoom).toBeCloseTo(1, 6);
  });
  it("knows which step it is in", () => {
    expect(stepAt(0)).toBe(0);
    expect(stepAt(STEP_STARTS[3])).toBe(3);
    expect(stepAt(PLAY_ALL_SECONDS)).toBe(6);
  });
  it("trapezoid ease is 0 -> 1 and continuous", () => {
    expect(trapEase(0, 0.3, 0.4)).toBe(0);
    expect(trapEase(1, 0.3, 0.4)).toBeCloseTo(1, 9);
    expect(trapEase(0.3 + 1e-9, 0.3, 0.4)).toBeCloseTo(trapEase(0.3 - 1e-9, 0.3, 0.4), 6);
  });
});
