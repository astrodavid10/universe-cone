// =====================================================================
// ConeScene: the three.js stage for the cone
// =====================================================================
// Owns the renderer, the layers, the camera rig, label projection and picking. Knows nothing about Vue; the
// view component drives it with setState (the Play All clock), setMorph (story <-> true) and the view/follow
// calls, and reads labels back each frame.
//
// Loading is staged so the first frame is cheap (~2 MB): manifest, grid, dots, CMB and glows first, then
// the fog, bubbles, cards, ray and year rings in the background, then the telescope (2.9 MB) last.

import {
  AmbientLight, DirectionalLight, Group, LinearSRGBColorSpace, Material, Mesh, MeshStandardMaterial,
  NoColorSpace, Object3D, PerspectiveCamera, Scene, Sprite, Texture, TextureLoader, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// @types/three re-exports this module's types from the separate "meshoptimizer" package, which three does not
// install; the runtime module exports MeshoptDecoder itself.
// @ts-expect-error -- types only; see above
import { MeshoptDecoder as meshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { Cosmology } from "./cosmo";
import {
  BubbleLayer, CardLayer, CmbLayer, DotLayer, FogLayer, LineLayer, RayLayer, Shared, buildBubbles, buildCards,
  buildCmb, buildDots, buildFog, buildGlow, buildGrid, buildRay, buildYears, makeShared,
} from "./layers";
import {
  CardsFile, ConeManifest, LabelTag, LabelsFile, loadJson, loadLayer, loadRaw,
} from "./manifest";
import { CameraRig, Pose, clonePose, lerpPose } from "./rig";
import { ConeState, PLAY_ZOOM, clamp01, smooth, stateAt } from "./timeline";

export type Tier = "full" | "lite";
export type ViewId = "side" | "orbit" | "lookback" | "bigbang";

export interface LabelOut {
  id: string;
  text: string;
  sub: string | null;
  theme: string;
  /** Card centre and leader anchor, CSS px. */
  x: number;
  y: number;
  ax: number;
  ay: number;
  opacity: number;
}

export type PickHit =
  | { kind: "galaxy"; name: string; morphType: string; survey: string; cls: string }
  | { kind: "cmb" }
  | { kind: "webb" };

export interface Reserve { top: number; bottom: number; left: number; right: number }

export interface SceneOptions {
  base: string;
  tier: Tier;
  /** Called after each rendered frame (labels move). */
  onFrame: () => void;
  /** The visitor took the camera (drag, pinch, wheel). */
  onUserCamera: () => void;
  onPick: (hit: PickHit | null) => void;
  onDoubleTap: () => void;
  onContextLost: () => void;
}

const FOV = 45;
// What the side view must fit, in the cone frame: the tip to past the telescope, and from below the
// billion-year labels to above the era labels.
const FIT = { x0: -7.4, x1: 10.2, z0: -4.8, z1: 6.6 };

export class ConeScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.02, 400);
  readonly rig: CameraRig;
  manifest!: ConeManifest;
  cosmo!: Cosmology;
  tags: LabelTag[] = [];

  private shared: Shared = makeShared();
  private root = new Group();
  private grid?: LineLayer;
  private years?: LineLayer;
  private dots?: DotLayer;
  private cards?: CardLayer;
  private bubbles?: BubbleLayer;
  private fog?: FogLayer;
  private cmb?: CmbLayer;
  private ray?: RayLayer;
  private flare?: Sprite;
  private source?: Sprite;
  private webb?: Group;
  private webbMats: Material[] = [];
  private webbLoading = false;

  private state: ConeState = stateAt(0);
  private w = 0;
  private view: ViewId = "side";
  private following = true;
  private followFrom: Pose | null = null;
  private followT0 = 0;
  private dirty = true;
  private raf = 0;
  private last = performance.now();
  private reserve: Reserve = { top: 0, bottom: 0, left: 0, right: 0 };
  private size = { w: 1, h: 1, dpr: 1 };
  private sideDist = 10;
  private labelsOut: LabelOut[] = [];
  private readonly opts: SceneOptions;
  private readonly canvas: HTMLCanvasElement;
  private ro: ResizeObserver;
  private paused = false;
  /** prefers-reduced-motion: camera moves are cuts, not glides. */
  reducedMotion = false;

  constructor(canvas: HTMLCanvasElement, opts: SceneOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = LinearSRGBColorSpace; // display-referred, like the dome (layers.ts)
    this.renderer.setClearColor(0x000000, 1);
    this.scene.add(this.root);
    this.camera.up.set(0, 0, 1);
    this.rig = new CameraRig(canvas, {
      onUserStart: () => { this.following = false; opts.onUserCamera(); },
      onChange: () => { this.dirty = true; },
      onTap: (x, y) => opts.onPick(this.pick(x, y)),
      onDoubleTap: () => opts.onDoubleTap(),
    });
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.paused = true; opts.onContextLost(); });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  // ── loading ──────────────────────────────────────────────────────────────────────────────────────────

  /** Manifest plus everything the first frames need. Throws (the boot gate shows the error card). */
  async loadCore(): Promise<void> {
    const base = this.opts.base;
    this.manifest = await loadJson<ConeManifest>(base, "cone.json");
    this.cosmo = new Cosmology(this.manifest.cosmologyTable);
    const [grid, dots, labels, cmbTex] = await Promise.all([
      loadLayer(base, this.manifest.layers.grid),
      loadLayer(base, this.manifest.layers.dots),
      loadJson<LabelsFile>(base, this.manifest.labelsFile),
      new TextureLoader().loadAsync(`${base}/${this.manifest.cmb.image}`),
    ]);
    this.tags = labels.tags;
    this.grid = buildGrid(this.shared, this.manifest, grid);
    this.dots = buildDots(this.shared, dots, this.cosmo);
    this.cmb = buildCmb(this.shared, this.manifest, cmbTex);
    const gl = this.manifest.layers.glows;
    this.flare = buildGlow(gl.flare.rgba, 2.2);
    this.flare.position.set(...gl.flare.position);
    this.source = buildGlow(gl.source.rgba, 0.55);
    this.root.add(this.grid.object, this.dots.object, this.cmb.object, this.flare, this.source);
    this.resize();
    this.applyState();
    this.start();
  }

  /** The rest, in the background. Each layer appears as it lands. */
  async loadRest(): Promise<void> {
    const base = this.opts.base;
    const man = this.manifest;
    const lite = this.opts.tier === "lite";
    const tasks: Promise<void>[] = [
      loadRaw(base, man.layers.fog.file).then((buf) => {
        this.fog = buildFog(this.shared, man, new Uint8Array(buf), lite ? 28 : 56);
        this.root.add(this.fog.object);
      }),
      loadLayer(base, man.layers.bubbles).then((a) => {
        this.bubbles = buildBubbles(this.shared, a, man.layers.bubbles.verticesPerSphere, this.cosmo);
        this.root.add(this.bubbles.object);
      }),
      Promise.all([loadJson<CardsFile>(base, man.cardsFile), loadLayer(base, man.layers.ray), loadLayer(base, man.layers.years)])
        .then(async ([cards, ray, years]) => {
          this.ray = buildRay(ray);
          this.years = buildYears(this.shared, years);
          this.root.add(this.ray.group, this.years.object);
          const atlas: Texture = await new TextureLoader().loadAsync(`${base}/${lite ? cards.atlasLite : cards.atlas}`);
          this.cards = buildCards(this.shared, cards.cards, cards.grid, atlas, this.cosmo);
          this.root.add(this.cards.object);
        }),
    ];
    const results = await Promise.allSettled(tasks);
    for (const r of results) { if (r.status === "rejected") { console.error("[ConeScene] layer failed:", r.reason); } }
    this.resize();
    this.applyState();
    void this.loadWebb();
  }

  private async loadWebb(): Promise<void> {
    if (this.webb || this.webbLoading) { return; }
    this.webbLoading = true;
    try {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(meshoptDecoder as Parameters<GLTFLoader["setMeshoptDecoder"]>[0]);
      const gltf = await loader.loadAsync(`${this.opts.base}/${this.manifest.webb.file}`);
      const pl = this.manifest.webb.placement;
      // glTF is Y-up (model +Z = glTF +Y); the cone frame is Z-up: turn +90 deg about X. The bounding-box centre
      // is given in the Z-up frame, so shift after the turn; then scale and heading on the holder.
      const model = gltf.scene;
      model.rotation.x = Math.PI / 2;
      const shift = new Group();
      shift.position.set(-pl.modelBBoxCenter_m_ZupFrame[0], -pl.modelBBoxCenter_m_ZupFrame[1], -pl.modelBBoxCenter_m_ZupFrame[2]);
      shift.add(model);
      const holder = new Group();
      holder.position.set(...pl.holderPosition);
      // The dome's heading 150 turns the boresight (+X) back toward the Big Bang and 30 deg toward the side
      // camera, which is on -Y: so the boresight ends up at (cos 210, sin 210), i.e. rotation.z = -150 deg here.
      holder.rotation.z = (-pl.headingDeg * Math.PI) / 180;
      holder.scale.setScalar(pl.lyPerModelMeter);
      holder.add(shift);
      model.traverse((o: Object3D) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) { return; }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats as MeshStandardMaterial[]) {
          if (m.map) { m.map.colorSpace = NoColorSpace; m.map.needsUpdate = true; }
          m.metalness = 0;
          m.roughness = 0.65;
          // The dome declares the model emissive 25 %, so its shadowed side never goes black.
          m.emissive.copy(m.color).multiplyScalar(0.25);
          if (m.map) { m.emissiveMap = m.map; m.emissive.setScalar(0.25); }
          m.needsUpdate = true;
          this.webbMats.push(m);
        }
      });
      const amb = new AmbientLight(0xffffff, 0.9);
      const key = new DirectionalLight(0xffffff, 2.2);
      key.position.set(-2, -6, 5);
      holder.add(amb, key);
      key.target = holder;
      this.webb = holder;
      this.root.add(holder);
      this.applyState();
    } catch (err) {
      console.error("[ConeScene] telescope failed:", err);
    }
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────────────────

  setState(st: ConeState): void { this.state = st; this.applyState(); }

  setMorph(w: number): void { this.w = clamp01(w); this.applyState(); }

  get morph(): number { return this.w; }

  private applyState(): void {
    if (!this.manifest) { return; }
    const st = this.state, w = this.w;
    const sh = this.shared;
    sh.uReveal.value = st.reveal;
    sh.uMorph.value = w;
    if (this.grid) { this.grid.intensity.value = st.reveal > 0 ? 1 : 0; }
    if (this.dots) { this.dots.intensity.value = st.dots; }
    if (this.cmb) {
      this.cmb.intensity.value = st.cmb;
      const x = this.cmb.story.x + (this.cmb.true.x - this.cmb.story.x) * w;
      const d = this.cmb.story.d * Math.pow(this.cmb.true.d / this.cmb.story.d, w);
      this.cmb.object.position.set(x, 0, 0);
      this.cmb.object.scale.setScalar(d);
    }
    if (this.flare) {
      (this.flare.material as Material).opacity = st.flare * 0.9 * sh.uExposure.value;
      this.flare.scale.setScalar(2.2 * (1 - 0.6 * w));
    }
    const gl = this.manifest.layers.glows.source;
    if (this.source) {
      (this.source.material as Material).opacity = st.source * sh.uExposure.value;
      this.source.position.set(
        gl.story[0] + (gl.true[0] - gl.story[0]) * w, gl.story[1] + (gl.true[1] - gl.story[1]) * w,
        gl.story[2] + (gl.true[2] - gl.story[2]) * w);
    }
    if (this.fog) {
      // The fog is story-scale only; it fades out early in the morph, as on the dome.
      this.fog.intensity.value = st.fog * (1 - smooth(w / 0.3));
      const x = this.cosmo.storyXFromS(st.reveal);
      this.fog.clipU.value = (x - (this.fog.center.x - this.fog.half.x)) / (2 * this.fog.half.x);
      this.fog.object.visible = this.fog.intensity.value > 0.001;
    }
    if (this.bubbles) { this.bubbles.intensity.value = st.bubbles; this.bubbles.object.visible = st.bubbles > 0.001; }
    if (this.cards) { this.cards.intensityA.value = st.cardsA; this.cards.intensityB.value = st.cardsB; }
    if (this.ray) {
      this.ray.setMorph(w);
      this.ray.setReveal(st.rayReveal);
      this.ray.core.opacity = st.ray * sh.uExposure.value;
      this.ray.glow.opacity = 0.16 * st.ray * sh.uExposure.value;
      this.ray.group.visible = st.ray > 0.001 && st.rayReveal > 0;
    }
    // The billion-year rings belong to the true scale: they slide in from bunched to even as the morph runs.
    if (this.years) { this.years.intensity.value = smooth((w - 0.05) / 0.35); }
    if (st.webb > 0 && !this.webb) { void this.loadWebb(); }
    if (this.webb) {
      this.webb.visible = st.webb > 0.001;
      for (const m of this.webbMats) {
        const fading = st.webb < 0.999;
        if (m.transparent !== fading) { m.transparent = fading; m.needsUpdate = true; }
        m.opacity = st.webb;
      }
    }
    this.dirty = true;
  }

  // ── camera ───────────────────────────────────────────────────────────────────────────────────────────

  get portrait(): boolean {
    const aw = this.size.w - this.reserve.left - this.reserve.right;
    const ah = this.size.h - this.reserve.top - this.reserve.bottom;
    return ah > aw * 1.15;
  }

  /** The side view, fitted to the free part of the screen (after the UI's reserved edges). */
  sidePose(): Pose {
    const aw = Math.max(50, this.size.w - this.reserve.left - this.reserve.right);
    const ah = Math.max(50, this.size.h - this.reserve.top - this.reserve.bottom);
    const t = Math.tan((FOV * Math.PI) / 360);
    const hx = (FIT.x1 - FIT.x0) / 2, hz = (FIT.z1 - FIT.z0) / 2;
    const [vert, horiz] = this.portrait ? [hx, hz] : [hz, hx];
    // The vertical FOV spans the WHOLE canvas (H px), including what the UI covers: at distance d one world
    // unit is H / (2 d t) px, and the box must fit the free aw x ah px.
    const fullH = this.size.h;
    const dist = Math.max((vert * fullH) / (t * ah), (horiz * fullH) / (t * aw)) * 1.08;
    this.sideDist = dist;
    return { target: new Vector3((FIT.x0 + FIT.x1) / 2, 0, (FIT.z0 + FIT.z1) / 2), az: 0, el: 0, dist };
  }

  /** The dome's other instant-nav views, scaled by the side view's fit. */
  viewPose(id: ViewId): Pose {
    const side = this.sidePose();
    if (id === "side" || id === "orbit") { return side; }
    const v = this.manifest.views[id === "lookback" ? "LookBack" : "BigBang"];
    const [ox, oy, oz] = v.cameraOffset;
    // These are close-up views (behind the telescope, beside the tip): keep the dome's distances rather than
    // the side view's fit, padded only when the free area is narrow (the vertical FOV is fixed).
    const aw = Math.max(50, this.size.w - this.reserve.left - this.reserve.right);
    const ah = Math.max(50, this.size.h - this.reserve.top - this.reserve.bottom);
    const scale = 1.1 * Math.max(1, (ah / aw) * (this.size.h / ah) * 0.75);
    return {
      target: new Vector3(...v.target),
      az: (Math.atan2(ox, -oy) * 180) / Math.PI,
      el: (Math.atan2(oz, Math.hypot(ox, oy)) * 180) / Math.PI,
      dist: v.distance * scale,
    };
  }

  /** The Play All camera for a clock state: the side view, zoomed on the young end and turned by camAz. */
  storyPose(st: ConeState): Pose {
    const p = this.sidePose();
    const f = clamp01((st.zoom - 1) / (PLAY_ZOOM.scale - 1));
    p.target.x += (PLAY_ZOOM.focusX - p.target.x) * f;
    p.target.z += (0 - p.target.z) * f;
    p.dist /= st.zoom;
    p.az = st.camAz;
    return p;
  }

  /** Let the story drive the camera again, gliding in from wherever the camera is. */
  follow(): void {
    this.view = "side";
    this.rig.autoOrbit = 0;
    this.rig.stopGlide();
    this.following = true;
    this.followFrom = this.reducedMotion ? null : clonePose(this.rig.pose);
    this.followT0 = performance.now();
    this.dirty = true;
  }

  get isFollowing(): boolean { return this.following; }

  setView(id: ViewId, ms = 1600): void {
    this.view = id;
    this.following = false;
    this.rig.autoOrbit = id === "orbit" ? this.manifest.views.Orbit.orbitDegPerSec : 0;
    this.rig.glide(this.viewPose(id), this.reducedMotion ? 0 : ms);
    this.dirty = true;
  }

  get currentView(): ViewId { return this.view; }

  /** The part of the canvas the UI leaves free, CSS px. */
  get freeRect(): { left: number; right: number; top: number; bottom: number } {
    return { left: this.reserve.left, right: this.size.w - this.reserve.right,
      top: this.reserve.top, bottom: this.size.h - this.reserve.bottom };
  }

  setReserve(r: Reserve): void {
    this.reserve = r;
    this.resize();
  }

  private resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.tier === "lite" ? 1.5 : 2);
    this.size = { w, h, dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Centre the cone in the part of the screen the UI leaves free.
    this.camera.setViewOffset(w, h, (this.reserve.right - this.reserve.left) / 2,
      (this.reserve.bottom - this.reserve.top) / 2, w, h);
    this.camera.updateProjectionMatrix();
    this.shared.uPxPerUnit.value = (h * dpr) / (2 * Math.tan((FOV * Math.PI) / 360));
    // Additive layers saturate faster on a small, bright phone screen than on the dome.
    this.shared.uExposure.value = Math.min(w, h) < 520 ? 0.85 : 1;
    const small = Math.min(w, h) < 520;
    this.ray?.setResolution(w * dpr, h * dpr, dpr, small);
    this.ray?.setAmplitude(small ? 0.4 : 0.6);
    this.rig.roll = this.portrait ? -90 : 0;
    const before = this.sideDist;
    const side = this.sidePose();
    this.rig.minDist = side.dist * 0.12;
    this.rig.maxDist = side.dist * 2.5;
    // A free camera keeps its angle; only its distance follows the new fit (e.g. the bottom sheet grew).
    if (!this.following && before > 0) { this.rig.pose.dist *= side.dist / before; }
    this.dirty = true;
  }

  // ── frame loop ───────────────────────────────────────────────────────────────────────────────────────

  private start(): void {
    if (this.raf) { return; }
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (this.paused) { return; }
      const dt = Math.min(100, now - this.last);
      this.last = now;
      if (this.rig.update(dt, now)) { this.dirty = true; }
      if (this.following) {
        const target = this.storyPose(this.state);
        if (this.followFrom) {
          const f = Math.min(1, (now - this.followT0) / 1400);
          const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
          lerpPose(this.followFrom, target, e, this.rig.pose);
          if (f >= 1) { this.followFrom = null; }
          this.dirty = true;
        } else {
          this.rig.pose = target;
        }
      }
      if (!this.dirty) { return; }
      this.dirty = false;
      this.rig.apply(this.camera);
      if (this.fog) {
        this.fog.camLocal.value.copy(this.camera.position).sub(this.fog.center);
      }
      this.renderer.render(this.scene, this.camera);
      this.projectLabels();
      this.opts.onFrame();
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Mark for redraw (e.g. after a CSS layout change). */
  invalidate(): void { this.dirty = true; }

  // ── labels ───────────────────────────────────────────────────────────────────────────────────────────

  get labels(): LabelOut[] { return this.labelsOut; }

  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpV = new Vector3();

  /** Project a cone-frame point to CSS px; null when behind the camera. */
  project(p: Vector3, out: { x: number; y: number }): boolean {
    this.tmpV.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
    if (this.tmpV.z > -0.01) { return false; }
    this.tmpV.copy(p).project(this.camera);
    out.x = (this.tmpV.x + 1) / 2 * this.size.w;
    out.y = (1 - this.tmpV.y) / 2 * this.size.h;
    return true;
  }

  private projectLabels(): void {
    const w = this.w;
    const out: LabelOut[] = [];
    const hideAll = this.view === "orbit";
    const onlyNear = this.view === "lookback";
    const sa = { x: 0, y: 0 }, sb = { x: 0, y: 0 };
    for (const t of this.tags) {
      let op = t.id in this.state.tags ? this.state.tags[t.id] : 1;
      if (t.shown === "story") { op *= 1 - smooth(w / 0.35); }
      if (t.id === "Y5" || t.id === "Y10") { op *= smooth((w - 0.1) / 0.35); }
      if (t.id === "T") { op *= smooth((w - 0.72) / 0.25); }
      if (hideAll || (onlyNear && t.id !== "6" && t.id !== "S")) { op = 0; }
      if (t.id === "S" && !this.webb) { op = 0; }
      this.tmpA.set(t.story[0] + (t.true[0] - t.story[0]) * w, t.story[1] + (t.true[1] - t.story[1]) * w,
        t.story[2] + (t.true[2] - t.story[2]) * w);
      // The Big Bang view looks up the cone from beside the tip: the far end's labels (Galaxies grow, Today,
      // the telescope) all project near the vanishing point and pile up. This view is about the young
      // universe, so it labels only the young half (anchor x < 0), fading out over the next 1.5 ly. The
      // mirror of the dome's Look Back rule, which keeps only Today and the telescope.
      if (this.view === "bigbang") { op *= 1 - smooth(this.tmpA.x / 1.5); }
      if (op < 0.02) { continue; }
      this.tmpB.copy(this.tmpA).add(this.tmpV.set(...t.cardOffset));
      if (!this.project(this.tmpA, sa) || !this.project(this.tmpB.clone(), sb)) { continue; }
      out.push({ id: t.id, text: t.text, sub: t.sub, theme: t.theme, x: sb.x, y: sb.y, ax: sa.x, ay: sa.y, opacity: op });
    }
    this.labelsOut = out;
  }

  // ── picking ──────────────────────────────────────────────────────────────────────────────────────────

  private pick(x: number, y: number): PickHit | null {
    if (!this.manifest) { return null; }
    const st = this.state, w = this.w;
    const p = new Vector3(), s = { x: 0, y: 0 }, e = { x: 0, y: 0 };
    let best: PickHit | null = null, bestD = Infinity;
    const c = this.cards;
    if (c && (st.cardsA > 0.3 || st.cardsB > 0.3)) {
      const pxPerUnit = this.shared.uPxPerUnit.value / this.size.dpr;
      for (let i = 0; i < c.records.length; i++) {
        const on = (c.group[i] === 0 ? st.cardsA : st.cardsB) * clamp01((st.reveal - c.s[i]) / 0.03 + 1);
        if (on < 0.3) { continue; }
        p.set(c.centersStory[i * 3] + (c.centersTrue[i * 3] - c.centersStory[i * 3]) * w,
          c.centersStory[i * 3 + 1] + (c.centersTrue[i * 3 + 1] - c.centersStory[i * 3 + 1]) * w,
          c.centersStory[i * 3 + 2] + (c.centersTrue[i * 3 + 2] - c.centersStory[i * 3 + 2]) * w);
        if (!this.project(p, s)) { continue; }
        const depth = p.distanceTo(this.camera.position);
        const r = Math.max(18, (c.radius[i] * 0.7 * pxPerUnit) / depth);
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < r && d / r < bestD) {
          bestD = d / r;
          const rec = c.records[i];
          best = { kind: "galaxy", name: rec.name, morphType: rec.morphType, survey: rec.survey, cls: rec.class };
        }
      }
    }
    if (this.webb && st.webb > 0.5) {
      p.set(...this.manifest.webb.placement.holderPosition);
      if (this.project(p, s)) {
        p.z += 1.2;
        this.project(p, e);
        const r = Math.max(24, Math.hypot(e.x - s.x, e.y - s.y));
        const d = Math.hypot(s.x - x, s.y - y) / r;
        if (d < 1 && d < bestD) { bestD = d; best = { kind: "webb" }; }
      }
    }
    if (this.cmb && st.cmb > 0.5 && !best) {
      p.copy(this.cmb.object.position);
      if (this.project(p, s)) {
        p.z += this.cmb.object.scale.x * 0.47;
        this.project(p, e);
        const r = Math.max(22, Math.hypot(e.x - s.x, e.y - s.y));
        if (Math.hypot(s.x - x, s.y - y) < r) { best = { kind: "cmb" }; }
      }
    }
    return best;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.rig.dispose();
    this.renderer.dispose();
  }
}
