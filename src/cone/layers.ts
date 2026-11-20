// =====================================================================
// The cone's layers as three.js objects
// =====================================================================
// Every layer morphs story -> true with the shared uMorph and reveals with the shared uReveal (s along the
// cone), both evaluated in the shaders, so scrubbing in either direction costs nothing on the CPU.
//
// Colour pipeline: display-referred, like the dome. The kit's colours are sRGB bytes and are blended as-is
// (renderer.outputColorSpace = LinearSRGBColorSpace, i.e. no encode; textures are NoColorSpace, i.e. no
// decode). The telescope's textures are switched to NoColorSpace when it loads to match.
//
// Additive layers (lines, dots, cards, CMB, bubbles, glows, ray) never write depth; the opaque telescope does,
// so it hides what is behind it. The fog is premultiplied-alpha and drawn first among the transparent layers.

import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CustomBlending, Data3DTexture,
  DoubleSide, BackSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, LineSegments,
  Mesh, NoColorSpace, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, Points, RedFormat,
  ShaderMaterial, Sprite, SpriteMaterial, Texture, UnsignedByteType, Vector3,
} from "three";
import type { IUniform } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import type { Cosmology } from "./cosmo";
import type { CardRecord, ConeManifest, GridObject, TypedArray } from "./manifest";

/** Uniforms every layer shares (one object, so setting `.value` once updates all materials). */
export interface Shared {
  uReveal: IUniform<number>;
  uMorph: IUniform<number>;
  uExposure: IUniform<number>;
  /** Pixels per world unit at distance 1 (drawing-buffer height / (2 tan(fov/2))), for point sizes. */
  uPxPerUnit: IUniform<number>;
}

export function makeShared(): Shared {
  return { uReveal: { value: 0 }, uMorph: { value: 0 }, uExposure: { value: 1 }, uPxPerUnit: { value: 1000 } };
}

const f32 = (a: TypedArray) => a as Float32Array;
const u8 = (a: TypedArray) => a as Uint8Array;

/** Reveal factor shared by the shaders: fully on once the front passes s, fading in over `edge` before it. */
const REVEAL_GLSL = /* glsl */ `
float revealAt(float s, float edge, float front) {
  return s < -0.5 ? 1.0 : clamp((front - s) / edge + 1.0, 0.0, 1.0);
}`;

function additive(m: ShaderMaterial): ShaderMaterial {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = AdditiveBlending;
  return m;
}

// ── Lines: the grid (ribs + rings) and the billion-year rings ─────────────────────────────────────────────

export interface LineLayer { object: LineSegments; intensity: IUniform<number> }

/**
 * One LineSegments for a whole line layer. Ribs are strips (turned into segment pairs); rings are already
 * pairs. `sOf(i)` gives each vertex its reveal s (or -1 = always on), `edge` the fade-in width in s, and
 * `base` the dome intensity (rib 60 %, ring 40 %, strong ring 85 %).
 */
function lineLayer(
  shared: Shared, attrs: Record<string, TypedArray>, index: number[],
  sOf: Float32Array, edge: Float32Array, base: Float32Array,
): LineLayer {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(f32(attrs.position), 3));
  g.setAttribute("aPosTrue", new BufferAttribute(f32(attrs.position_true), 3));
  g.setAttribute("aColor", new BufferAttribute(u8(attrs.color), 4, true));
  g.setAttribute("aColorTrue", new BufferAttribute(u8(attrs.color_true), 4, true));
  g.setAttribute("aS", new BufferAttribute(sOf, 1));
  g.setAttribute("aEdge", new BufferAttribute(edge, 1));
  g.setAttribute("aBase", new BufferAttribute(base, 1));
  g.setIndex(index);
  const intensity = { value: 0 };
  const m = additive(new ShaderMaterial({
    uniforms: { ...shared, uIntensity: intensity },
    vertexShader: /* glsl */ `
      attribute vec3 aPosTrue; attribute vec4 aColor; attribute vec4 aColorTrue;
      attribute float aS; attribute float aEdge; attribute float aBase;
      uniform float uMorph;
      varying vec4 vColor; varying float vS; varying float vEdge;
      void main() {
        vColor = mix(aColor, aColorTrue, uMorph);
        vColor.a *= aBase;
        vS = aS; vEdge = aEdge;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(position, aPosTrue, uMorph), 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uReveal; uniform float uIntensity; uniform float uExposure;
      varying vec4 vColor; varying float vS; varying float vEdge;
      ${REVEAL_GLSL}
      void main() {
        float a = vColor.a * revealAt(vS, vEdge, uReveal) * uIntensity * uExposure;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(vColor.rgb, a);
      }`,
  }));
  const object = new LineSegments(g, m);
  object.frustumCulled = false;
  return { object, intensity };
}

export function buildGrid(shared: Shared, M: ConeManifest, attrs: Record<string, TypedArray>): LineLayer {
  const objects: GridObject[] = M.layers.grid.objects;
  const n = f32(attrs.position).length / 3;
  const sOf = new Float32Array(n), edge = new Float32Array(n), base = new Float32Array(n);
  const index: number[] = [];
  const dome = { rib: 0.6, ring: 0.4, strong: 0.85 }; // dome intensities (cone.json style.intensities)
  for (const o of objects) {
    if (o.kind === "rib") {
      // web_pack.py thinned each rib; vertex i is still at s = i / (count - 1).
      for (let i = 0; i < o.count; i++) {
        sOf[o.start + i] = i / (o.count - 1);
        edge[o.start + i] = 0.004;
        base[o.start + i] = dome.rib;
        if (i > 0) { index.push(o.start + i - 1, o.start + i); }
      }
    } else {
      for (let i = 0; i < o.count; i++) {
        sOf[o.start + i] = o.s ?? 0;
        edge[o.start + i] = 0.02;
        base[o.start + i] = o.strong ? dome.strong : dome.ring;
      }
      for (let i = 0; i + 1 < o.count; i += 2) { index.push(o.start + i, o.start + i + 1); }
    }
  }
  return lineLayer(shared, attrs, index, sOf, edge, base);
}

export function buildYears(shared: Shared, attrs: Record<string, TypedArray>): LineLayer {
  const n = f32(attrs.position).length / 3;
  const index: number[] = [];
  for (let i = 0; i + 1 < n; i += 2) { index.push(i, i + 1); }
  return lineLayer(shared, attrs, index, new Float32Array(n).fill(-1), new Float32Array(n).fill(1),
    new Float32Array(n).fill(1));
}

// ── Dots: plasma, first stars, galaxies ─────────────────────────────────────────────────────────────────────

export interface DotLayer { object: Points; intensity: IUniform<number>; sizeK: IUniform<number> }

export function buildDots(shared: Shared, attrs: Record<string, TypedArray>, cosmo: Cosmology): DotLayer {
  const pos = f32(attrs.position);
  const n = pos.length / 3;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) { s[i] = cosmo.sFromStoryX(pos[i * 3]); }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aPosTrue", new BufferAttribute(f32(attrs.position_true), 3));
  g.setAttribute("aColor", new BufferAttribute(u8(attrs.color), 4, true));
  g.setAttribute("aColorTrue", new BufferAttribute(u8(attrs.color_true), 4, true));
  g.setAttribute("aSize", new BufferAttribute(f32(attrs.size), 1));
  g.setAttribute("aSizeTrue", new BufferAttribute(f32(attrs.size_true), 1));
  g.setAttribute("aS", new BufferAttribute(s, 1));
  const intensity = { value: 0 };
  const sizeK = { value: 0.022 };
  const m = additive(new ShaderMaterial({
    uniforms: { ...shared, uIntensity: intensity, uSizeK: sizeK },
    vertexShader: /* glsl */ `
      attribute vec3 aPosTrue; attribute vec4 aColor; attribute vec4 aColorTrue;
      attribute float aSize; attribute float aSizeTrue; attribute float aS;
      uniform float uMorph; uniform float uReveal; uniform float uPxPerUnit; uniform float uSizeK;
      varying vec4 vColor;
      ${REVEAL_GLSL}
      void main() {
        float f = revealAt(aS, 0.01, uReveal);
        vec4 mv = modelViewMatrix * vec4(mix(position, aPosTrue, uMorph), 1.0);
        gl_Position = projectionMatrix * mv;
        float px = mix(aSize, aSizeTrue, uMorph) * uSizeK * uPxPerUnit / max(-mv.z, 1e-3);
        // Below 1.5 px a point only shimmers: hold the size and fade it instead, so energy is conserved.
        vColor = mix(aColor, aColorTrue, uMorph);
        vColor.a *= f * clamp(px / 1.5, 0.0, 1.0);
        gl_PointSize = f > 0.0 ? clamp(px, 1.5, 48.0) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity; uniform float uExposure;
      varying vec4 vColor;
      void main() {
        vec2 d = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(d, d);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 3.5) * vColor.a * uIntensity * uExposure;
        gl_FragColor = vec4(vColor.rgb, a);
      }`,
  }));
  const object = new Points(g, m);
  object.frustumCulled = false;
  return { object, intensity, sizeK };
}

// ── Galaxy cards: 236 instanced quads from one atlas ────────────────────────────────────────────────────────

export interface CardLayer {
  object: Mesh;
  intensityA: IUniform<number>;
  intensityB: IUniform<number>;
  /** CPU copies for picking. */
  centersStory: Float32Array;
  centersTrue: Float32Array;
  radius: Float32Array;
  s: Float32Array;
  group: Uint8Array;
  records: CardRecord[];
}

export function buildCards(
  shared: Shared, cards: CardRecord[], grid: number, atlas: Texture, cosmo: Cosmology,
): CardLayer {
  const n = cards.length;
  const pos = new Float32Array(n * 3), posT = new Float32Array(n * 3), v1s = new Float32Array(n * 3),
    v2s = new Float32Array(n * 3), uvs = new Float32Array(n * 2), sArr = new Float32Array(n),
    grp = new Float32Array(n), rad = new Float32Array(n), grpU8 = new Uint8Array(n);
  cards.forEach((c, i) => {
    pos.set(c.story.p, i * 3); posT.set(c.true.p, i * 3);
    v1s.set(c.story.v1, i * 3); v2s.set(c.story.v2, i * 3);
    // cone_cards.json: cell k -> column k % grid, row floor(k / grid) from the TOP; three's flipY puts v = 0
    // at the bottom, so v0 = 1 - (row + 1) / grid.
    uvs[i * 2] = (c.cell % grid) / grid;
    uvs[i * 2 + 1] = 1 - (Math.floor(c.cell / grid) + 1) / grid;
    sArr[i] = cosmo.sFromStoryX(c.story.p[0]);
    grp[i] = grpU8[i] = c.group === "A" ? 0 : 1;
    rad[i] = Math.hypot(...c.story.v1) + Math.hypot(...c.story.v2);
  });
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute("iP", new InstancedBufferAttribute(pos, 3));
  g.setAttribute("iPT", new InstancedBufferAttribute(posT, 3));
  g.setAttribute("iV1", new InstancedBufferAttribute(v1s, 3));
  g.setAttribute("iV2", new InstancedBufferAttribute(v2s, 3));
  g.setAttribute("iUV", new InstancedBufferAttribute(uvs, 2));
  g.setAttribute("iS", new InstancedBufferAttribute(sArr, 1));
  g.setAttribute("iG", new InstancedBufferAttribute(grp, 1));
  g.instanceCount = n;
  atlas.colorSpace = NoColorSpace;
  atlas.anisotropy = 4;
  const intensityA = { value: 0 }, intensityB = { value: 0 };
  const m = additive(new ShaderMaterial({
    uniforms: { ...shared, uAtlas: { value: atlas }, uCell: { value: 1 / grid }, uA: intensityA, uB: intensityB },
    vertexShader: /* glsl */ `
      attribute vec3 iP; attribute vec3 iPT; attribute vec3 iV1; attribute vec3 iV2;
      attribute vec2 iUV; attribute float iS; attribute float iG;
      uniform float uMorph; uniform float uReveal; uniform float uCell; uniform float uA; uniform float uB;
      varying vec2 vUv; varying float vA;
      ${REVEAL_GLSL}
      void main() {
        vec3 c = mix(iP, iPT, uMorph);
        vec3 p = c + position.x * iV1 + position.y * iV2;
        vUv = iUV + (position.xy * 0.5 + 0.5) * uCell;
        vA = revealAt(iS, 0.03, uReveal) * (iG < 0.5 ? uA : uB);
        gl_Position = vA > 0.0 ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas; uniform float uExposure;
      varying vec2 vUv; varying float vA;
      void main() {
        vec3 c = texture2D(uAtlas, vUv).rgb;
        gl_FragColor = vec4(c, vA * uExposure);
      }`,
  }));
  m.side = DoubleSide;
  const object = new Mesh(g, m);
  object.frustumCulled = false;
  return { object, intensityA, intensityB, centersStory: pos, centersTrue: posT, radius: rad, s: sArr, group: grpU8, records: cards };
}

// ── Reionization bubbles ────────────────────────────────────────────────────────────────────────────────────

export interface BubbleLayer { object: Mesh; intensity: IUniform<number> }

/**
 * 64 icospheres with a fresnel rim (the dome's "fadeCenter" glow). Each sphere grows from its centre as the
 * front passes it, so the bubbles "grow and merge" while step 4 sweeps the front from s = 0.36 to 0.60. (The dome
 * could only fade them in; the growth is the web's addition, capped so every bubble is full by s = 0.58.)
 */
export function buildBubbles(
  shared: Shared, attrs: Record<string, TypedArray>, perSphere: number, cosmo: Cosmology,
): BubbleLayer {
  const pos = f32(attrs.position), posT = f32(attrs.position_true);
  const n = pos.length / 3;
  const cen = new Float32Array(n * 3), cenT = new Float32Array(n * 3), sArr = new Float32Array(n);
  for (let s0 = 0; s0 < n; s0 += perSphere) {
    const c = [0, 0, 0], ct = [0, 0, 0];
    for (let i = s0; i < s0 + perSphere; i++) {
      for (let k = 0; k < 3; k++) { c[k] += pos[i * 3 + k] / perSphere; ct[k] += posT[i * 3 + k] / perSphere; }
    }
    const sS = Math.min(cosmo.sFromStoryX(c[0]), 0.53);
    for (let i = s0; i < s0 + perSphere; i++) { cen.set(c, i * 3); cenT.set(ct, i * 3); sArr[i] = sS; }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aPosTrue", new BufferAttribute(posT, 3));
  g.setAttribute("normal", new BufferAttribute(f32(attrs.normal), 3));
  g.setAttribute("aC", new BufferAttribute(cen, 3));
  g.setAttribute("aCT", new BufferAttribute(cenT, 3));
  g.setAttribute("aS", new BufferAttribute(sArr, 1));
  g.setIndex(new BufferAttribute(attrs.index as Uint32Array, 1));
  const intensity = { value: 0 };
  const m = additive(new ShaderMaterial({
    uniforms: { ...shared, uIntensity: intensity },
    vertexShader: /* glsl */ `
      attribute vec3 aPosTrue; attribute vec3 aC; attribute vec3 aCT; attribute float aS;
      uniform float uMorph; uniform float uReveal;
      varying vec3 vN; varying vec3 vV; varying float vGrow;
      void main() {
        vGrow = smoothstep(aS - 0.06, aS + 0.05, uReveal);
        vec3 c = mix(aC, aCT, uMorph);
        vec3 p = c + (mix(position, aPosTrue, uMorph) - c) * max(vGrow, 0.02);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity; uniform float uExposure;
      varying vec3 vN; varying vec3 vV; varying float vGrow;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = (pow(rim, 3.0) * 0.85 + 0.04) * uIntensity * uExposure * smoothstep(0.0, 0.3, vGrow) * 0.55;
        gl_FragColor = vec4(0.22, 0.48, 1.0, a);
      }`,
  }));
  m.side = DoubleSide;
  const object = new Mesh(g, m);
  object.frustumCulled = false;
  return { object, intensity };
}

// ── Neutral-hydrogen fog: a ray-marched volume ─────────────────────────────────────────────────────────────

export interface FogLayer {
  object: Mesh;
  intensity: IUniform<number>;
  /** Fraction of the box along +x that is drawn (the front's story x). */
  clipU: IUniform<number>;
  /** Camera position in the box's local frame; set before each render. */
  camLocal: IUniform<Vector3>;
  center: Vector3;
  half: Vector3;
}

export function buildFog(shared: Shared, M: ConeManifest, data: Uint8Array, steps: number): FogLayer {
  const f = M.layers.fog;
  const tex = new Data3DTexture(data, f.size.x, f.size.y, f.size.z);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  const half = new Vector3(...f.halfExtent);
  const center = new Vector3(...f.center);
  const intensity = { value: 0 }, clipU = { value: 0 }, camLocal = { value: new Vector3() };
  const m = new ShaderMaterial({
    uniforms: {
      ...shared, uVol: { value: tex }, uHalf: { value: half }, uIntensity: intensity, uClipU: clipU,
      uCam: camLocal, uEmission: { value: new Vector3(...f.emission) },
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    defines: { STEPS: steps },
    vertexShader: /* glsl */ `
      uniform vec3 uCam;
      varying vec3 vDir;
      void main() {
        vDir = position - uCam;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp sampler3D;
      uniform sampler3D uVol; uniform vec3 uHalf; uniform vec3 uCam; uniform vec3 uEmission;
      uniform float uIntensity; uniform float uExposure; uniform float uClipU;
      varying vec3 vDir;
      vec2 hitBox(vec3 o, vec3 d) {
        vec3 inv = 1.0 / d;
        vec3 t0 = (-uHalf - o) * inv, t1 = (uHalf - o) * inv;
        vec3 lo = min(t0, t1), hi = max(t0, t1);
        return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
      }
      void main() {
        vec3 d = normalize(vDir);
        vec2 b = hitBox(uCam, d);
        b.x = max(b.x, 0.0);
        if (b.x >= b.y) discard;
        float dt = (b.y - b.x) / float(STEPS);
        // Per-pixel jitter hides the step banding.
        float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 p = uCam + d * (b.x + dt * j);
        float acc = 0.0;
        vec3 col = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 uvw = p / (2.0 * uHalf) + 0.5;
          if (uvw.x <= uClipU) {
            // r = 0.55 x density (the kit's alpha); 2.2 per light year of path at full density.
            float k = 1.0 - exp(-texture(uVol, uvw).r * dt * 2.2);
            col += (1.0 - acc) * uEmission * k;
            acc += (1.0 - acc) * k;
          }
          p += d * dt;
        }
        float I = uIntensity * uExposure;
        gl_FragColor = vec4(col * I, acc * I);
      }`,
  });
  m.transparent = true;
  m.depthWrite = false;
  m.side = BackSide;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  const object = new Mesh(new BoxGeometry(half.x * 2, half.y * 2, half.z * 2), m);
  object.position.copy(center);
  object.renderOrder = -1;
  object.frustumCulled = false;
  return { object, intensity, clipU, camLocal, center, half };
}

// ── The CMB disc ───────────────────────────────────────────────────────────────────────────────────────────

export interface CmbLayer { object: Mesh; intensity: IUniform<number>; story: { x: number; d: number }; true: { x: number; d: number } }

export function buildCmb(shared: Shared, M: ConeManifest, tex: Texture): CmbLayer {
  tex.colorSpace = NoColorSpace;
  const g = new PlaneGeometry(1, 1);
  g.rotateY(Math.PI / 2); // the plane now lies in y-z (the cone's cross-section), facing +x
  const intensity = { value: 0 };
  const m = additive(new ShaderMaterial({
    uniforms: { ...shared, uMap: { value: tex }, uIntensity: intensity },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uIntensity; uniform float uExposure;
      varying vec2 vUv;
      void main() {
        // The disc fills 94 % of the square; trim the JPEG's near-black corners exactly.
        float r = length(vUv - 0.5) * 2.0;
        float edge = 1.0 - smoothstep(0.93, 0.945, r);
        gl_FragColor = vec4(texture2D(uMap, vUv).rgb, edge * uIntensity * uExposure);
      }`,
  }));
  m.side = DoubleSide;
  const object = new Mesh(g, m);
  object.frustumCulled = false;
  return {
    object, intensity,
    story: { x: M.cmb.story.x, d: M.cmb.story.diameter },
    true: { x: M.cmb.true.x, d: M.cmb.true.diameter },
  };
}

// ── Glows: the Big Bang flare and the ray's source galaxy ─────────────────────────────────────────────────

let glowTex: CanvasTexture | null = null;
function glowTexture(): CanvasTexture {
  if (glowTex) { return glowTex; }
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new CanvasTexture(c);
  glowTex.colorSpace = NoColorSpace;
  return glowTex;
}

export function buildGlow(rgba: number[], size: number): Sprite {
  const m = new SpriteMaterial({
    map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
  });
  m.color.setRGB(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255);
  const sp = new Sprite(m);
  sp.scale.setScalar(size);
  sp.frustumCulled = false;
  return sp;
}

// ── The light ray: violet stretching to red ────────────────────────────────────────────────────────────────

export interface RayLayer {
  group: Group;
  core: LineMaterial;
  glow: LineMaterial;
  geometry: LineGeometry;
  setMorph(w: number): void;
  /**
   * Scale the wave's swing about the cone axis (the data's is +-0.25 ly). The crest SPACING carries the
   * meaning (the stretch from ultraviolet to infrared); a full-height swing packs the short-wavelength end into
   * a solid band on small screens.
   */
  setAmplitude(f: number): void;
  setReveal(f: number): void;
  /** `small`: a phone-sized screen, where the wave is drawn thinner still. */
  setResolution(w: number, h: number, dpr: number, small: boolean): void;
}

export function buildRay(attrs: Record<string, TypedArray>): RayLayer {
  const pos = f32(attrs.position), posT = f32(attrs.position_true), col8 = u8(attrs.color);
  const n = pos.length / 3;
  const geometry = new LineGeometry();
  geometry.setPositions(pos);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) { col[i * 3 + k] = col8[i * 4 + k] / 255; } }
  geometry.setColors(col);
  // Widths in CSS px: [desktop, phone].
  const mk = (px: [number, number], opacity: number) => {
    const m = new LineMaterial({ color: 0xffffff, linewidth: px[0], vertexColors: true, worldUnits: false });
    // NOT additive: the wave is a tight zigzag near its source (3,600 points), and additively its own
    // overlapping segments sum to white. Normal blending keeps the violet-to-red colour where it crowds.
    m.transparent = true;
    m.depthWrite = false;
    m.opacity = opacity;
    m.userData.px = px;
    return m;
  };
  const core = mk([1.1, 0.75], 1);
  const glow = mk([3.2, 2], 0.16);
  const group = new Group();
  // The wave runs down the cone's axis, so it must read as INSIDE the cone. Normally blended, it would paint
  // over whatever was drawn before it (ribs, bubbles, fog). So it is drawn FIRST among the transparent layers
  // (glow, then core), without writing depth: the fog then composites over it, and every additive layer,
  // in front or behind, adds onto it, as glowing gas around a beam would.
  [glow, core].forEach((mat, i) => {
    const l = new Line2(geometry, mat);
    l.frustumCulled = false;
    l.renderOrder = -3 + i;
    group.add(l);
  });
  // LineGeometry keeps segment endpoints in one interleaved buffer: [start.xyz, end.xyz] per segment.
  const seg = (geometry.getAttribute("instanceStart") as unknown as { data: { array: Float32Array; needsUpdate: boolean } }).data;
  let lastW = -1;
  let amp = 1;
  return {
    group, core, glow, geometry,
    setMorph(w: number) {
      if (Math.abs(w - lastW) < 1e-5) { return; }
      lastW = w;
      const a = seg.array;
      // The wave lies in the x-z plane on the axis (y = z = 0), so its swing is just z.
      for (let i = 0; i < n - 1; i++) {
        for (let k = 0; k < 3; k++) {
          const s = k === 2 ? amp : 1;
          a[i * 6 + k] = (pos[i * 3 + k] + (posT[i * 3 + k] - pos[i * 3 + k]) * w) * s;
          a[i * 6 + 3 + k] = (pos[(i + 1) * 3 + k] + (posT[(i + 1) * 3 + k] - pos[(i + 1) * 3 + k]) * w) * s;
        }
      }
      seg.needsUpdate = true;
    },
    setAmplitude(f: number) {
      if (f === amp) { return; }
      amp = f;
      const w = lastW;
      lastW = -1;
      this.setMorph(Math.max(0, w));
    },
    setReveal(f: number) {
      geometry.instanceCount = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
    },
    setResolution(w: number, h: number, dpr: number, small: boolean) {
      for (const m of [core, glow]) {
        m.resolution.set(w, h);
        m.linewidth = (m.userData.px as [number, number])[small ? 1 : 0] * dpr;
      }
    },
  };
}

