import type { AreaType, DetectedArea, NormalizedBox, PdfLine, PdfPageData, PdfTextItem } from "../types";
import { AREA_RULES } from "../rules";

const LABELS: Array<{ kind: AreaType; pattern: RegExp }> = [
  { kind: "feeding_area", pattern: /\b(futtertisch|fressbereich|fressachse|futtergang|korytarz paszowy|stol paszowy)\b/ },
  { kind: "cubicles", pattern: /\b(liegebox(?:en)?|liegeboxenreihe|legowiska)\b/ },
  { kind: "alley", pattern: /\b(laufgang|treibgang|komunikacja|korytarz spacerowy)\b/ },
  { kind: "calving", pattern: /\b(abkalbe(?:bereich|bucht)?|porodowka)\b/ },
  { kind: "gate", pattern: /\b(stalltor|tierdurchgang|maschinendurchfahrt|personendurchgang|brama)\b/ },
];

function normalizedLabel(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
}

export function classifyAreaLabel(text: string): AreaType | null {
  const normalized = normalizedLabel(text);
  return LABELS.find((entry) => entry.pattern.test(normalized))?.kind ?? null;
}

interface Edge { axis: number; from: number; to: number }

function axisEdges(lines: PdfLine[], width: number, height: number) {
  const horizontal: Edge[] = [];
  const vertical: Edge[] = [];
  for (const line of lines) {
    const dx = Math.abs(line.end.x - line.start.x);
    const dy = Math.abs(line.end.y - line.start.y);
    // PDF outlines and short symbol strokes are not room boundaries.
    if (dy * height <= 1.5 && dx * width >= 24) horizontal.push({ axis: (line.start.y + line.end.y) / 2, from: Math.min(line.start.x, line.end.x), to: Math.max(line.start.x, line.end.x) });
    if (dx * width <= 1.5 && dy * height >= 24) vertical.push({ axis: (line.start.x + line.end.x) / 2, from: Math.min(line.start.y, line.end.y), to: Math.max(line.start.y, line.end.y) });
  }
  return { horizontal, vertical };
}

function coverage(edges: Edge[], axis: number, from: number, to: number, tolerance: number) {
  const spans = edges.filter((edge) => Math.abs(edge.axis - axis) <= tolerance && edge.to > from && edge.from < to)
    .map((edge) => [Math.max(from, edge.from), Math.min(to, edge.to)]).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = from;
  for (const [start, stop] of spans) {
    covered += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return covered / (to - from);
}

function enclosingBox(page: PdfPageData, label: PdfTextItem, otherLabels: PdfTextItem[]): NormalizedBox | null {
  const { horizontal, vertical } = axisEdges(page.lines ?? [], page.width, page.height);
  const cx = label.bbox.x + label.bbox.width / 2;
  const cy = label.bbox.y + label.bbox.height / 2;
  const tx = 2.5 / page.width;
  const ty = 2.5 / page.height;
  const horizontalAtLabel = horizontal.filter((edge) => edge.from <= cx && edge.to >= cx);
  const verticalAtLabel = vertical.filter((edge) => edge.from <= cy && edge.to >= cy);
  const nearest = (edges: Edge[], before: boolean, center: number) => [...new Set(edges.filter((edge) => before ? edge.axis < center : edge.axis > center).map((edge) => edge.axis))]
    .sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).slice(0, 5);
  const tops = nearest(horizontalAtLabel, true, label.bbox.y);
  const bottoms = nearest(horizontalAtLabel, false, label.bbox.y + label.bbox.height);
  const lefts = nearest(verticalAtLabel, true, label.bbox.x);
  const rights = nearest(verticalAtLabel, false, label.bbox.x + label.bbox.width);
  const candidates: NormalizedBox[] = [];
  for (const y of tops) for (const bottom of bottoms) for (const x of lefts) for (const right of rights) {
    const width = right - x;
    const height = bottom - y;
    if (x < 0 || y < 0 || right > 1 || bottom > 1) continue;
    if (width < Math.max(label.bbox.width * 1.5, 30 / page.width) || height < Math.max(label.bbox.height * 4, 30 / page.height) || width * height < 0.002) continue;
    if (coverage(horizontal, y, x, right, ty) < 0.9 || coverage(horizontal, bottom, x, right, ty) < 0.9 || coverage(vertical, x, y, bottom, tx) < 0.9 || coverage(vertical, right, y, bottom, tx) < 0.9) continue;
    // A room schedule or building-wide outline cannot stand in for an individual room.
    if (otherLabels.some((item) => item !== label && item.bbox.x >= x && item.bbox.x + item.bbox.width <= right && item.bbox.y >= y && item.bbox.y + item.bbox.height <= bottom)) continue;
    candidates.push({ x, y, width, height });
  }
  return candidates.sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null;
}

/** Only classify a real enclosure anchored by extracted text; never fabricate a box around a word. */
export function detectStructuralAreas(pages: PdfPageData[]): DetectedArea[] {
  const result: DetectedArea[] = [];
  for (const page of pages) {
    const labels = page.textItems.filter((item) => classifyAreaLabel(item.text) !== null);
    for (const item of labels) {
      const kind = classifyAreaLabel(item.text)!;
      const bbox = enclosingBox(page, item, labels);
      if (!bbox) continue;
      if (result.some((area) => area.pageNumber === page.pageNumber && Math.abs(area.bbox.x - bbox.x) < 0.003 && Math.abs(area.bbox.y - bbox.y) < 0.003)) continue;
      result.push({
        id: `structure-area-${page.pageNumber}-${item.id ?? result.length + 1}`,
        kind, label: AREA_RULES[kind].title, confidence: 0.91,
        source: "geometry", status: "unconfirmed", pageNumber: page.pageNumber, bbox, hasBbox: true,
        evidence: [`PDF-Beschriftung: ${item.text}`, "Vier umschließende Vektorkanten mit mindestens 90 % Linienabdeckung."],
      });
    }
  }
  return result;
}

export function mergeDetectedAreas(structural: DetectedArea[], semantic: DetectedArea[]): DetectedArea[] {
  const merged = [...structural];
  for (const area of semantic) {
    const overlaps = structural.some((base) => {
      if (base.pageNumber !== area.pageNumber || base.kind !== area.kind) return false;
      const intersection = Math.max(0, Math.min(base.bbox.x + base.bbox.width, area.bbox.x + area.bbox.width) - Math.max(base.bbox.x, area.bbox.x))
        * Math.max(0, Math.min(base.bbox.y + base.bbox.height, area.bbox.y + area.bbox.height) - Math.max(base.bbox.y, area.bbox.y));
      const union = base.bbox.width * base.bbox.height + area.bbox.width * area.bbox.height - intersection;
      return union > 0 && intersection / union >= 0.45;
    });
    if (!overlaps) merged.push(area);
  }
  return merged;
}
