/* eslint-disable @typescript-eslint/naming-convention -- these types mirror cone.json's own keys */
// =====================================================================
// cone.json and its binary layers, typed and loaded
// =====================================================================
// The manifest is written by the dome kit (ConeWebKit/pipeline/export_web.py) and repacked for the web by
// pipeline/web_pack.py. Everything here reads it the way the kit's checker does: through cone.json alone.
//
// Frame (cone.json `frame`): light years, +X = time (Big Bang at -L/2, today at +L/2), +Z = up, axis on
// y = z = 0. Every layer stores a story position and a true position; the app lerps between them.

export type AttrType = "f32" | "u8" | "u32";
export interface AttrSpec { byteOffset: number; type: AttrType; components: number; count: number }
export interface LayerSpec {
  file: string;
  byteLength: number;
  kind: string;
  attributes?: Record<string, AttrSpec>;
  [k: string]: unknown;
}
export interface GridObject {
  name: string;
  kind: "rib" | "ring";
  start: number;
  count: number;
  polylineStarts: number[];
  s?: number;
  strong?: boolean;
}
export interface FogSpec extends LayerSpec {
  size: { x: number; y: number; z: number };
  center: [number, number, number];
  halfExtent: [number, number, number];
  emission: [number, number, number];
}
export interface ViewSpec {
  title: string;
  target: [number, number, number];
  cameraOffset: [number, number, number];
  distance: number;
  orbitDegPerSec: number;
}
export interface CosmologyTable {
  s: number[];
  t_Gyr: number[];
  x_story: number[];
  x_true: number[];
  r_story: number[];
  r_true: number[];
}
export interface ConeManifest {
  title: string;
  constants: {
    L: number; R: number; T0_Gyr: number; XC: number; X_TEL: number;
    eraS: Record<string, number>;
    shellFracPercent: number[];
  };
  cosmologyTable: CosmologyTable;
  layers: {
    grid: LayerSpec & { objects: GridObject[] };
    dots: LayerSpec;
    ray: LayerSpec;
    years: LayerSpec & { polylineStarts: number[] };
    bubbles: LayerSpec & { spheres: number; verticesPerSphere: number };
    fog: FogSpec;
    glows: {
      source: { story: [number, number, number]; true: [number, number, number]; rgba: number[] };
      flare: { position: [number, number, number]; rgba: number[] };
    };
  };
  cmb: { image: string; story: { x: number; diameter: number }; true: { x: number; diameter: number } };
  webb: {
    file: string;
    placement: {
      holderPosition: [number, number, number];
      headingDeg: number;
      lyPerModelMeter: number;
      modelBBoxCenter_m_ZupFrame: [number, number, number];
    };
  };
  cardsFile: string;
  labelsFile: string;
  playAll: {
    seconds: number;
    stepStarts: Record<string, number>;
    zoom: { scale: number; focusX: number };
    cmbBeatDeg: { playAll: number; stepButton: number };
    cmbBeatSeconds: { start: number; out: number; hold: number; back: number };
    finalTurnDeg: number;
  };
  views: Record<string, ViewSpec>;
  credits: string[];
}

export interface CardRecord {
  cell: number;
  group: "A" | "B";
  name: string;
  morphType: string;
  class: string;
  survey: string;
  story: { p: number[]; v1: number[]; v2: number[] };
  true: { p: number[]; v1: number[]; v2: number[] };
}
export interface CardsFile {
  atlas: string;
  atlasLite: string;
  grid: number;
  cellPx: number;
  cards: CardRecord[];
}

export interface LabelTag {
  id: string;
  text: string;
  sub: string | null;
  theme: string;
  cardOffset: [number, number, number];
  story: [number, number, number];
  true: [number, number, number];
  shown: "story" | "true" | "both";
}
export interface LabelsFile { tags: LabelTag[]; viewHeadings: Record<string, number> }

export type TypedArray = Float32Array | Uint8Array | Uint32Array;

/** Fetch with a clear error (the boot gate shows it) instead of a JSON parse of an HTML 404 page. */
async function get(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) { throw new Error(`${url}: HTTP ${r.status}`); }
  return r;
}

export async function loadJson<T>(base: string, file: string): Promise<T> {
  return (await get(`${base}/${file}`)).json() as Promise<T>;
}

/**
 * One layer's binary as typed-array views (no copies: every array starts on a 4-byte boundary).
 * Fails loudly on a size mismatch, the same check the kit's checker makes.
 */
export async function loadLayer(base: string, layer: LayerSpec): Promise<Record<string, TypedArray>> {
  const buf = await (await get(`${base}/${layer.file}`)).arrayBuffer();
  if (buf.byteLength !== layer.byteLength) {
    throw new Error(`${layer.file}: ${buf.byteLength} bytes, manifest says ${layer.byteLength}`);
  }
  const out: Record<string, TypedArray> = {};
  for (const [name, a] of Object.entries(layer.attributes ?? {})) {
    const n = a.count * a.components;
    out[name] = a.type === "f32" ? new Float32Array(buf, a.byteOffset, n)
      : a.type === "u8" ? new Uint8Array(buf, a.byteOffset, n)
        : new Uint32Array(buf, a.byteOffset, n);
  }
  return out;
}

export async function loadRaw(base: string, file: string): Promise<ArrayBuffer> {
  return (await get(`${base}/${file}`)).arrayBuffer();
}
