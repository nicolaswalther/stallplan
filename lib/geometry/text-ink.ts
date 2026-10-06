import type { NormalizedBox, PdfPageData, PlanPoint } from "../types";

const indexes = new WeakMap<PdfPageData, Map<number, PlanPoint[]>>();
const CELLS = 64;
const cell = (value: number) => Math.max(0, Math.min(CELLS - 1, Math.floor(value * CELLS)));

/** Position evidence only: short strokes do not establish the actual digits. */
export function hasLocatedDimensionInk(page: PdfPageData, box: NormalizedBox): boolean {
  // A scan can legitimately contain no text vectors. Apply this check only
  // where vector ink and raster extents are known. Legacy metadata is not
  // evidence of empty ink, and curved digits need not contain straight strokes.
  if (page.vectorInkComplete !== true || !page.curveInkBounds
    || page.rasterGeometryComplete !== true || !page.rasterImages || (page.lines?.length ?? 0) < 1000) return true;
  if (page.rasterImages.some((image) => image.x < box.x + box.width && image.x + image.width > box.x
    && image.y < box.y + box.height && image.y + image.height > box.y)) return true;
  if (page.curveInkBounds.some((curve) => curve.x < box.x + box.width && curve.x + curve.width > box.x
    && curve.y < box.y + box.height && curve.y + curve.height > box.y)) return true;
  let index = indexes.get(page);
  if (!index) {
    index = new Map();
    for (const line of page.lines ?? []) {
      const length = Math.hypot((line.end.x - line.start.x) * page.width, (line.end.y - line.start.y) * page.height);
      if (length < .08 || length > 12) continue;
      const point = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 };
      const key = cell(point.y) * CELLS + cell(point.x);
      const bucket = index.get(key) ?? []; bucket.push(point); index.set(key, bucket);
    }
    indexes.set(page, index);
  }
  let count = 0, left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let y = cell(box.y); y <= cell(box.y + box.height); y++) for (let x = cell(box.x); x <= cell(box.x + box.width); x++) {
    for (const point of index.get(y * CELLS + x) ?? []) {
      if (point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height) continue;
      count++; left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
    }
  }
  // One rail or an isolated corner cannot be a localized dimension string.
  return count >= 6 && (right - left) * page.width >= .8 && (bottom - top) * page.height >= .8;
}
