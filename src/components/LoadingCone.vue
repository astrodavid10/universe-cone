<template>
  <div class="lcone" role="status" aria-live="polite">
    <svg viewBox="-10 -60 230 120" width="300" height="157" aria-hidden="true">
      <defs>
        <radialGradient id="lcone-flare">
          <stop offset="0" stop-color="#fff5e0" stop-opacity="1" />
          <stop offset="0.4" stop-color="#ffc66b" stop-opacity="0.5" />
          <stop offset="1" stop-color="#ffc66b" stop-opacity="0" />
        </radialGradient>
      </defs>
      <!-- Ribs draw out from the tip, like step 1 of the dome show. -->
      <path
        v-for="(d, i) in ribs" :key="'r' + i" class="rib" :d="d" pathLength="1"
        :style="{ strokeDashoffset: 1 - grow }"
      />
      <ellipse
        v-for="(r, i) in rings" :key="'g' + i" class="ring" :class="{ strong: r.strong }"
        :cx="r.x" cy="0" :rx="r.rx" :ry="r.ry" :style="{ opacity: r.x <= front ? 1 : 0 }"
      />
      <circle cx="0" cy="0" r="16" fill="url(#lcone-flare)" />
    </svg>
    <p>Building the universe…</p>
    <p class="lcone-sub">13.8 billion years, from the Big Bang to today</p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

const L = 200;
const CYCLE_MS = 2600;
/** Cone radius at x (0..L): fast early growth, then steady, like the story-scale shell. */
const radius = (x: number) => 48 * Math.pow(x / L, 0.55);

export default defineComponent({
  name: "LoadingCone",
  data() {
    return { t: 0, raf: 0, t0: 0, reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches };
  },
  computed: {
    grow(): number { return this.reduced ? 1 : Math.min(1, this.t * 1.25); },
    front(): number { return this.grow * L; },
    ribs(): string[] {
      const out: string[] = [];
      for (let k = 0; k < 9; k++) {
        const c = Math.cos(((k + 0.5) / 9) * Math.PI); // ribs on the near half, flattened like a side view
        let d = "M0 0";
        for (let x = 5; x <= L; x += 5) { d += ` L${x} ${(radius(x) * c).toFixed(2)}`; }
        out.push(d);
      }
      return out;
    },
    rings(): { x: number; rx: number; ry: number; strong: boolean }[] {
      return [28, 70, 120, 160, 200].map((x, i) => ({ x, rx: radius(x) * 0.22, ry: radius(x), strong: i === 0 || i === 4 }));
    },
  },
  mounted() {
    if (this.reduced) { return; }
    const tick = (now: number) => {
      if (!this.t0) { this.t0 = now; }
      this.t = ((now - this.t0) % CYCLE_MS) / CYCLE_MS;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  beforeUnmount() { cancelAnimationFrame(this.raf); },
});
</script>

<style lang="less">
.lcone {
  text-align: center; color: #eef0ff;
  p { margin: 10px 0 0; font-size: 18px; font-weight: 600; letter-spacing: 0.04em; }
  .lcone-sub { margin-top: 4px; font-size: 14px; font-weight: 400; color: #b9bfe6; }
  .rib { fill: none; stroke: #ffe6bf; stroke-opacity: 0.55; stroke-width: 0.8; stroke-dasharray: 1; }
  .ring { fill: none; stroke: #ffdda9; stroke-opacity: 0.45; stroke-width: 0.8; transition: opacity 0.2s; }
  .ring.strong { stroke: #ffb259; stroke-opacity: 0.9; }
}
</style>
