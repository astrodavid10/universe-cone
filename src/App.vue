<template>
  <main class="uc" :class="{ kiosk: kioskMode, 'panel-hidden': panelHidden }">
    <div class="uc-stage">
      <cone-view
        ref="view" :base="dataBase" :tier="tier"
        @ready="onReady" @error="onError" @pick="onPick" @user-camera="onUserCamera"
        @double-tap="resetView" @context-lost="onContextLost" @rest-loaded="restLoaded = true"
      />
    </div>

    <header ref="top" class="uc-top">
      <div class="uc-brand"><brand-mark :size="44" /></div>
      <div class="uc-title">
        <h1>History of the Universe</h1>
        <p class="uc-sub" aria-live="polite">{{ readout }}</p>
      </div>
      <button v-if="!kioskMode" type="button" class="uc-icon" aria-label="Copy a link to this view" @click="share">
        <font-awesome-icon icon="share-nodes" />
      </button>
      <button type="button" class="uc-icon" aria-label="About and credits" @click="showCredits = true">
        <font-awesome-icon icon="circle-info" />
      </button>
    </header>
    <p v-if="toast" class="uc-toast" role="status">{{ toast }}</p>

    <button
      v-if="panelHidden" type="button" class="uc-show" :aria-label="`Show the story: ${step.title}`"
      @click="panelHidden = false"
    >
      <font-awesome-icon icon="chevron-up" /> {{ step.title }}
    </button>

    <section v-show="!panelHidden" ref="panel" class="uc-panel" :aria-label="step.title">
      <div class="uc-meta">
        <span v-for="t in step.tiers" :key="t" class="tier" :class="'tier-' + t.toLowerCase()">{{ t }}</span>
        <span class="uc-progress">{{ stepIndex === 0 ? "Introduction" : `Step ${stepIndex} of 7` }}</span>
        <button v-if="!kioskMode" type="button" class="uc-hide" aria-label="Hide the story panel" @click="panelHidden = true">
          <font-awesome-icon icon="chevron-down" />
        </button>
      </div>
      <h2>{{ step.title }}</h2>
      <p class="uc-detail">{{ step.detail }}</p>
      <p v-if="stepIndex > 0" class="uc-note" :class="{ true: w > 0.5 }">{{ w > 0.5 ? trueNote : storyNote }}</p>
      <p class="uc-body" :class="{ open: bodyOpen }">{{ step.body }}</p>
      <button type="button" class="uc-more" :aria-expanded="bodyOpen" @click="bodyOpen = !bodyOpen">
        {{ bodyOpen ? "Less" : "More: steps and views" }}
      </button>

      <div class="uc-transport">
        <button type="button" class="btn ghost sq" :disabled="stepIndex === 0" aria-label="Previous step" @click="back">
          <font-awesome-icon icon="chevron-left" />
        </button>
        <button type="button" class="btn ghost sq" :aria-label="playing ? 'Pause' : 'Play'" @click="togglePlay">
          <font-awesome-icon :icon="playing ? 'pause' : 'play'" />
        </button>
        <button type="button" class="btn primary" @click="next">
          {{ step.next }} <font-awesome-icon icon="chevron-right" />
        </button>
      </div>

      <div class="uc-scrub">
        <input
          type="range" min="0" :max="playAllSeconds" step="0.05" :value="clock"
          aria-label="Time through the story" :aria-valuetext="readout"
          :style="{ '--fill': (100 * clock / playAllSeconds) + '%' }"
          @input="scrub(Number(($event.target as HTMLInputElement).value))"
        >
        <div class="uc-ticks" aria-hidden="true">
          <span v-for="(t, i) in tickPos" :key="i" :style="{ left: t + '%' }" />
        </div>
      </div>

      <div class="uc-row">
        <div class="uc-seg" role="radiogroup" aria-label="Time scale">
          <button type="button" role="radio" :aria-checked="wTarget < 0.5" :class="{ on: wTarget < 0.5 }" @click="setScale(0)">Story scale</button>
          <button type="button" role="radio" :aria-checked="wTarget >= 0.5" :class="{ on: wTarget >= 0.5 }" @click="setScale(1)">True scale</button>
        </div>
      </div>
      <div class="uc-extra" :class="{ open: bodyOpen }">
        <nav class="uc-steps" aria-label="Steps">
          <button
            v-for="s in steps" :key="s.id" type="button" :class="{ on: s.k === stepIndex, done: s.k < stepIndex }"
            :aria-current="s.k === stepIndex ? 'step' : undefined" :aria-label="`${s.k}. ${s.title}`" @click="goStep(s.k)"
          >
            <span class="n">{{ s.k === 0 ? "◆" : s.k === 7 ? "↔" : s.k }}</span><span class="t">{{ s.short }}</span>
          </button>
        </nav>

        <div class="uc-views" role="group" aria-label="Camera view">
          <button
            v-for="v in views" :key="v.id" type="button" :class="{ on: view === v.id }" :aria-pressed="view === v.id"
            @click="setView(v.id)"
          >{{ v.label }}</button>
        </div>
      </div>
    </section>

    <aside v-if="pick" class="uc-pick" role="dialog" aria-modal="false" :aria-label="pickTitle">
      <button type="button" class="uc-pick-x" aria-label="Close" @click="pick = null">
        <font-awesome-icon icon="xmark" />
      </button>
      <template v-if="pick.kind === 'galaxy'">
        <h3>{{ pick.name }}</h3>
        <p class="uc-pick-sub">{{ galaxyKind(pick) }} · image: {{ pick.survey }}</p>
        <p>
          A real galaxy, but a nearby one: galaxies from this far back are too faint for pictures like this.
          It stands in for the galaxies of its era, so its place in the cone is schematic.
        </p>
      </template>
      <template v-else-if="pick.kind === 'cmb'">
        <h3>The cosmic microwave background</h3>
        <p>
          The oldest light there is, released 380,000 years after the Big Bang and mapped across the whole sky by
          ESA's Planck satellite (the disc shows half of that sky). The spots are temperature differences of about one part in 100,000: the seeds
          of every galaxy that came later.
        </p>
      </template>
      <template v-else>
        <h3>James Webb Space Telescope</h3>
        <p>
          An infrared telescope 1.5 million km from Earth. Light from the first galaxies has been stretched into
          the infrared on its way here, which is exactly where Webb looks. (The model is not to scale.)
        </p>
      </template>
    </aside>

    <credits-sheet v-if="showCredits" @close="showCredits = false" />

    <transition name="fade">
      <div v-if="!ready && !error" class="uc-modal"><loading-cone /></div>
    </transition>
    <div v-if="error" class="uc-modal" role="alertdialog" aria-labelledby="uc-err-t">
      <div class="uc-error">
        <h2 id="uc-err-t">The cone couldn't load</h2>
        <p>{{ error }}</p>
        <button type="button" class="btn primary" @click="reload">Try again</button>
      </div>
    </div>

    <template v-if="kioskMode">
      <div v-if="attract" class="uc-attract" aria-hidden="true">
        <p>Touch to explore</p>
      </div>
      <kiosk-qr :url="kioskHomeUrl" :big="false" />
    </template>
  </main>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, markRaw } from "vue";

import BrandMark from "./components/BrandMark.vue";
import ConeView from "./components/ConeView.vue";
import LoadingCone from "./components/LoadingCone.vue";
import type { ConeScene, PickHit, ViewId } from "./cone/ConeScene";
import { formatAge } from "./cone/cosmo";
import {
  PLAY_ALL_SECONDS, STEP_STARTS, smooth, stateAt, stepAt, stepStop,
} from "./cone/timeline";
import { STEPS, STORY_NOTE, TRUE_NOTE, Step } from "./data/steps";
import { KIOSK_IDLE_MS, KIOSK_RELOAD_HOUR, createIdleWatcher, installKioskGuards, scheduleDailyReload } from "./kiosk/kiosk";
import { boolParam, numberParam, stringParam } from "./urlParams";

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "side", label: "Side" }, { id: "orbit", label: "Orbit" },
  { id: "lookback", label: "Look back" }, { id: "bigbang", label: "Big Bang" },
];
const TRUE_SECONDS = 14; // the dome's true-scale morph
const SCALE_TOGGLE_SECONDS = 5;

export default defineComponent({
  name: "App",
  components: {
    "brand-mark": BrandMark,
    "cone-view": ConeView,
    "loading-cone": LoadingCone,
    "credits-sheet": defineAsyncComponent(() => import("./components/CreditsSheet.vue")),
    "kiosk-qr": defineAsyncComponent(() => import("./components/KioskQr.vue")),
  },
  props: {
    kioskMode: { type: Boolean, default: false },
    kioskHomeUrl: { type: String, default: "" },
  },
  data() {
    return {
      dataBase: "data/cone",
      tier: (stringParam("tier") === "lite" || autoLite() ? "lite" : "full") as "full" | "lite",
      steps: STEPS,
      views: VIEWS,
      storyNote: STORY_NOTE,
      trueNote: TRUE_NOTE,
      playAllSeconds: PLAY_ALL_SECONDS,
      scene: null as ConeScene | null,
      ready: false,
      restLoaded: false,
      error: "",
      clock: 0,
      scrubbed: false,
      playing: false,
      playUntil: null as number | null,
      w: 0,
      wTarget: 0,
      wFrom: 0,
      wT0: 0,
      wMs: 0,
      view: "side" as ViewId,
      panelHidden: false,
      bodyOpen: false,
      pick: null as PickHit | null,
      showCredits: false,
      toast: "",
      raf: 0,
      last: 0,
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      attract: false,
      attractTimer: 0,
      kioskCleanup: [] as (() => void)[],
      ro: null as ResizeObserver | null,
      urlTimer: 0,
    };
  },
  computed: {
    stepIndex(): number {
      return this.wTarget > 0.5 && this.clock >= PLAY_ALL_SECONDS - 1e-3 ? 7 : stepAt(this.clock);
    },
    step(): Step { return this.steps[this.stepIndex]; },
    tickPos(): number[] { return STEP_STARTS.slice(1).map((t) => (100 * t) / PLAY_ALL_SECONDS); },
    readout(): string {
      if (!this.scene) { return "Loading…"; }
      const s = stateAt(this.clock).reveal;
      if (s <= 0) { return "13.8 billion years of cosmic history"; }
      if (s >= 1) { return "Today: 13.8 billion years after the Big Bang"; }
      return `${formatAge(this.scene.cosmo.gyrFromS(s))} after the Big Bang`;
    },
    pickTitle(): string {
      if (!this.pick) { return ""; }
      return this.pick.kind === "galaxy" ? this.pick.name : this.pick.kind === "cmb" ? "Cosmic microwave background" : "JWST";
    },
  },
  watch: {
    stepIndex() { this.bodyOpen = false; this.pick = null; this.queueUrl(); },
    view() { this.queueUrl(); },
    wTarget() { this.queueUrl(); },
  },
  mounted() {
    window.addEventListener("keydown", this.onKey);
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.$refs.panel as HTMLElement);
    this.ro.observe(this.$refs.top as HTMLElement);
    window.addEventListener("resize", this.measure);
    if (this.kioskMode) { this.initKiosk(); }
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.measure);
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    this.kioskCleanup.forEach((f) => f());
  },
  methods: {
    view3d(): InstanceType<typeof ConeView> { return this.$refs.view as InstanceType<typeof ConeView>; },

    onReady(scene: ConeScene): void {
      this.scene = markRaw(scene);
      scene.reducedMotion = this.reduced;
      this.ready = true;
      if (boolParam("debug")) { (window as unknown as { cone: unknown }).cone = { scene, app: this }; }
      // Deep links: ?step=0..7, ?t=<seconds>, ?scale=true, ?view=orbit|lookback|bigbang.
      const step = numberParam("step");
      const t = numberParam("t");
      const scale = stringParam("scale");
      const view = stringParam("view") as ViewId | null;
      if (step !== null && step >= 0 && step <= 7) {
        this.clock = step === 7 ? PLAY_ALL_SECONDS : step === 0 ? 0 : Math.min(PLAY_ALL_SECONDS, stepStop(step) - 1e-3);
        if (step === 7) { this.w = this.wTarget = 1; }
      } else if (t !== null) {
        this.clock = Math.max(0, Math.min(PLAY_ALL_SECONDS, t));
      }
      if (scale === "true") { this.w = this.wTarget = 1; }
      scene.setMorph(this.w);
      this.pushState();
      if (view && VIEWS.some((v) => v.id === view) && view !== "side") { this.setView(view, 0); }
      this.$nextTick(() => this.measure());
    },
    onError(msg: string): void { this.error = msg; },
    onContextLost(): void { this.error = "The graphics card reset. Reload to start again."; },
    reload(): void { window.location.reload(); },

    // ── the clock ────────────────────────────────────────────────────────────────────────────────────
    loop(): void {
      if (this.raf) { return; }
      this.last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        let more = false;
        if (this.playing) {
          this.clock = Math.min(PLAY_ALL_SECONDS, this.clock + dt);
          const stop = this.playUntil ?? PLAY_ALL_SECONDS;
          if (this.clock >= stop - 1e-6) { this.clock = stop; this.playing = false; this.onPlayEnd(); }
          this.pushState();
          more = this.playing;
        }
        if (this.w !== this.wTarget) {
          const f = this.wMs > 0 ? Math.min(1, (now - this.wT0) / this.wMs) : 1;
          // The dome eases the morph 3 s in and 3 s out of 14 s; smoothstep is close enough at other lengths.
          this.w = f >= 1 ? this.wTarget : this.wFrom + (this.wTarget - this.wFrom) * smooth(f);
          this.scene?.setMorph(this.w);
          more = more || this.w !== this.wTarget;
        }
        this.raf = more ? requestAnimationFrame(tick) : 0;
      };
      this.raf = requestAnimationFrame(tick);
    },
    animateW(to: number, seconds: number): void {
      if (this.wTarget === to && this.w === to) { return; }
      this.wFrom = this.w;
      this.wTarget = to;
      this.wT0 = performance.now();
      this.wMs = this.reduced ? 0 : seconds * 1000;
      this.loop();
    },
    play(): void {
      if (this.clock >= PLAY_ALL_SECONDS - 1e-3) { this.clock = 0; this.animateW(0, 2); }
      this.playUntil = null;
      this.playing = true;
      this.followStory();
      this.loop();
    },
    pause(): void { this.playing = false; },
    togglePlay(): void { if (this.playing) { this.pause(); } else { this.play(); } },
    onPlayEnd(): void {
      if (this.attract && this.clock >= PLAY_ALL_SECONDS - 1e-3) {
        this.goStep(7);
        this.attractTimer = window.setTimeout(() => this.runAttract(), (TRUE_SECONDS + 10) * 1000);
      }
    },
    followStory(): void {
      if (this.view !== "side") { this.view = "side"; }
      this.scene?.follow();
    },
    /** Jump to a step and play it on its own, as the dome's step buttons do. */
    goStep(k: number): void {
      this.pick = null;
      if (k === 7) {
        this.playing = false;
        this.clock = PLAY_ALL_SECONDS;
        this.pushState();
        this.followStory();
        this.animateW(1, TRUE_SECONDS);
        return;
      }
      if (this.wTarget > 0) { this.animateW(0, 2.5); }
      this.clock = STEP_STARTS[k];
      this.pushState();
      this.followStory();
      if (k === 0) { this.playing = false; this.scrubbed = false; this.pushState(); return; }
      this.playUntil = stepStop(k);
      this.playing = true;
      this.loop();
    },
    next(): void { this.goStep((this.stepIndex + 1) % STEPS.length); },
    back(): void { this.goStep(Math.max(0, this.stepIndex - 1)); },
    scrub(t: number): void {
      this.playing = false;
      this.clock = t;
      this.scrubbed = true;
      this.pushState();
    },
    /**
     * The intro (clock at 0, nothing played or scrubbed yet) shows the finished cone, whole and unzoomed, so a
     * visitor sees what they're about to build; Begin clears it and builds it from the tip. Otherwise the
     * scene shows the clock.
     */
    pushState(): void {
      const preview = this.clock === 0 && !this.playing && !this.scrubbed;
      this.scene?.setState(preview ? { ...stateAt(PLAY_ALL_SECONDS), camAz: 0, zoom: 1 } : stateAt(this.clock));
    },
    setScale(to: number): void { this.animateW(to, SCALE_TOGGLE_SECONDS); },

    // ── camera ───────────────────────────────────────────────────────────────────────────────────────
    setView(id: ViewId, ms?: number): void {
      this.view = id;
      if (id === "side") { this.followStory(); return; }
      this.view3d().setView(id, this.reduced ? 0 : ms);
    },
    resetView(): void { this.setView(this.view === "side" ? "side" : this.view); },
    onUserCamera(): void { /* the visitor holds the camera until the next step, Play or view button */ },

    onPick(hit: PickHit | null): void { this.pick = hit; },
    galaxyKind(p: PickHit): string {
      if (p.kind !== "galaxy") { return ""; }
      // cone_cards.json classes; morphType is the HyperLEDA type ("SO-a" = S0/a).
      const cls: Record<string, string> = {
        irr: "Irregular galaxy", late: "Late-type spiral", spiral: "Spiral galaxy",
        early: "Elliptical or lenticular galaxy",
      };
      return `${cls[p.cls] ?? "Galaxy"}, type ${p.morphType.replace("SO", "S0")}`;
    },

    // ── layout: tell the 3D view which edges the UI covers ─────────────────────────────────────────
    measure(): void {
      const panel = this.$refs.panel as HTMLElement | undefined;
      const top = this.$refs.top as HTMLElement | undefined;
      if (!panel || !top) { return; }
      const vw = window.innerWidth, vh = window.innerHeight;
      const r = panel.getBoundingClientRect();
      const side = !this.panelHidden && r.width < vw * 0.6; // desktop / landscape: a side panel
      this.view3d()?.setReserve({
        top: top.getBoundingClientRect().bottom * 0.6,
        bottom: this.panelHidden || side ? 0 : Math.max(0, vh - r.top),
        left: 0,
        right: side ? Math.max(0, vw - r.left) : 0,
      });
    },

    // ── URL and sharing ──────────────────────────────────────────────────────────────────────────────
    queueUrl(): void {
      window.clearTimeout(this.urlTimer);
      this.urlTimer = window.setTimeout(() => {
        const q = new URLSearchParams(window.location.search);
        q.delete("t");
        if (this.stepIndex > 0) { q.set("step", String(this.stepIndex)); } else { q.delete("step"); }
        if (this.wTarget >= 0.5 && this.stepIndex !== 7) { q.set("scale", "true"); } else { q.delete("scale"); }
        if (this.view !== "side") { q.set("view", this.view); } else { q.delete("view"); }
        const qs = q.toString();
        history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
      }, 300);
    },
    async share(): Promise<void> {
      const url = window.location.href;
      try {
        if (navigator.share && matchMedia("(pointer: coarse)").matches) {
          await navigator.share({ title: "History of the Universe", url });
          return;
        }
        await navigator.clipboard.writeText(url);
        this.flash("Link copied");
      } catch {
        this.flash("Couldn't copy the link");
      }
    },
    flash(msg: string): void {
      this.toast = msg;
      window.setTimeout(() => { this.toast = ""; }, 2200);
    },

    onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "Escape") {
        if (this.showCredits) { return; } // the sheet handles its own Escape
        if (this.pick) { this.pick = null; return; }
      }
      if (tag === "INPUT" || tag === "BUTTON" && e.key === " ") { return; }
      if (e.key === "ArrowRight") { this.next(); } else if (e.key === "ArrowLeft") { this.back(); } else if (e.key === " ") {
        e.preventDefault();
        this.togglePlay();
      }
    },

    // ── lobby kiosk (?kiosk=1): attract loop = Play All, then the true scale, then again ─────────────
    initKiosk(): void {
      const idleS = numberParam("kioskIdle");
      const watcher = createIdleWatcher({
        idleMs: idleS && idleS > 0 ? idleS * 1000 : KIOSK_IDLE_MS,
        onIdle: () => this.runAttract(),
        onActive: () => { if (this.attract) { this.stopAttract(); } },
      });
      watcher.start();
      this.kioskCleanup.push(() => watcher.stop());
      this.kioskCleanup.push(installKioskGuards({ onExternalLink: () => { /* no navigation on the kiosk */ } }));
      this.kioskCleanup.push(scheduleDailyReload(KIOSK_RELOAD_HOUR, () => this.attract));
      if (boolParam("attract")) { this.runAttract(); }
    },
    runAttract(): void {
      window.clearTimeout(this.attractTimer);
      this.attract = true;
      this.showCredits = false;
      this.pick = null;
      this.animateW(0, 1);
      this.clock = 0;
      this.play();
    },
    stopAttract(): void {
      window.clearTimeout(this.attractTimer);
      this.attract = false;
      this.pause();
    },
  },
});

/** Low-end devices get the lite tier (2k atlas, cheaper fog, DPR 1.5): the JWST app's rule. */
function autoLite(): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return mem !== undefined && mem <= 4;
}
</script>
