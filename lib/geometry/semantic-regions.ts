import type { NormalizedBox, PdfPageData } from "../types";

export interface RoomNumberAnchor {
  number: string;
  text: string;
  textItemId: string;
  bbox: NormalizedBox;
}

export interface OutlineTextRegion {
  bbox: NormalizedBox;
  source: "pdf-vectors";
  sourceLineIds: string[];
  sourceLineCount: number;
  rowCount: number;
}

/** These are image/text-reading candidates, not classified rooms. */
export interface SemanticRegions {
  roomNumberAnchors: RoomNumberAnchor[];
  outlineTextRegions: OutlineTextRegion[];
}

function validBox(box: NormalizedBox) {
  return Object.values(box).every(Number.isFinite) && box.x >= 0 && box.y >= 0
    && box.width > 0 && box.height > 0 && box.x + box.width <= 1.001 && box.y + box.height <= 1.001;
}

/** Preserve every valid candidate so geometry can detect ambiguity within a room. */
export function extractRoomNumberCandidates(page: PdfPageData): RoomNumberAnchor[] {
  return page.textItems.flatMap((item) => {
    const text = item.text.trim();
    const match = /^([1-9]\d{0,2})\.$/.exec(text);
    if (!match || !validBox(item.bbox)) return [];
    return [{ number: match[1], text, textItemId: item.id ?? `room-number-${match[1]}`, bbox: item.bbox }];
  });
}

/** Retain exact PDF coordinates. Duplicate numbers are ambiguous and excluded. */
export function detectRoomNumberAnchors(page: PdfPageData): RoomNumberAnchor[] {
  const candidates = extractRoomNumberCandidates(page);
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.number, (counts.get(candidate.number) ?? 0) + 1);
  return candidates.filter((candidate) => counts.get(candidate.number) === 1);
}

/** Binary dilation with a sliding sum keeps work bounded by raster size. */
function dilate(mask: Uint8Array, width: number, height: number, horizontal: number, vertical: number) {
  const across = new Uint8Array(mask.length), result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const offset = y * width;
    for (let x = 0; x <= Math.min(width - 1, horizontal); x++) sum += mask[offset + x];
    for (let x = 0; x < width; x++) {
      across[offset + x] = sum > 0 ? 1 : 0;
      if (x - horizontal >= 0) sum -= mask[offset + x - horizontal];
      if (x + horizontal + 1 < width) sum += mask[offset + x + horizontal + 1];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(height - 1, vertical); y++) sum += across[y * width + x];
    for (let y = 0; y < height; y++) {
      result[y * width + x] = sum > 0 ? 1 : 0;
      if (y - vertical >= 0) sum -= across[(y - vertical) * width + x];
      if (y + vertical + 1 < height) sum += across[(y + vertical + 1) * width + x];
    }
  }
  return result;
}

function drawLine(mask: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    mask[y0 * width + x0] = 1;
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
}

/**
 * Outlined letters are many short hairline strokes rather than PDF text.
 * Group their physical layout into bounded crops, so a reader sees the legend
 * at useful resolution. Long dimension rails and painted hatching do not enter
 * the mask. A region must contain several separated rows; geometry alone does
 * not establish that it is a room schedule or that its OCR numbers are lengths.
 */
export function detectOutlineTextRegions(page: PdfPageData): OutlineTextRegion[] {
  if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0 || !page.lines?.length) return [];
  // The physical thresholds remain in PDF points, including oversized pages.
  const scale = Math.min(1, 2048 / Math.max(page.width, page.height));
  const width = Math.ceil(page.width * scale), height = Math.ceil(page.height * scale);
  const mask = new Uint8Array(width * height);
  const strokes: Array<{ id: string; x: number; y: number }> = [];
  for (const line of page.lines) {
    if (!Number.isFinite(line.strokeWidth) || line.strokeWidth! > 0.05 || line.strokeWidth! < 0) continue;
    const values = [line.start.x, line.start.y, line.end.x, line.end.y];
    if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) continue;
    const physicalLength = Math.hypot((line.end.x - line.start.x) * page.width, (line.end.y - line.start.y) * page.height);
    if (physicalLength < 0.1 || physicalLength > 8) continue;
    const x0 = Math.min(width - 1, Math.round(line.start.x * page.width * scale));
    const y0 = Math.min(height - 1, Math.round(line.start.y * page.height * scale));
    const x1 = Math.min(width - 1, Math.round(line.end.x * page.width * scale));
    const y1 = Math.min(height - 1, Math.round(line.end.y * page.height * scale));
    drawLine(mask, width, x0, y0, x1, y1);
    strokes.push({ id: line.id, x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
  if (strokes.length < 150) return [];
  const grouped = dilate(mask, width, height, Math.max(1, Math.round(8 * scale)), Math.max(1, Math.round(4 * scale)));
  const queue = new Uint32Array(mask.length);
  const candidates: Array<OutlineTextRegion & { score: number }> = [];
  for (let start = 0; start < grouped.length; start++) {
    if (!grouped[start]) continue;
    let head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0, pixels = 0;
    queue[0] = start; grouped[start] = 0;
    while (head < tail) {
      const position = queue[head++], x = position % width, y = Math.floor(position / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      pixels += mask[position];
      for (const neighbor of [x > 0 ? position - 1 : -1, x + 1 < width ? position + 1 : -1, y > 0 ? position - width : -1, y + 1 < height ? position + width : -1]) {
        if (neighbor >= 0 && grouped[neighbor]) { grouped[neighbor] = 0; queue[tail++] = neighbor; }
      }
    }
    if ((right - left) / scale < 60 || (bottom - top) / scale < 50 || pixels < Math.max(80, 250 * scale * scale)) continue;
    let rowCount = 0, precedingRowOccupied = false;
    for (let y = top; y <= bottom; y++) {
      let occupied = false;
      for (let x = left; x <= right && !occupied; x++) occupied = mask[y * width + x] !== 0;
      if (occupied && !precedingRowOccupied) rowCount++;
      precedingRowOccupied = occupied;
    }
    if (rowCount < 6) continue;
    const selected = strokes.filter((stroke) => stroke.x >= left && stroke.x <= right && stroke.y >= top && stroke.y <= bottom);
    if (selected.length < 150) continue;
    const padding = 4 * scale;
    const x = Math.max(0, left - padding) / (page.width * scale), y = Math.max(0, top - padding) / (page.height * scale);
    const maximumX = Math.min(page.width * scale, right + padding + 1) / (page.width * scale);
    const maximumY = Math.min(page.height * scale, bottom + padding + 1) / (page.height * scale);
    candidates.push({ bbox: { x, y, width: maximumX - x, height: maximumY - y }, source: "pdf-vectors", sourceLineIds: selected.slice(0, 64).map((stroke) => stroke.id), sourceLineCount: selected.length, rowCount, score: selected.length * rowCount });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3).map((candidate) => ({
    bbox: candidate.bbox, source: candidate.source, sourceLineIds: candidate.sourceLineIds,
    sourceLineCount: candidate.sourceLineCount, rowCount: candidate.rowCount,
  }));
}

export function detectSemanticRegions(page: PdfPageData): SemanticRegions {
  return { roomNumberAnchors: detectRoomNumberAnchors(page), outlineTextRegions: detectOutlineTextRegions(page) };
}
