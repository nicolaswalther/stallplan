import type { NormalizedBox, PdfPageData, PlanPoint } from "../types";
import { extractRoomNumberCandidates, type RoomNumberAnchor } from "./semantic-regions";

export interface RoomContourCandidate {
  anchor: RoomNumberAnchor;
  bbox: NormalizedBox;
  footprint: { parts: Array<{ outer: PlanPoint[]; holes: PlanPoint[][] }> };
  method: "vector-free-space";
  resolutionPoints: number;
  sourceLineIds: string[];
}

interface Rail { axis: "x" | "y"; position: number; low: number; high: number; ids: string[]; painted: boolean; repeated?: boolean }
interface Component { label: number; count: number; left: number; top: number; right: number; bottom: number; border: boolean; anchors: RoomNumberAnchor[] }

function structuralRails(page: PdfPageData): Rail[] {
  const segments: Rail[] = [];
  for (const line of page.lines ?? []) {
    if (!Number.isFinite(line.strokeWidth) || line.strokeWidth! < 0) continue;
    if (![line.start.x, line.start.y, line.end.x, line.end.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) continue;
    const painted = line.strokeWidth! > .05;
    const x1 = line.start.x * page.width, x2 = line.end.x * page.width;
    const y1 = line.start.y * page.height, y2 = line.end.y * page.height;
    if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
    if (Math.abs(x2 - x1) <= .6 && Math.abs(y2 - y1) >= 4) segments.push({ axis: "x", position: (x1 + x2) / 2, low: Math.min(y1, y2), high: Math.max(y1, y2), ids: [line.id], painted });
    if (Math.abs(y2 - y1) <= .6 && Math.abs(x2 - x1) >= 4) segments.push({ axis: "y", position: (y1 + y2) / 2, low: Math.min(x1, x2), high: Math.max(x1, x2), ids: [line.id], painted });
  }
  const result: Rail[] = [];
  for (const axis of ["x", "y"] as const) {
    const groups: Rail[][] = [];
    for (const segment of segments.filter((rail) => rail.axis === axis).sort((a, b) => a.position - b.position || a.low - b.low)) {
      const last = groups.at(-1);
      // A painted wall and a nearby hatch may differ by only half a PDF point.
      // Merging their axes creates a spurious barrier across the whole room.
      if (last && Math.abs(last[0].position - segment.position) <= .1) last.push(segment);
      else groups.push([segment]);
    }
    const merged: Rail[] = [];
    for (const group of groups) {
      let current: Rail | undefined;
      for (const segment of group.sort((a, b) => a.low - b.low)) {
        if (current && segment.low <= current.high + 1.5) {
          current.high = Math.max(current.high, segment.high); current.painted ||= segment.painted; current.ids.push(...segment.ids);
        } else {
          current = { ...segment, ids: [...segment.ids] }; merged.push(current);
        }
      }
    }
    const families = new Map<string, Rail[]>();
    for (const rail of merged) {
      const key = `${Math.round(rail.low / 2)}:${Math.round(rail.high / 2)}`;
      const family = families.get(key) ?? []; family.push(rail); families.set(key, family);
    }
    for (const family of families.values()) {
      const runs: Rail[][] = [];
      for (const rail of family.sort((a, b) => a.position - b.position)) {
        const last = runs.at(-1);
        if (last && rail.position - last.at(-1)!.position <= 12) last.push(rail);
        else runs.push([rail]);
      }
      for (const run of runs) if (run.length >= 4) for (const rail of run) rail.repeated = true;
    }
    result.push(...merged.filter((rail) => rail.painted && !rail.repeated && rail.high - rail.low >= 24));
  }
  return result;
}

function signedArea(points: Array<{ x: number; y: number }>) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]; return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

/** Pixel edges retain topology; only exactly collinear vertices are removed. */
function contourRings(labels: Int32Array, width: number, height: number, component: Component) {
  const stride = width + 1;
  const edges = new Map<number, number[]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const start = y1 * stride + x1, end = y2 * stride + x2;
    const existing = edges.get(start) ?? []; existing.push(end); edges.set(start, existing);
  };
  const isInside = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && labels[y * width + x] === component.label;
  for (let y = component.top; y <= component.bottom; y++) for (let x = component.left; x <= component.right; x++) {
    if (!isInside(x, y)) continue;
    if (!isInside(x, y - 1)) add(x, y, x + 1, y);
    if (!isInside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!isInside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!isInside(x - 1, y)) add(x, y + 1, x, y);
  }
  const rings: PlanPoint[][] = [];
  while (edges.size) {
    const start = edges.keys().next().value as number;
    let current = start, previous: number | undefined;
    const ring: PlanPoint[] = [];
    // Every consumed edge is unique; the guard also rejects broken contours.
    const maximum = edges.size * 2 + 4;
    for (let steps = 0; steps < maximum; steps++) {
      const x = current % stride, y = Math.floor(current / stride);
      ring.push({ x, y });
      const options = edges.get(current);
      if (!options?.length) return [];
      let index = 0;
      if (options.length > 1 && previous !== undefined) {
        const incoming = [x - previous % stride, y - Math.floor(previous / stride)];
        const turn = (end: number) => {
          const dx = end % stride - x, dy = Math.floor(end / stride) - y;
          const cross = incoming[0] * dy - incoming[1] * dx, dot = incoming[0] * dx + incoming[1] * dy;
          return cross > 0 ? 3 : dot > 0 ? 2 : cross < 0 ? 1 : 0;
        };
        index = options.reduce((best, option, optionIndex) => turn(option) > turn(options[best]) ? optionIndex : best, 0);
      }
      const next = options.splice(index, 1)[0];
      if (!options.length) edges.delete(current);
      previous = current; current = next;
      if (current === start) break;
    }
    if (current !== start) return [];
    const simplified = ring.filter((point, index) => {
      const before = ring[(index + ring.length - 1) % ring.length], after = ring[(index + 1) % ring.length];
      return (point.x - before.x) * (after.y - point.y) !== (point.y - before.y) * (after.x - point.x);
    });
    if (simplified.length >= 4) rings.push(simplified);
  }
  return rings;
}

/**
 * Native room-number seeds identify closed free-space components after painted
 * hatching is suppressed. Border leaks and components with multiple labels are
 * rejected, rather than joining rooms across doors or inventing partitions.
 * The result is geometry evidence only; a schedule still determines its use.
 */
export function detectRoomContours(page: PdfPageData): RoomContourCandidate[] {
  if (page.documentKind === "raster" || !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0 || Math.max(page.width, page.height) > 4096) return [];
  // Duplicate native indices remain occupancy evidence even though they cannot
  // uniquely identify a contour. Dropping them would hide multi-room ambiguity.
  const anchors = extractRoomNumberCandidates(page), rails = structuralRails(page);
  if (!anchors.length || rails.length < 4) return [];
  const numberCounts = new Map<string, number>();
  for (const anchor of anchors) numberCounts.set(anchor.number, (numberCounts.get(anchor.number) ?? 0) + 1);
  const scale = Math.min(1, 2048 / Math.max(page.width, page.height));
  const width = Math.ceil(page.width * scale), height = Math.ceil(page.height * scale), labels = new Int32Array(width * height);
  for (const rail of rails) {
    const position = Math.floor(rail.position * scale), low = Math.floor(rail.low * scale), high = Math.floor(rail.high * scale);
    for (let along = low; along <= high; along++) for (const across of [position, position + 1]) {
      const x = rail.axis === "x" ? across : along, y = rail.axis === "x" ? along : across;
      if (x >= 0 && x < width && y >= 0 && y < height) labels[y * width + x] = -1;
    }
  }
  const components = new Map<number, Component>(), queue = new Uint32Array(labels.length);
  let nextLabel = 1;
  for (const anchor of anchors) {
    const x = Math.floor((anchor.bbox.x + anchor.bbox.width / 2) * page.width * scale);
    const y = Math.floor((anchor.bbox.y + anchor.bbox.height / 2) * page.height * scale);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const start = y * width + x;
    if (labels[start] === -1) continue;
    if (labels[start] > 0) { components.get(labels[start])!.anchors.push(anchor); continue; }
    const component: Component = { label: nextLabel++, count: 0, left: width, right: 0, top: height, bottom: 0, border: false, anchors: [anchor] };
    let head = 0, tail = 1; queue[0] = start; labels[start] = component.label;
    while (head < tail) {
      const position = queue[head++], cx = position % width, cy = Math.floor(position / width);
      component.count++; component.left = Math.min(component.left, cx); component.right = Math.max(component.right, cx);
      component.top = Math.min(component.top, cy); component.bottom = Math.max(component.bottom, cy);
      component.border ||= cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1;
      for (const neighbor of [cx > 0 ? position - 1 : -1, cx + 1 < width ? position + 1 : -1, cy > 0 ? position - width : -1, cy + 1 < height ? position + width : -1]) {
        if (neighbor >= 0 && labels[neighbor] === 0) { labels[neighbor] = component.label; queue[tail++] = neighbor; }
      }
    }
    components.set(component.label, component);
  }
  const result: RoomContourCandidate[] = [];
  for (const component of components.values()) {
    if (component.border || component.anchors.length !== 1 || numberCounts.get(component.anchors[0].number) !== 1 || component.count / (scale * scale) < 900 || component.count / labels.length > .35) continue;
    const rings = contourRings(labels, width, height, component);
    const outer = rings.filter((ring) => signedArea(ring) > 0).sort((a, b) => signedArea(b) - signedArea(a));
    if (outer.length !== 1 || outer[0].length > 256) continue;
    const normalize = (ring: PlanPoint[]) => ring.map((point) => ({ x: point.x / (page.width * scale), y: point.y / (page.height * scale) }));
    // Tiny pillar/annotation stroke loops do not describe usable room holes.
    const holes = rings.filter((ring) => signedArea(ring) < -576 * scale * scale);
    if (holes.some((ring) => ring.length > 256)) continue;
    const bbox = { x: component.left / (page.width * scale), y: component.top / (page.height * scale), width: (component.right + 1 - component.left) / (page.width * scale), height: (component.bottom + 1 - component.top) / (page.height * scale) };
    const nearbyRails = rails.filter((rail) => rail.axis === "x"
      ? rail.position * scale >= component.left - 2 && rail.position * scale <= component.right + 2 && rail.high * scale >= component.top - 2 && rail.low * scale <= component.bottom + 2
      : rail.position * scale >= component.top - 2 && rail.position * scale <= component.bottom + 2 && rail.high * scale >= component.left - 2 && rail.low * scale <= component.right + 2);
    result.push({ anchor: component.anchors[0], bbox, footprint: { parts: [{ outer: normalize(outer[0]), holes: holes.map(normalize) }] }, method: "vector-free-space", resolutionPoints: 1 / scale, sourceLineIds: [...new Set(nearbyRails.flatMap((rail) => rail.ids))].slice(0, 128) });
  }
  return result;
}
