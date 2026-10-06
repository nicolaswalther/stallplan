import type { PdfLine, PdfPageData, PdfTextItem, PlanPoint } from "../types";

export interface AxisLine { source: PdfLine; axis: "horizontal" | "vertical"; from: number; to: number; cross: number; length: number; sourceLineIds?: string[] }
export interface LineAssociation { line: AxisLine; score: number; endpointSupport: number; distance: number; centered: number }
export function axisOf(item: PdfTextItem): "horizontal" | "vertical" {
  if (item.orientation != null) return Math.abs(Math.sin(item.orientation * Math.PI / 180)) > 0.7 ? "vertical" : "horizontal";
  return item.bbox.height > item.bbox.width * 1.8 ? "vertical" : "horizontal";
}
export function pagePoint(p: PlanPoint, page: Pick<PdfPageData, "width" | "height">): PlanPoint { return { x: p.x * page.width, y: p.y * page.height }; }

export function indexAxisLines(page: PdfPageData): AxisLine[] {
  const result: AxisLine[] = [];
  for (const line of page.lines ?? []) {
    const s = pagePoint(line.start, page), e = pagePoint(line.end, page);
    // A tiny CAD rotation can move the end of a long total rail by several
    // points. Classify direction by angle as well as coordinate precision.
    if (Math.abs(s.y - e.y) < Math.max(.35, Math.abs(s.x - e.x) * Math.tan(.2 * Math.PI / 180)) && Math.abs(s.x - e.x) > 0.3) result.push({ source: line, axis: "horizontal", from: Math.min(s.x, e.x), to: Math.max(s.x, e.x), cross: (s.y + e.y) / 2, length: Math.abs(s.x - e.x) });
    else if (Math.abs(s.x - e.x) < Math.max(.35, Math.abs(s.y - e.y) * Math.tan(.2 * Math.PI / 180)) && Math.abs(s.y - e.y) > 0.3) result.push({ source: line, axis: "vertical", from: Math.min(s.y, e.y), to: Math.max(s.y, e.y), cross: (s.x + e.x) / 2, length: Math.abs(s.y - e.y) });
  }
  return [...result, ...assembleDimensionRails(result, page)];
}

/** CAD writers can draw a rail and its short end strokes as separate paths.
 * Join only exactly touching native collinear segments, retaining the original
 * objects. The joined endpoints are native coordinates, never estimated gaps.
 */
function assembleDimensionRails(lines: AxisLine[], page: PdfPageData): AxisLine[] {
  const stubs = new Map<string, AxisLine[]>();
  const key = (axis: AxisLine["axis"], cross: number, along: number) => `${axis}:${Math.floor(cross / .25)}:${Math.floor(along / 8)}`;
  for (const line of lines) {
    if (line.length > 8) continue;
    for (const coordinate of [line.from, line.to]) {
      const cell = key(line.axis, line.cross, coordinate), members = stubs.get(cell) ?? [];
      members.push(line); stubs.set(cell, members);
    }
  }
  const joined: AxisLine[] = [];
  for (const base of lines) {
    if (base.length < 8) continue;
    let from = base.from, to = base.to;
    const along = (p: PlanPoint) => base.axis === "horizontal" ? p.x : p.y;
    const firstPoint = (line: AxisLine) => along(line.source.start) <= along(line.source.end) ? line.source.start : line.source.end;
    const lastPoint = (line: AxisLine) => along(line.source.start) >= along(line.source.end) ? line.source.start : line.source.end;
    let start = firstPoint(base), end = lastPoint(base);
    const ids = [base.source.id];
    // One adjoining end piece per side avoids crossing a shared tick into
    // the neighboring dimension. A chain's spans must remain separate.
    for (const side of ["from", "to"] as const) for (let iteration = 0; iteration < 1; iteration++) {
      const coordinate = side === "from" ? from : to;
      const crossCell = Math.floor(base.cross / .25), alongCell = Math.floor(coordinate / 8);
      let extension: AxisLine | undefined;
      for (let crossOffset = -1; crossOffset <= 1; crossOffset++) for (let alongOffset = -1; alongOffset <= 1; alongOffset++) {
        for (const stub of stubs.get(`${base.axis}:${crossCell + crossOffset}:${alongCell + alongOffset}`) ?? []) {
          if (ids.includes(stub.source.id) || Math.abs(stub.cross - base.cross) > .15 || stub.length > Math.min(8, base.length * .25)) continue;
          const touches = side === "from" ? Math.abs(stub.to - from) <= .15 && stub.from < from - .25
            : Math.abs(stub.from - to) <= .15 && stub.to > to + .25;
          const added = side === "from" ? base.from - stub.from : stub.to - base.to;
          if (!touches || added > 8) continue;
          if (!extension || (side === "from" ? stub.from < extension.from : stub.to > extension.to)) extension = stub;
        }
      }
      if (!extension) break;
      ids.push(extension.source.id);
      if (side === "from") { from = extension.from; start = firstPoint(extension); }
      else { to = extension.to; end = lastPoint(extension); }
    }
    if (ids.length === 1) continue;
    const cross = base.axis === "horizontal" ? (start.y + end.y) / 2 * page.height : (start.x + end.x) / 2 * page.width;
    joined.push({ ...base, from, to, cross, length: to - from, sourceLineIds: ids,
      source: { ...base.source, id: `${base.source.id}-connected`, start, end } });
  }
  return joined;
}

/** A crossing tick/extension or paired arrowhead is dimension evidence.
 * A wall/cubicle corner merely meeting the rail does not establish a measure.
 */
export function endpointSupport(line: AxisLine, page: PdfPageData): number {
  const supported = [line.source.start, line.source.end].map((endpoint) => {
    const p = pagePoint(endpoint, page);
    const arrowSides: Array<{ parallel: number; cross: number }> = [];
    for (const other of page.lines ?? []) {
      if (other.id === line.source.id) continue;
      const s = pagePoint(other.start, page), e = pagePoint(other.end, page), dx = e.x - s.x, dy = e.y - s.y;
      const length = Math.hypot(dx, dy);
      if (length < 1 || length > 90) continue;
      if (line.axis === "horizontal" ? Math.abs(dy) < 1 : Math.abs(dx) < 1) continue;
      const t = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / (length * length)));
      if (Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy)) >= 1.35) continue;
      if (t * length >= .5 && (1 - t) * length >= .5) return true;
      const startDistance = Math.hypot(p.x - s.x, p.y - s.y), endDistance = Math.hypot(p.x - e.x, p.y - e.y);
      if (Math.min(startDistance, endDistance) >= 1.35) continue;
      const far = startDistance < endDistance ? e : s;
      const parallel = line.axis === "horizontal" ? far.x - p.x : far.y - p.y;
      const cross = line.axis === "horizontal" ? far.y - p.y : far.x - p.x;
      if (Math.abs(parallel) < 1 || Math.abs(cross) < .5 || Math.abs(cross / parallel) < .15 || Math.abs(cross / parallel) > 2) continue;
      if (arrowSides.some((side) => side.parallel * parallel > 0 && side.cross * cross < 0)) return true;
      arrowSides.push({ parallel, cross });
    }
    return false;
  });
  return Number(supported[0]) + Number(supported[1]);
}

export function nearbyDimensionLines(item: PdfTextItem, page: PdfPageData, lines: AxisLine[]): LineAssociation[] {
  const axis = axisOf(item), box = item.bbox;
  const cx = (box.x + box.width / 2) * page.width, cy = (box.y + box.height / 2) * page.height;
  const along = axis === "horizontal" ? cx : cy, cross = axis === "horizontal" ? cy : cx;
  const font = item.fontSize ?? Math.min(box.width * page.width, box.height * page.height);
  const textLength = axis === "horizontal" ? box.width * page.width : box.height * page.height;
  const possibilities: LineAssociation[] = [];
  for (const line of lines) {
    if (line.axis !== axis) continue;
    const s = pagePoint(line.source.start, page), e = pagePoint(line.source.end, page);
    const span = axis === "horizontal" ? e.x - s.x : e.y - s.y;
    const fraction = (along - (axis === "horizontal" ? s.x : s.y)) / span;
    const projectedCross = axis === "horizontal" ? s.y + (e.y - s.y) * fraction : s.x + (e.x - s.x) * fraction;
    const distance = Math.abs(projectedCross - cross), offset = Math.abs((line.from + line.to) / 2 - along);
    const maxDistance = Math.max(7, font * 1.8), maxOffset = Math.max(font * 2.5, textLength * 0.9, line.length * 0.12);
    if (distance > maxDistance || offset > maxOffset || along < line.from - font * 3 || along > line.to + font * 3) continue;
    const centered = Math.max(0, 1 - offset / maxOffset);
    possibilities.push({ line, distance, centered, endpointSupport: 0, score: centered * 0.6 + (1 - distance / maxDistance) * 0.4 });
  }
  return possibilities.sort((a, b) => b.score - a.score).slice(0, 24);
}
