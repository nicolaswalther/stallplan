import type { DetectedArea, NormalizedBox, PdfLine, PdfPageData } from "../types";

type Side = "left" | "top" | "right" | "bottom";
type Axis = "x" | "y";
interface Segment { axis: Axis; position: number; low: number; high: number; stroke: boolean; id: string }
interface Rail { axis: Axis; position: number; low: number; high: number; stroke: boolean; ids: string[]; repeated?: boolean; filledWall?: boolean }
interface BoundaryIndex { x: Rail[]; y: Rail[] }
interface Match { side: Side; rail: Rail; coverage: number; score: number }
const cache = new WeakMap<PdfPageData, BoundaryIndex>();
const ROOM_KINDS = new Set(["feeding_area", "cubicles", "alley", "calving", "pens", "isolation"]);

function segments(lines: PdfLine[], page: PdfPageData): Segment[] {
  const result: Segment[] = [];
  for (const line of lines) {
    const x1 = line.start.x * page.width, x2 = line.end.x * page.width;
    const y1 = line.start.y * page.height, y2 = line.end.y * page.height;
    if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    const stroke = (line.strokeWidth ?? 0) > 0.05;
    if (dx <= 0.6 && dy >= 4) result.push({ axis: "x", position: (x1 + x2) / 2, low: Math.min(y1, y2), high: Math.max(y1, y2), stroke, id: line.id });
    if (dy <= 0.6 && dx >= 4) result.push({ axis: "y", position: (y1 + y2) / 2, low: Math.min(x1, x2), high: Math.max(x1, x2), stroke, id: line.id });
  }
  return result;
}

/** Collinear painted segments form one continuous rail; small construction gaps are tolerated. */
function mergeRails(all: Segment[], axis: Axis): Rail[] {
  const sorted = all.filter((segment) => segment.axis === axis).sort((a, b) => a.position - b.position || a.low - b.low);
  const groups: Segment[][] = [];
  for (const segment of sorted) {
    const previous = groups.at(-1);
    if (previous && Math.abs(previous[0].position - segment.position) <= 0.6) previous.push(segment);
    else groups.push([segment]);
  }
  const rails: Rail[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.low - b.low);
    let current: Rail | undefined;
    for (const segment of group) {
      if (current && segment.low <= current.high + 1.5) {
        current.high = Math.max(current.high, segment.high);
        current.stroke ||= segment.stroke;
        current.ids.push(segment.id);
      } else {
        current = { axis, position: group[0].position, low: segment.low, high: segment.high, stroke: segment.stroke, ids: [segment.id] };
        rails.push(current);
      }
    }
  }
  return rails;
}

function markRepeatedAndFilled(rails: Rail[]) {
  // A family of equally bounded parallel lines is hatching or a module pattern,
  // not independent evidence for a room side. Suppress the entire family,
  // including its first/last line, rather than only its middle members.
  const families = new Map<string, Rail[]>();
  for (const rail of rails) {
    const key = `${Math.round(rail.low / 2)}:${Math.round(rail.high / 2)}`;
    const family = families.get(key) ?? [];
    family.push(rail); families.set(key, family);
  }
  for (const family of families.values()) {
    family.sort((a, b) => a.position - b.position);
    let run: Rail[] = [];
    const finish = () => { if (run.length >= 4) for (const rail of run) rail.repeated = true; };
    for (const rail of family) {
      if (run.length && rail.position - run.at(-1)!.position > 12) { finish(); run = []; }
      run.push(rail);
    }
    finish();
  }
  // Some PDF walls are filled narrow rectangles and therefore have no stroke.
  // Their two parallel sides still provide structural evidence. A lone zero
  // width dimension/construction line does not qualify.
  const sorted = [...rails].sort((a, b) => a.position - b.position);
  for (let index = 0; index < sorted.length; index++) {
    const rail = sorted[index];
    if (rail.stroke || rail.repeated) continue;
    for (let next = index + 1; next < sorted.length; next++) {
      const other = sorted[next], distance = other.position - rail.position;
      if (distance > 3) break;
      if (distance > 0.6 && !other.repeated && Math.abs(rail.low - other.low) <= 1.5 && Math.abs(rail.high - other.high) <= 1.5) {
        rail.filledWall = true; other.filledWall = true;
      }
    }
  }
}

function boundaryIndex(page: PdfPageData): BoundaryIndex {
  const existing = cache.get(page);
  if (existing) return existing;
  const all = segments(page.lines ?? [], page);
  const index = { x: mergeRails(all, "x"), y: mergeRails(all, "y") };
  markRepeatedAndFilled(index.x); markRepeatedAndFilled(index.y);
  cache.set(page, index);
  return index;
}

function horizontalSearchRadius(width: number, height: number) {
  // Narrow pens can have the same absolute model-coordinate error as wide
  // rooms. An 8% width-only search cannot reach their genuine side walls.
  // Allow an aspect-aware correction, capped at 35% of the narrow span; all
  // coverage, enclosure and final-size guards still apply.
  return Math.min(120, Math.max(8, width * 0.08, Math.min(width * 0.35, height * 0.35)));
}

function findRail(rails: Rail[], side: Side, position: number, low: number, high: number, radius: number): Match | undefined {
  const span = high - low;
  if (span <= 0) return;
  let best: Match | undefined;
  for (const rail of rails) {
    const distance = Math.abs(rail.position - position);
    if (distance > radius || rail.repeated || !(rail.stroke || rail.filledWall)) continue;
    const coverage = Math.max(0, Math.min(high, rail.high) - Math.max(low, rail.low)) / span;
    // A short door/cubicle separator is insufficient support for a full side.
    if (coverage < 0.85) continue;
    const score = coverage - 0.2 * distance / radius - (rail.stroke ? 0 : 0.025);
    if (!best || score > best.score) best = { side, rail, coverage, score };
  }
  return best;
}

/**
 * Recover a small rectangular overhang only when a shorter rail and all three
 * other boundaries prove an enclosure. The semantic seed must remain inside;
 * a cubicle island inside a U-shaped alley must not replace the whole alley.
 */
function closeSupportedRectangle(index: BoundaryIndex, x: number[], y: number[], matches: Match[]) {
  for (const axis of ["y", "x"] as const) {
    const bounds = axis === "y" ? y : x, other = axis === "y" ? x : y;
    const sides: [Side, Side] = axis === "y" ? ["top", "bottom"] : ["left", "right"];
    const otherSides: [Side, Side] = axis === "y" ? ["left", "right"] : ["top", "bottom"];
    const otherAxis = axis === "y" ? "x" : "y";
    const radius = axis === "y" ? Math.min(90, Math.max(8, (bounds[1] - bounds[0]) * 0.5)) : horizontalSearchRadius(bounds[1] - bounds[0], other[1] - other[0]);
    for (const sideIndex of [0, 1]) {
      if (matches.some((match) => match.side === sides[sideIndex])) continue;
      let best: { bounds: number[]; other: number[]; matches: Match[]; score: number } | undefined;
      for (const rail of index[axis]) {
        if (rail.repeated || !(rail.stroke || rail.filledWall) || Math.abs(rail.position - bounds[sideIndex]) > radius) continue;
        const shortened = [Math.max(other[0], rail.low), Math.min(other[1], rail.high)];
        const ratio = (shortened[1] - shortened[0]) / (other[1] - other[0]);
        if (ratio < 0.65 || ratio > 0.99) continue;
        // Preserve an already located side. Cropping both ends could select an
        // enclosed cubicle island inside a nonrectangular circulation area.
        if (Math.abs(shortened[0] - other[0]) > 3 && Math.abs(shortened[1] - other[1]) > 3) continue;
        const proposed = [...bounds]; proposed[sideIndex] = rail.position;
        if (proposed[0] >= proposed[1]) continue;
        const axisRatio = (proposed[1] - proposed[0]) / (bounds[1] - bounds[0]);
        if (axisRatio < 0.65 || axisRatio > 1.65) continue;
        const seed = [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2];
        const nextX = axis === "y" ? shortened : proposed, nextY = axis === "y" ? proposed : shortened;
        if (seed[0] < nextX[0] || seed[0] > nextX[1] || seed[1] < nextY[0] || seed[1] > nextY[1]) continue;
        const first = findRail(index[otherAxis], otherSides[0], shortened[0], proposed[0], proposed[1], 3);
        const last = findRail(index[otherAxis], otherSides[1], shortened[1], proposed[0], proposed[1], 3);
        const opposite = findRail(index[axis], sides[1 - sideIndex], proposed[1 - sideIndex], shortened[0], shortened[1], 1.5);
        if (!first || !last || !opposite) continue;
        const own: Match = { side: sides[sideIndex], rail, coverage: 1, score: 1 - 0.2 * Math.abs(rail.position - bounds[sideIndex]) / radius };
        const nextMatches = [first, last, opposite, own];
        const score = nextMatches.reduce((sum, match) => sum + match.score, 0) / 4 - 0.15 * (1 - ratio);
        if (!best || score > best.score) best = { bounds: proposed, other: [first.rail.position, last.rail.position], matches: nextMatches, score };
      }
      if (best) {
        bounds.splice(0, 2, ...best.bounds); other.splice(0, 2, ...best.other);
        matches.splice(0, matches.length, ...best.matches);
      }
    }
  }
}

function validBox(box: NormalizedBox) {
  return Object.values(box).every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= 1 && box.y + box.height <= 1;
}

/** Evidence for the CURRENT rectangle, independently of semantic confidence.
 * A supported rectangle is not proof that it covers a whole nonrectangular room.
 * Recheck all sides after snapping: an earlier match may no longer span the box.
 */
export function assessAreaBoundary(area: DetectedArea, pages: PdfPageData[]) {
  const page = pages.find((candidate) => candidate.pageNumber === area.pageNumber);
  if (!ROOM_KINDS.has(area.kind) || !area.hasBbox || !validBox(area.bbox) || !page?.lines?.length || page.documentKind === "raster") return undefined;
  const index = boundaryIndex(page), box = area.bbox;
  const x = [box.x * page.width, (box.x + box.width) * page.width];
  const y = [box.y * page.height, (box.y + box.height) * page.height];
  const matches = [
    findRail(index.x, "left", x[0], y[0], y[1], 3),
    findRail(index.x, "right", x[1], y[0], y[1], 3),
    findRail(index.y, "top", y[0], x[0], x[1], 3),
    findRail(index.y, "bottom", y[1], x[0], x[1], 3),
  ].filter((match): match is Match => Boolean(match));
  return {
    method: "vector-side-support" as const,
    supportedSides: matches.map((match) => match.side),
    sourceLineIds: [...new Set(matches.flatMap((match) => match.rail.ids.slice(0, 32)))],
  };
}

/**
 * Refine approximate semantic room boxes using continuous vector boundaries.
 * This is a bounded local correction, not room segmentation: absent support,
 * unusual contours, symbols, scans and customer geometry remain unchanged.
 */
export function refineAreaBoundaries(area: DetectedArea, pages: PdfPageData[]): DetectedArea {
  if (!area.hasBbox || area.boundaryRefinement || area.source === "manual" || area.status === "rejected" || area.geometryCorrections?.length || !ROOM_KINDS.has(area.kind) || !validBox(area.bbox)) return area;
  const page = pages.find((candidate) => candidate.pageNumber === area.pageNumber);
  if (!page || page.documentKind === "raster" || !page.lines?.length || !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) return area;
  const index = boundaryIndex(page), before = area.bbox;
  const x = [before.x * page.width, (before.x + before.width) * page.width];
  const y = [before.y * page.height, (before.y + before.height) * page.height];
  const matches: Match[] = [];
  const yRadius = Math.min(90, Math.max(8, (y[1] - y[0]) * 0.5));
  for (const [position, side] of [[y[0], "top"], [y[1], "bottom"]] as const) {
    const match = findRail(index.y, side, position, x[0], x[1], yRadius);
    if (match) { y[side === "top" ? 0 : 1] = match.rail.position; matches.push(match); }
  }
  const xRadius = horizontalSearchRadius(x[1] - x[0], y[1] - y[0]);
  for (const [position, side] of [[x[0], "left"], [x[1], "right"]] as const) {
    const match = findRail(index.x, side, position, y[0], y[1], xRadius);
    if (match) { x[side === "left" ? 0 : 1] = match.rail.position; matches.push(match); }
  }
  closeSupportedRectangle(index, x, y, matches);
  // One isolated rail cannot establish whether it is a room border or a line
  // within the room; require evidence for at least two sides.
  if (matches.length < 2) return area;
  const bbox = { x: x[0] / page.width, y: y[0] / page.height, width: (x[1] - x[0]) / page.width, height: (y[1] - y[0]) / page.height };
  if (!validBox(bbox) || bbox.width / before.width < 0.65 || bbox.width / before.width > 1.65 || bbox.height / before.height < 0.65 || bbox.height / before.height > 1.65) return area;
  const changed = matches.filter((match) => {
    const old = match.side === "left" ? before.x * page.width : match.side === "right" ? (before.x + before.width) * page.width : match.side === "top" ? before.y * page.height : (before.y + before.height) * page.height;
    return Math.abs(old - match.rail.position) > 0.1;
  });
  if (!changed.length) return area;
  const names: Record<Side, string> = { left: "links", top: "oben", right: "rechts", bottom: "unten" };
  const note = `Vektorgrenzen: ${changed.map((match) => names[match.side]).join(", ")} an durchgehende PDF-Linien angepasst. Andere Grenzen bleiben Vorschläge.`;
  return {
    ...area, bbox, originalBbox: area.originalBbox ?? { ...before },
    evidence: [...area.evidence.filter((evidence) => !evidence.startsWith("Vektorgrenzen:")), note],
    boundaryRefinement: {
      method: "vector-rails", originalBbox: { ...before }, snappedSides: changed.map((match) => match.side),
      sourceLineIds: [...new Set(changed.flatMap((match) => match.rail.ids.slice(0, 32)))],
      confidence: Math.min(0.95, matches.reduce((sum, match) => sum + match.score, 0) / matches.length),
    },
  };
}
