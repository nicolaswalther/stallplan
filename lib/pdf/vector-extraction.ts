import type { DocumentKind, PdfLine, PlanPoint } from "../types";
import { multiplyTransforms, type PdfViewport } from "./text-extraction";

interface Operators { fnArray: ArrayLike<number>; argsArray: unknown[][] }
interface GraphicsState { transform: number[]; strokeWidth: number }
const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Read PDF.js 6 typed draw buffers before rendering replaces them with Path2D. */
export function extractVectorLines(operatorList: Operators, ops: Record<string, number>, viewport: PdfViewport, pageNumber: number): { lines: PdfLine[]; imageCount: number; warnings: string[] } {
  const lines: PdfLine[] = [], stack: GraphicsState[] = [], warnings: string[] = [];
  let state: GraphicsState = { transform: [...IDENTITY], strokeWidth: 1 }, imageCount = 0;
  const painted = new Set([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const imageOps = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject, ops.paintImageXObjectRepeat, ops.paintInlineImageXObjectGroup, ops.paintImageMaskXObjectGroup]);
  const point = (x: number, y: number): PlanPoint => {
    const t = multiplyTransforms(viewport.transform, state.transform);
    return { x: (t[0] * x + t[2] * y + t[4]) / viewport.width, y: (t[1] * x + t[3] * y + t[5]) / viewport.height };
  };
  const add = (from: number[], to: number[]) => {
    const start = point(from[0], from[1]), end = point(to[0], to[1]);
    if (Math.hypot((end.x - start.x) * viewport.width, (end.y - start.y) * viewport.height) < 0.15) return;
    // Clip-paths are ignored; reject off-page drawing segments without moving their endpoints.
    if ([start, end].some((p) => p.x < -0.01 || p.y < -0.01 || p.x > 1.01 || p.y > 1.01)) return;
    lines.push({ id: `line-${pageNumber}-${lines.length}`, start, end, strokeWidth: state.strokeWidth * Math.hypot(state.transform[0], state.transform[1]) });
  };
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const op = operatorList.fnArray[index], args = operatorList.argsArray[index];
    if (op === ops.save || op === ops.paintFormXObjectBegin || op === ops.beginGroup) {
      stack.push({ transform: [...state.transform], strokeWidth: state.strokeWidth });
      if (op === ops.paintFormXObjectBegin && Array.isArray(args[0])) state.transform = multiplyTransforms(state.transform, args[0]);
      continue;
    }
    if (op === ops.restore || op === ops.paintFormXObjectEnd || op === ops.endGroup) { state = stack.pop() ?? state; continue; }
    if (op === ops.transform) { state.transform = multiplyTransforms(state.transform, args as number[]); continue; }
    if (op === ops.setLineWidth) { state.strokeWidth = Number(args[0]); continue; }
    if (imageOps.has(op)) { imageCount++; continue; }
    if (op !== ops.constructPath || !painted.has(Number(args[0]))) continue;
    const buffer = (args[1] as ArrayLike<ArrayLike<number>>)?.[0];
    if (!buffer || typeof buffer.length !== "number") { if (!warnings.length) warnings.push("Ein PDF-Pfad konnte nicht strukturell gelesen werden."); continue; }
    let cursor = 0, current: number[] | undefined, first: number[] | undefined;
    while (cursor < buffer.length) {
      const drawOp = buffer[cursor++];
      if (drawOp === 0) { current = [buffer[cursor++], buffer[cursor++]]; first = current; }
      else if (drawOp === 1) { const next = [buffer[cursor++], buffer[cursor++]]; if (current) add(current, next); current = next; }
      else if (drawOp === 2) { cursor += 4; current = [buffer[cursor++], buffer[cursor++]]; }
      else if (drawOp === 3) { cursor += 2; current = [buffer[cursor++], buffer[cursor++]]; }
      else if (drawOp === 4) { if (current && first) add(current, first); current = first; }
      else { warnings.push("Unbekannter PDF-Pfadoperator."); break; }
    }
  }
  return { lines, imageCount, warnings };
}

export function classifyDocument(textCount: number, lineCount: number, imageCount: number): DocumentKind {
  const structured = textCount >= 4 || lineCount >= 12;
  if (!structured && imageCount > 0) return "raster";
  return imageCount > 0 && structured ? "mixed" : "vector";
}
