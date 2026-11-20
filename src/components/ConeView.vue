<template>
  <div class="cv">
    <canvas ref="canvas" class="cv-canvas" />
    <!-- Era labels: HTML text on 3D anchors (crisp, readable at any angle, and screen readers get the
         story card instead). The dome's baked PNG cards never turn to the viewer; on a free camera they
         would go edge-on, so here the text stays upright and only the anchor is 3D. -->
    <svg class="cv-leaders" aria-hidden="true">
      <line
        v-for="l in shown" :key="'l' + l.id" :x1="l.ax" :y1="l.ay" :x2="l.x" :y2="l.y"
        :stroke="l.theme" :stroke-opacity="0.75 * l.opacity"
      />
      <circle
        v-for="l in shown" :key="'c' + l.id" :cx="l.ax" :cy="l.ay" r="2.5"
        :fill="l.theme" :fill-opacity="l.opacity"
      />
    </svg>
    <div class="cv-labels" aria-hidden="true">
      <div
        v-for="l in shown" :key="l.id" class="cv-pill"
        :style="{ transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -50%)`, opacity: l.opacity, '--c': l.theme }"
      >
        <span class="cv-pill-t">{{ l.text }}</span>
        <span v-if="l.sub" class="cv-pill-s">{{ l.sub }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw, type PropType } from "vue";

import { ConeScene, LabelOut, PickHit, Reserve, Tier, ViewId } from "../cone/ConeScene";
import { deCollideLabels, LabelBox } from "../cone/labelLayout";
import type { ConeState } from "../cone/timeline";

type Shown = LabelOut & LabelBox;

export default defineComponent({
  name: "ConeView",
  props: {
    base: { type: String, required: true },
    tier: { type: String as PropType<Tier>, default: "full" },
  },
  emits: ["ready", "error", "pick", "user-camera", "double-tap", "context-lost", "rest-loaded"],
  data() {
    return {
      shown: [] as Shown[],
      scene: null as ConeScene | null,
    };
  },
  async mounted() {
    const scene = markRaw(new ConeScene(this.$refs.canvas as HTMLCanvasElement, {
      base: this.base,
      tier: this.tier,
      onFrame: () => this.syncLabels(),
      onUserCamera: () => this.$emit("user-camera"),
      onPick: (hit: PickHit | null) => this.$emit("pick", hit),
      onDoubleTap: () => this.$emit("double-tap"),
      onContextLost: () => this.$emit("context-lost"),
    }));
    this.scene = scene;
    try {
      await scene.loadCore();
    } catch (err) {
      console.error("[ConeView] load failed:", err);
      this.$emit("error", err instanceof Error ? err.message : String(err));
      return;
    }
    this.$emit("ready", scene);
    await scene.loadRest();
    this.$emit("rest-loaded");
  },
  beforeUnmount() { this.scene?.dispose(); },
  methods: {
    setState(st: ConeState): void { this.scene?.setState(st); },
    setMorph(w: number): void { this.scene?.setMorph(w); },
    follow(): void { this.scene?.follow(); },
    setView(v: ViewId, ms?: number): void { this.scene?.setView(v, ms); },
    setReserve(r: Reserve): void { this.scene?.setReserve(r); },
    syncLabels(): void {
      const labels = this.scene?.labels ?? [];
      const small = window.innerWidth < 600;
      const boxes: Shown[] = labels.map((l) => ({ ...l, visible: true }));
      // Keep pills off each other; the leader still ends on the true 3D anchor.
      deCollideLabels(boxes, { strideY: small ? 34 : 42, spreadX: small ? 120 : 170 });
      // Keep each pill inside the part of the screen the UI leaves free; its leader still ends on the anchor.
      const free = this.scene?.freeRect;
      if (free) {
        for (const b of boxes) {
          const half = Math.max(b.text.length, (b.sub ?? "").length * 0.85) * (small ? 3.6 : 4.1) + 12;
          b.x = Math.min(Math.max(b.x, free.left + half + 6), free.right - half - 6);
          b.y = Math.min(Math.max(b.y, free.top + 20), free.bottom - 20);
        }
      }
      this.shown = boxes;
    },
  },
});
</script>

<style lang="less">
.cv { position: absolute; inset: 0; overflow: hidden; }
.cv-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
.cv-leaders { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; line { stroke-width: 1; } }
.cv-labels { position: absolute; inset: 0; pointer-events: none; }
.cv-pill {
  position: absolute; left: 0; top: 0; white-space: nowrap; text-align: center;
  padding: 3px 10px 4px; border-radius: 10px; border: 1px solid var(--c);
  background: rgba(14, 6, 32, 0.82); color: var(--c); line-height: 1.15;
  .cv-pill-t { display: block; font-size: 14px; font-weight: 700; letter-spacing: 0.02em; }
  .cv-pill-s { display: block; font-size: 12px; color: #d8d4f0; }
}
@media (max-width: 599px) {
  .cv-pill { padding: 2px 8px 3px; .cv-pill-t { font-size: 12.5px; } .cv-pill-s { font-size: 11px; } }
}
</style>
