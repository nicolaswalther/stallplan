import type { DocumentKind, NormalizedBox, PdfLine, PlanPoint } from "../types";
import { multiplyTransforms, type PdfViewport } from "./text-extraction";

interface Operators { fnArray: ArrayLike<number>; argsArray: unknown[][] }
interface GraphicsState { transform: number[]; strokeWidth: number }
const IDENTITY = [1, 0, 0, 1, 0, 0];
const MAX_CURVE_INK_BOUNDS = 10_000;
const CURVE_INK_CELLS = 128;

function finiteMatrix(value: unknown): number[] | null {
  if (!value || typeof (value as ArrayLike<unknown>).length !== "number" || (value as ArrayLike<unknown>).length !== 6) return null;
  const values = Array.from(value as ArrayLike<unknown>);
  return values.every((entry) => typeof entry === "number" && Number.isFinite(entry)) ? values as number[] : null;
}

interface VectorExtraction {
  lines: PdfLine[];
  imageCount: number;
  warnings: string[];
  rasterImages: NormalizedBox[];
  rasterGeometryComplete: boolean;
  curveInkBounds: NormalizedBox[];
  vectorInkComplete: boolean;
}

/** Read PDF.js 6 typed draw buffers before rendering replaces them with Path2D. */
export function extractVectorLines(operatorList: Operators, ops: Record<string, number>, viewport: PdfViewport, pageNumber: number,
  layerNames: ReadonlyMap<string, string> = new Map()): VectorExtraction {
  const lines: PdfLine[] = [], stack: GraphicsState[] = [], warnings: string[] = [], rasterImages: NormalizedBox[] = [], curveInkBounds: NormalizedBox[] = [];
  // Marked content has its own nesting, independent of q/Q graphics states.
  // Only a single, known OCG identifies a source layer reliably. OCMD Boolean
  // expressions and unknown group references must not invent a layer name.
  const markedContentStack: Array<string | undefined> = [];
  let layerName: string | undefined;
  let rasterGeometryComplete = true, vectorInkComplete = true;
  let state: GraphicsState = { transform: [...IDENTITY], strokeWidth: 1 }, imageCount = 0;
  const painted = new Set([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const imageOps = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject, ops.paintImageXObjectRepeat, ops.paintInlineImageXObjectGroup, ops.paintImageMaskXObjectGroup]);
  const point = (x: number, y: number): PlanPoint => {
    const t = multiplyTransforms(viewport.transform, state.transform);
    return { x: (t[0] * x + t[2] * y + t[4]) / viewport.width, y: (t[1] * x + t[3] * y + t[5]) / viewport.height };
  };
  const incompleteInk = (message: string) => {
    vectorInkComplete = false;
    if (!warnings.includes(message)) warnings.push(message);
  };
  const curveInk = (points: number[][]) => {
    const corners = points.map((p) => point(p[0], p[1]));
    if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden."); return;
    }
    // A Bezier curve is contained in the convex hull of its start, controls and
    // end. This preserves possible glyph ink without inventing straight edges.
    const t = multiplyTransforms(viewport.transform, state.transform);
    const radius = Math.abs(state.strokeWidth) / 2;
    const padX = Math.max(.15 / viewport.width, radius * (Math.abs(t[0]) + Math.abs(t[2])) / viewport.width);
    const padY = Math.max(.15 / viewport.height, radius * (Math.abs(t[1]) + Math.abs(t[3])) / viewport.height);
    const x = Math.max(0, Math.min(...corners.map((p) => p.x)) - padX);
    const y = Math.max(0, Math.min(...corners.map((p) => p.y)) - padY);
    const right = Math.min(1, Math.max(...corners.map((p) => p.x)) + padX);
    const bottom = Math.min(1, Math.max(...corners.map((p) => p.y)) + padY);
    if (![x, y, right, bottom].every(Number.isFinite)) {
      incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden."); return;
    }
    if (right <= x || bottom <= y) return; // Entirely outside the viewport.
    const next = { x, y, width: right - x, height: bottom - y };
    if (!pathCurveInk) pathCurveInk = next;
    else {
      const left = Math.min(pathCurveInk.x, next.x), top = Math.min(pathCurveInk.y, next.y);
      const right = Math.max(pathCurveInk.x + pathCurveInk.width, next.x + next.width);
      const bottom = Math.max(pathCurveInk.y + pathCurveInk.height, next.y + next.height);
      pathCurveInk = { x: left, y: top, width: right - left, height: bottom - top };
    }
  };
  // Native painted paths can contain many Bezier segments. Their conservative
  // union retains every curve while bounding metadata by paths, not segments.
  let pathCurveInk: NormalizedBox | undefined;
  let curveOccupancy: Uint8Array | undefined;
  const occupyCurve = (box: NormalizedBox) => {
    const startX = Math.max(0, Math.floor(box.x * CURVE_INK_CELLS));
    const startY = Math.max(0, Math.floor(box.y * CURVE_INK_CELLS));
    const endX = Math.min(CURVE_INK_CELLS - 1, Math.ceil((box.x + box.width) * CURVE_INK_CELLS) - 1);
    const endY = Math.min(CURVE_INK_CELLS - 1, Math.ceil((box.y + box.height) * CURVE_INK_CELLS) - 1);
    for (let y = startY; y <= endY; y++) curveOccupancy!.fill(1, y * CURVE_INK_CELLS + startX, y * CURVE_INK_CELLS + endX + 1);
  };
  const flushCurveInk = () => {
    if (!pathCurveInk) return;
    if (!curveOccupancy && curveInkBounds.length >= MAX_CURVE_INK_BOUNDS) {
      // A metadata budget must not erase possible glyphs. Occupied cell runs
      // conservatively contain all original hulls. At most 128 * 64 = 8192
      // runs are possible, so the budget is respected without lost ink.
      curveOccupancy = new Uint8Array(CURVE_INK_CELLS * CURVE_INK_CELLS);
      for (const previous of curveInkBounds) occupyCurve(previous);
      curveInkBounds.length = 0;
    }
    if (curveOccupancy) occupyCurve(pathCurveInk);
    else curveInkBounds.push(pathCurveInk);
    pathCurveInk = undefined;
  };
  const add = (from: number[], to: number[]) => {
    const start = point(from[0], from[1]), end = point(to[0], to[1]);
    if ([start, end].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden."); return;
    }
    if (Math.hypot((end.x - start.x) * viewport.width, (end.y - start.y) * viewport.height) < 0.15) return;
    // Clip-paths are ignored; reject off-page drawing segments without moving their endpoints.
    if ([start, end].some((p) => p.x < -0.01 || p.y < -0.01 || p.x > 1.01 || p.y > 1.01)) return;
    lines.push({ id: `line-${pageNumber}-${lines.length}`, start, end, strokeWidth: state.strokeWidth * Math.hypot(state.transform[0], state.transform[1]),
      ...(layerName ? { layerName } : {}) });
  };
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const op = operatorList.fnArray[index], args = operatorList.argsArray[index] ?? [];
    if (op === ops.beginMarkedContent || op === ops.beginMarkedContentProps) {
      markedContentStack.push(layerName);
      if (op === ops.beginMarkedContentProps && args[0] === "OC") {
        const group = args[1] as { type?: unknown; id?: unknown } | undefined;
        layerName = group?.type === "OCG" && typeof group.id === "string" ? layerNames.get(group.id) : undefined;
      }
      continue;
    }
    if (op === ops.endMarkedContent) { layerName = markedContentStack.pop(); continue; }
    if (op === ops.save || op === ops.paintFormXObjectBegin || op === ops.beginGroup) {
      stack.push({ transform: [...state.transform], strokeWidth: state.strokeWidth });
      if (op === ops.beginGroup && (args[0] as { matrix?: unknown } | undefined)?.matrix) {
        rasterGeometryComplete = false;
        incompleteInk("Transformierte PDF-Gruppengeometrie ist unvollständig; Maßpositionen bleiben ungeprüft.");
      }
      if (op === ops.paintFormXObjectBegin && args[0] != null) {
        const matrix = finiteMatrix(args[0]);
        if (matrix) state.transform = multiplyTransforms(state.transform, matrix);
        else {
          rasterGeometryComplete = false;
          incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden.");
        }
      }
      continue;
    }
    if (op === ops.restore || op === ops.paintFormXObjectEnd || op === ops.endGroup) { state = stack.pop() ?? state; continue; }
    if (op === ops.transform) {
      const matrix = finiteMatrix(args);
      if (matrix) state.transform = multiplyTransforms(state.transform, matrix);
      else { rasterGeometryComplete = false; incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden."); }
      continue;
    }
    if (op === ops.setLineWidth) {
      const width = Number(args[0]);
      if (Number.isFinite(width) && width >= 0) state.strokeWidth = width;
      else incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden.");
      continue;
    }
    if (imageOps.has(op)) {
      imageCount++;
      if (op === ops.paintImageXObject || op === ops.paintInlineImageXObject || op === ops.paintImageMaskXObject) {
        const corners = [point(0, 0), point(1, 0), point(0, 1), point(1, 1)];
        const x = Math.max(0, Math.min(...corners.map((p) => p.x))), y = Math.max(0, Math.min(...corners.map((p) => p.y)));
        const right = Math.min(1, Math.max(...corners.map((p) => p.x))), bottom = Math.min(1, Math.max(...corners.map((p) => p.y)));
        if (right > x && bottom > y) rasterImages.push({ x, y, width: right - x, height: bottom - y });
      } else rasterGeometryComplete = false; // Group/repeat transforms need separate decoding.
      continue;
    }
    if (op !== ops.constructPath || !painted.has(Number(args[0]))) continue;
    pathCurveInk = undefined;
    const buffer = (args[1] as ArrayLike<ArrayLike<number>>)?.[0];
    // PDF.js emits this explicitly for an empty path; no ink is omitted.
    if (buffer === null && args[2] === null) continue;
    if (!buffer || typeof buffer.length !== "number") { incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden."); continue; }
    let cursor = 0, current: number[] | undefined, first: number[] | undefined;
    while (cursor < buffer.length) {
      const drawOp = buffer[cursor++];
      const coordinateCount = drawOp === 0 || drawOp === 1 ? 2 : drawOp === 2 ? 6 : drawOp === 3 ? 4 : drawOp === 4 ? 0 : -1;
      if (coordinateCount < 0) { incompleteInk("Unbekannter PDF-Pfadoperator."); break; }
      if (cursor + coordinateCount > buffer.length
        || Array.from({ length: coordinateCount }, (_, offset) => buffer[cursor + offset]).some((value) => !Number.isFinite(value))) {
        incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden."); break;
      }
      if (drawOp === 0) { current = [buffer[cursor++], buffer[cursor++]]; first = current; }
      else if (drawOp === 1) {
        const next = [buffer[cursor++], buffer[cursor++]];
        if (current) add(current, next); else incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden.");
        current = next;
      }
      else if (drawOp === 2 || drawOp === 3) {
        const controls = Array.from({ length: coordinateCount / 2 }, () => [buffer[cursor++], buffer[cursor++]]);
        if (current) curveInk([current, ...controls]); else incompleteInk("Ein PDF-Pfad konnte nicht strukturell gelesen werden.");
        current = controls[controls.length - 1];
      }
      else if (drawOp === 4) { if (current && first) add(current, first); current = first; }
    }
    flushCurveInk();
  }
  if (curveOccupancy) for (let y = 0; y < CURVE_INK_CELLS; y++) {
    let x = 0;
    while (x < CURVE_INK_CELLS) {
      if (!curveOccupancy[y * CURVE_INK_CELLS + x]) { x++; continue; }
      const start = x;
      while (x < CURVE_INK_CELLS && curveOccupancy[y * CURVE_INK_CELLS + x]) x++;
      curveInkBounds.push({ x: start / CURVE_INK_CELLS, y: y / CURVE_INK_CELLS,
        width: (x - start) / CURVE_INK_CELLS, height: 1 / CURVE_INK_CELLS });
    }
  }
  return { lines, imageCount, warnings, rasterImages, rasterGeometryComplete, curveInkBounds, vectorInkComplete };
}

export function classifyDocument(textCount: number, lineCount: number, imageCount: number): DocumentKind {
  const structured = textCount >= 4 || lineCount >= 12;
  if (!structured && imageCount > 0) return "raster";
  return imageCount > 0 && structured ? "mixed" : "vector";
}
