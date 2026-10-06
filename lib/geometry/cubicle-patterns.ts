import type { DetectedArea, NormalizedBox, PdfPageData, PdfTextItem } from "../types";

interface Cap { index: number; x: number; y: number; width: number; height: number }
interface Vertical { id: string; x: number; from: number; to: number }
const median = (values: number[]) => { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor(ordered.length / 2)]; };

function capRows(page: PdfPageData): Cap[][] {
  const caps = (page.rasterImages ?? []).flatMap((image, index) => {
    const width = image.width * page.width, height = image.height * page.height;
    // End masks are very small, tall elements. Page scans and symbol images
    // cannot serve as cubicle row endpoints merely because their boxes align.
    return width >= .08 && width <= 3 && height >= .5 && height <= 3 && height / width >= 2
      ? [{ index, x: (image.x + image.width / 2) * page.width, y: (image.y + image.height / 2) * page.height, width, height }] : [];
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Cap[][] = [];
  for (const cap of caps) {
    const previous = rows.at(-1);
    if (previous && Math.abs(cap.y - previous[0].y) <= 1) previous.push(cap);
    else rows.push([cap]);
  }
  return rows.filter((row) => row.length >= 2).map((row) => row.sort((a, b) => a.x - b.x));
}

function collapseAxes(lines: Vertical[], tolerance: number) {
  const clusters: Vertical[][] = [];
  for (const line of [...lines].sort((a, b) => a.x - b.x)) {
    const previous = clusters.at(-1);
    if (previous && line.x - previous[0].x <= tolerance) previous.push(line);
    else clusters.push([line]);
  }
  return clusters.map((cluster) => ({ x: cluster.reduce((sum, line) => sum + line.x, 0) / cluster.length, lines: cluster }));
}

/** Two aligned families of regularly spaced dividers must fill the entire
 * end-bounded row. A dense hatch, a short partial run or repeated text strokes
 * alone cannot satisfy the double-sided furniture proof. */
function dividerProof(lines: Vertical[], left: number, right: number, top: number, bottom: number, firstSpine: number, secondSpine: number) {
  const height = bottom - top;
  const groups = new Map<string, Vertical[]>();
  for (const line of lines) {
    if (line.x <= left + 3 || line.x >= right - 3 || line.from < top - 1 || line.to > bottom + 1
      || line.to - line.from < height * .18 || line.to - line.from > height * .42
      || !(line.to < firstSpine - 2 || line.from > secondSpine + 2)) continue;
    const key = `${Math.round(line.from / 2)}:${Math.round(line.to / 2)}`;
    const group = groups.get(key) ?? []; group.push(line); groups.set(key, group);
  }
  const families = [...groups.values()].map((group) => {
    const axes = collapseAxes(group, Math.max(2.5, height * .02));
    if (axes.length < 6) return null;
    const gaps = [axes[0].x - left, ...axes.slice(1).map((axis, index) => axis.x - axes[index].x), right - axes.at(-1)!.x];
    const spacing = median(gaps);
    if (spacing < 3 || spacing > height * .5 || gaps.some((gap, index) =>
      Math.abs(gap - spacing) > Math.max(2, spacing * (index === 0 || index === gaps.length - 1 ? .2 : .12)))) return null;
    return { axes, spacing, from: median(group.map((line) => line.from)), to: median(group.map((line) => line.to)) };
  }).filter((family) => family !== null);
  for (const upper of families) for (const lower of families) {
    if (upper.to >= firstSpine || lower.from <= secondSpine || upper.axes.length !== lower.axes.length
      || Math.abs(upper.spacing - lower.spacing) > 2
      || Math.abs((upper.from + upper.to + lower.from + lower.to) / 4 - (firstSpine + secondSpine) / 2) > 3
      || upper.axes.some((axis, index) => Math.abs(axis.x - lower.axes[index].x) > 2.5)) continue;
    return { count: upper.axes.length, spacing: (upper.spacing + lower.spacing) / 2,
      sourceLineIds: [...new Set([...upper.axes, ...lower.axes].flatMap((axis) => axis.lines.map((line) => line.id)))].slice(0, 160) };
  }
  return null;
}

/** Conservative fallback for double cubicle rows drawn with paired tiny
 * raster end masks and native vector furniture. No document coordinates,
 * labels, scale assumptions or model predictions supply the detected boxes. */
export function detectCubiclePatterns(page: PdfPageData, excludedRoomLabels: PdfTextItem[] = []): DetectedArea[] {
  if (page.width <= 0 || page.height <= 0 || !page.lines?.length || page.rasterGeometryComplete !== true) return [];
  const rows = capRows(page);
  if (rows.length < 2) return [];
  const vertical: Vertical[] = [];
  for (const line of page.lines) {
    const x1 = line.start.x * page.width, x2 = line.end.x * page.width;
    const from = Math.min(line.start.y, line.end.y) * page.height;
    const to = Math.max(line.start.y, line.end.y) * page.height;
    if (Math.abs(x2 - x1) <= .2 && to - from >= 3) vertical.push({ id: line.id, x: (x1 + x2) / 2, from, to });
  }
  const result: DetectedArea[] = [];
  for (let rowIndex = 0; rowIndex + 1 < rows.length; rowIndex++) {
    const upper = rows[rowIndex], lower = rows[rowIndex + 1];
    const separation = lower[0].y - upper[0].y;
    if (separation < 4 || separation > 40) continue;
    const paired = upper.flatMap((cap) => {
      const other = lower.find((candidate) => Math.abs(candidate.x - cap.x) <= 1
        && Math.max(candidate.height, cap.height) <= 1.5 * Math.min(candidate.height, cap.height)
        && Math.max(candidate.width, cap.width) <= 1.5 * Math.min(candidate.width, cap.width));
      return other ? [{ upper: cap, lower: other, x: (cap.x + other.x) / 2 }] : [];
    });
    for (let index = 0; index + 1 < paired.length; index++) {
      const first = paired[index], last = paired[index + 1];
      if (last.x - first.x < separation * 8) continue;
      const side = (x: number) => vertical.filter((line) => Math.abs(line.x - x) <= 3
        && line.from <= upper[0].y - separation * 2 && line.to >= lower[0].y + separation * 2
        && line.to - line.from <= separation * 20);
      const candidates = side(first.x).flatMap((left) => side(last.x).filter((right) =>
        Math.abs(left.from - right.from) <= 2 && Math.abs(left.to - right.to) <= 2).map((right) => ({ left, right,
        distance: Math.abs(left.x - first.x) + Math.abs(right.x - last.x) })));
      candidates.sort((a, b) => a.distance - b.distance);
      for (const candidate of candidates) {
        const left = candidate.left.x, right = candidate.right.x;
        const top = (candidate.left.from + candidate.right.from) / 2, bottom = (candidate.left.to + candidate.right.to) / 2;
        // PDF extraction may retain slight overscan. Do not clamp those lines
        // into fabricated row endpoints or import an out-of-page footprint.
        if (left < 0 || top < 0 || right > page.width || bottom > page.height) continue;
        const proof = dividerProof(vertical, left, right, top, bottom, upper[0].y, lower[0].y);
        if (!proof) continue;
        const bbox: NormalizedBox = { x: left / page.width, y: top / page.height, width: (right - left) / page.width, height: (bottom - top) / page.height };
        if (excludedRoomLabels.some((item) => item.bbox.x + item.bbox.width / 2 >= bbox.x && item.bbox.x + item.bbox.width / 2 <= bbox.x + bbox.width
          && item.bbox.y + item.bbox.height / 2 >= bbox.y && item.bbox.y + item.bbox.height / 2 <= bbox.y + bbox.height)) break;
        const rasterImageIndices = [first.upper.index, first.lower.index, last.upper.index, last.lower.index];
        result.push({ id: `pattern-cubicles-${page.pageNumber}-${rasterImageIndices.join("-")}`, kind: "cubicles", label: "Liegeboxen",
          pageNumber: page.pageNumber, bbox, hasBbox: true, source: "geometry", status: "unconfirmed", confidence: .88,
          evidence: ["Doppelreihe aus vier kleinen PDF-Endkappen und zwei durchgehenden Stirnkanten erkannt.",
            `${proof.count} regelmäßig angeordnete Trennstäbe auf beiden Seiten der Mittelachse.`, "Bereichsart anhand des Zeichnungsmusters erkannt; prüfen."],
          patternProvenance: { method: "repeated-cubicle-geometry", rasterImageIndices,
            sourceLineIds: [...new Set([candidate.left.id, candidate.right.id, ...proof.sourceLineIds])], dividerCount: proof.count, spacingPoints: proof.spacing },
        });
        break;
      }
    }
  }
  return result;
}
