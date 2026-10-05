import type { PdfLine, PdfPageData, PdfTextItem, PlanPoint } from "../types";

export interface AxisLine { source: PdfLine; axis: "horizontal" | "vertical"; from: number; to: number; cross: number; length: number }
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
    if (Math.abs(s.y - e.y) < 0.35 && Math.abs(s.x - e.x) > 0.3) result.push({ source: line, axis: "horizontal", from: Math.min(s.x, e.x), to: Math.max(s.x, e.x), cross: (s.y + e.y) / 2, length: Math.abs(s.x - e.x) });
    else if (Math.abs(s.x - e.x) < 0.35 && Math.abs(s.y - e.y) > 0.3) result.push({ source: line, axis: "vertical", from: Math.min(s.y, e.y), to: Math.max(s.y, e.y), cross: (s.x + e.x) / 2, length: Math.abs(s.y - e.y) });
  }
  return result;
}

/** A tick/arrow or crossing extension at each endpoint is independent evidence. */
export function endpointSupport(line: AxisLine, page: PdfPageData): number {
  const supported = [line.from, line.to].map((coordinate) => {
    const p = line.axis === "horizontal" ? { x: coordinate, y: line.cross } : { x: line.cross, y: coordinate };
    return (page.lines ?? []).some((other) => {
      if (other.id === line.source.id) return false;
      const s = pagePoint(other.start, page), e = pagePoint(other.end, page), dx = e.x - s.x, dy = e.y - s.y;
      const length = Math.hypot(dx, dy);
      if (length < 1 || length > 90) return false;
      if (line.axis === "horizontal" ? Math.abs(dy) < 1 : Math.abs(dx) < 1) return false;
      const t = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / (length * length)));
      return Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy)) < 1.35;
    });
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
    const distance = Math.abs(line.cross - cross), offset = Math.abs((line.from + line.to) / 2 - along);
    const maxDistance = Math.max(7, font * 1.8), maxOffset = Math.max(font * 2.5, textLength * 0.9, line.length * 0.12);
    if (distance > maxDistance || offset > maxOffset || along < line.from - font * 3 || along > line.to + font * 3) continue;
    const centered = Math.max(0, 1 - offset / maxOffset);
    possibilities.push({ line, distance, centered, endpointSupport: 0, score: centered * 0.6 + (1 - distance / maxDistance) * 0.4 });
  }
  return possibilities.sort((a, b) => b.score - a.score).slice(0, 24);
}
