import type { LengthUnit, PdfPageData, PdfTextItem, PlanPoint } from "../types";
import { axisOf, indexAxisLines, type AxisLine } from "./dimension-lines";
import { MM_PER_UNIT } from "../analysis/unit-detection";

export interface OpeningAnnotation { widthItem: PdfTextItem; heightItem: PdfTextItem; axis: "horizontal" | "vertical"; startReference: PlanPoint; endReference: PlanPoint; geometryAgreement: number; isGap: boolean }
function center(item: PdfTextItem, page: PdfPageData) { return { x: (item.bbox.x + item.bbox.width / 2) * page.width, y: (item.bbox.y + item.bbox.height / 2) * page.height }; }
function refs(axis: "horizontal" | "vertical", cross: number, from: number, to: number, page: PdfPageData) {
  return axis === "horizontal" ? [{ x: from / page.width, y: cross / page.height }, { x: to / page.width, y: cross / page.height }] : [{ x: cross / page.width, y: from / page.height }, { x: cross / page.width, y: to / page.height }];
}
function findOpening(item: PdfTextItem, other: PdfTextItem, lines: AxisLine[], page: PdfPageData, expected: number) {
  const a = center(item, page), b = center(other, page), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, font = item.fontSize ?? 8;
  const possibilities: Array<{ axis: "horizontal" | "vertical"; cross: number; from: number; to: number; agreement: number; isGap: boolean; score: number }> = [];
  for (const axis of ["horizontal", "vertical"] as const) {
    const along = axis === "horizontal" ? cx : cy, cross = axis === "horizontal" ? cy : cx;
    const nearby = lines.filter((l) => l.axis === axis && Math.abs(l.cross - cross) < Math.max(24, font * 7) && l.to > along - expected * 1.2 && l.from < along + expected * 1.2);
    const add = (lineCross: number, from: number, to: number, isGap: boolean) => {
      const length = to - from, error = Math.abs(length - expected) / Math.max(1, expected);
      if (error > 0.135 || Math.abs((from + to) / 2 - along) > Math.max(font * 3.5, expected * 0.2)) return;
      const agreement = 1 - error / 0.135;
      possibilities.push({ axis, cross: lineCross, from, to, isGap, agreement,
        score: agreement * 0.7 + (1 - Math.abs(lineCross - cross) / Math.max(24, font * 7)) * 0.3 });
    };
    for (const line of nearby) {
      add(line.cross, line.from, line.to, false);
      // A doorway can be represented by a gap between collinear wall edges.
      if (line.to >= along || line.to < along - expected) continue;
      for (const next of nearby) {
        if (Math.abs(next.cross - line.cross) > 0.4 || next.from <= line.to || next.from <= along || next.from > along + expected) continue;
        const blocked = nearby.some((l) => Math.abs(l.cross - line.cross) < 0.4 && l.from < next.from - 0.5 && l.to > line.to + 0.5);
        if (!blocked) add(line.cross, line.to, next.from, true);
      }
    }
  }
  return possibilities.sort((a, b) => b.score - a.score)[0];
}

/** CAD opening labels use two equal-font numbers across the text baseline: width / height. */
export function detectOpeningAnnotations(items: PdfTextItem[], page: PdfPageData, unit: LengthUnit, scale: number | null): OpeningAnnotation[] {
  if (unit === "unknown" || !scale) return [];
  const lines = indexAxisLines(page), consumed = new Set<string>(), result: OpeningAnnotation[] = [];
  const numeric = items.filter((item) => /^\d+(?:[.,]\d+)?$/.test(item.text));
  for (const first of numeric) {
    const value = Number(first.text.replace(",", ".")), widthCm = value * MM_PER_UNIT[unit] / 10;
    if (widthCm < 40 || widthCm > 800 || consumed.has(first.id ?? "")) continue;
    const axis = axisOf(first), a = center(first, page), font = first.fontSize ?? 8;
    const pairs = numeric.filter((next) => {
      if (next === first || consumed.has(next.id ?? "") || axisOf(next) !== axis || Math.abs((next.fontSize ?? font) - font) > font * 0.04) return false;
      const b = center(next, page), across = axis === "horizontal" ? b.y - a.y : b.x - a.x, along = axis === "horizontal" ? b.x - a.x : b.y - a.y;
      return across > font * 0.9 && across < font * 1.5 && Math.abs(along) < font * 0.2;
    });
    if (pairs.length !== 1) continue;
    const other = pairs[0], heightCm = Number(other.text.replace(",", ".")) * MM_PER_UNIT[unit] / 10;
    if (heightCm < 60 || heightCm > 800) continue;
    const expected = value * MM_PER_UNIT[unit] / scale * 72 / 25.4;
    const geometry = findOpening(first, other, lines, page, expected);
    if (!geometry) continue;
    const [startReference, endReference] = refs(geometry.axis, geometry.cross, geometry.from, geometry.to, page);
    result.push({ widthItem: first, heightItem: other, axis: geometry.axis, startReference, endReference, geometryAgreement: geometry.agreement, isGap: geometry.isGap });
    consumed.add(first.id ?? ""); consumed.add(other.id ?? "");
  }
  return result;
}
