// =====================================================================
// Camera rig: orbit about a target in the cone frame, with a screen roll
// =====================================================================
// Not OrbitControls, for two reasons:
//   1. Portrait phones. A cone lying on its side is 16 units wide and 10 tall; on a 9:19.5 screen it would be a
//      sliver. The rig rolls the camera -90 deg about its view axis instead, so time runs UP the screen (Big
//      Bang at the bottom, today at the top) and the cone fills the phone. OrbitControls fixes its up vector at
//      construction and can't do that.
//   2. The story choreography (Play All's zoom glide, the CMB turn) and the visitor share one pose: the
//      timeline writes {target, az, el, dist}, a drag takes over from wherever the camera is, and a step jump
//      glides back. That is easier with the pose as plain numbers.
//
// Pose: camera = target + dist * (sin az cos el, -cos az cos el, sin el). az = 0, el = 0 is the dome's side
// view (camera on -Y looking +Y, +X to the right, +Z up). Positive az swings the camera toward +x (today).

import { PerspectiveCamera, Vector3 } from "three";

export interface Pose { target: Vector3; az: number; el: number; dist: number }

export function clonePose(p: Pose): Pose { return { target: p.target.clone(), az: p.az, el: p.el, dist: p.dist }; }

export function lerpPose(a: Pose, b: Pose, f: number, out: Pose): Pose {
  out.target.lerpVectors(a.target, b.target, f);
  out.az = a.az + (b.az - a.az) * f;
  out.el = a.el + (b.el - a.el) * f;
  out.dist = a.dist * Math.pow(b.dist / a.dist, f); // zoom is multiplicative
  return out;
}

const D2R = Math.PI / 180;
const EL_LIMIT = 80;

export interface RigOptions {
  /** Called once per user gesture start (drag, pinch, wheel), so the app can stop following the story. */
  onUserStart: () => void;
  /** Called after any change. */
  onChange: () => void;
  /** Tap (no drag) at canvas CSS px. */
  onTap: (x: number, y: number) => void;
  onDoubleTap: () => void;
}

export class CameraRig {
  pose: Pose = { target: new Vector3(), az: 0, el: 0, dist: 10 };
  /** Screen roll in degrees: 0 landscape, -90 portrait (time runs up). */
  roll = 0;
  minDist = 1;
  maxDist = 100;
  /** Degrees per second of automatic orbit (the Orbit view). */
  autoOrbit = 0;

  private gFrom: Pose | null = null;
  private gTo: Pose | null = null;
  private glideT0 = 0;
  private glideMs = 0;
  private vAz = 0;
  private vEl = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private dist0 = 0;
  private downAt = { x: 0, y: 0, t: 0, moved: false };
  private lastTap = 0;
  private dragging = false;
  private readonly el: HTMLElement;
  private readonly opts: RigOptions;

  constructor(el: HTMLElement, opts: RigOptions) {
    this.el = el;
    this.opts = opts;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  get gliding(): boolean { return this.gTo !== null; }

  /** Glide to a pose over `ms` (0 = jump). Cancels inertia. */
  glide(to: Pose, ms: number, now = performance.now()): void {
    this.vAz = this.vEl = 0;
    if (ms <= 0) { this.pose = clonePose(to); this.gTo = this.gFrom = null; this.opts.onChange(); return; }
    this.gFrom = clonePose(this.pose);
    this.gTo = clonePose(to);
    this.glideT0 = now;
    this.glideMs = ms;
  }

  stopGlide(): void { this.gTo = this.gFrom = null; }

  /** Advance glides, inertia and auto-orbit. Returns true if the pose changed. */
  update(dtMs: number, now = performance.now()): boolean {
    let changed = false;
    if (this.gTo && this.gFrom) {
      const f = Math.min(1, (now - this.glideT0) / this.glideMs);
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      lerpPose(this.gFrom, this.gTo, e, this.pose);
      if (f >= 1) { this.gTo = this.gFrom = null; }
      changed = true;
    }
    if (!this.dragging && (Math.abs(this.vAz) > 1e-3 || Math.abs(this.vEl) > 1e-3)) {
      this.pose.az += this.vAz * dtMs / 16.7;
      this.pose.el = Math.max(-EL_LIMIT, Math.min(EL_LIMIT, this.pose.el + this.vEl * dtMs / 16.7));
      const k = Math.pow(0.9, dtMs / 16.7);
      this.vAz *= k;
      this.vEl *= k;
      changed = true;
    }
    if (this.autoOrbit && !this.dragging && !this.gTo) {
      this.pose.az += this.autoOrbit * dtMs / 1000;
      changed = true;
    }
    return changed;
  }

  apply(camera: PerspectiveCamera): void {
    const { target, az, el, dist } = this.pose;
    const ca = Math.cos(az * D2R), sa = Math.sin(az * D2R), ce = Math.cos(el * D2R), se = Math.sin(el * D2R);
    camera.position.set(target.x + dist * sa * ce, target.y - dist * ca * ce, target.z + dist * se);
    camera.up.set(0, 0, 1);
    camera.lookAt(target);
    if (this.roll) { camera.rotateZ(this.roll * D2R); }
    camera.updateMatrixWorld();
  }

  // ── input ────────────────────────────────────────────────────────────────────────────────────────────

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private userStart(): void {
    this.stopGlide();
    this.opts.onUserStart();
  }

  private onDown = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.downAt = { x: p.x, y: p.y, t: performance.now(), moved: false };
      this.vAz = this.vEl = 0;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      this.dist0 = this.pose.dist;
      this.downAt.moved = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) { return; }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (!this.downAt.moved && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) < 6) { return; }
    if (!this.downAt.moved || !this.dragging) { this.downAt.moved = true; this.dragging = true; this.userStart(); }
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch0 > 0) { this.setDist(this.dist0 * this.pinch0 / Math.max(d, 1)); }
      return;
    }
    // Rotate the drag into the un-rolled frame, so "drag right" always turns the cone the way it looks.
    let dx = p.x - prev.x, dy = p.y - prev.y;
    if (this.roll) {
      const r = -this.roll * D2R, c = Math.cos(r), s = Math.sin(r);
      [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    }
    const k = 180 / Math.max(this.el.clientHeight, 300);
    this.vAz = -dx * k;
    this.vEl = dy * k;
    this.pose.az += this.vAz;
    this.pose.el = Math.max(-EL_LIMIT, Math.min(EL_LIMIT, this.pose.el + this.vEl));
    this.opts.onChange();
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) { return; }
    this.dragging = false;
    this.pinch0 = 0;
    const now = performance.now();
    if (!this.downAt.moved && now - this.downAt.t < 500) {
      if (now - this.lastTap < 320) { this.lastTap = 0; this.opts.onDoubleTap(); } else {
        this.lastTap = now;
        const p = this.local(e);
        this.opts.onTap(p.x, p.y);
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.userStart();
    this.setDist(this.pose.dist * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  };

  private setDist(d: number): void {
    this.pose.dist = Math.max(this.minDist, Math.min(this.maxDist, d));
    this.opts.onChange();
  }

  dispose(): void {
    this.el.removeEventListener("pointerdown", this.onDown);
    this.el.removeEventListener("pointermove", this.onMove);
    this.el.removeEventListener("pointerup", this.onUp);
    this.el.removeEventListener("pointercancel", this.onUp);
    this.el.removeEventListener("wheel", this.onWheel);
  }
}
