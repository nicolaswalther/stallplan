import type { PdfTextItem } from "../types";

export interface PdfViewport { width: number; height: number; transform: number[] }
export interface RawTextItem { str: string; width: number; height: number; transform: number[]; fontName: string }
type FontStyle = { ascent?: number; descent?: number; vertical?: boolean };

export function multiplyTransforms(a: number[], b: number[]): number[] {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** Axis-aligned page boxes are computed from all four rotated glyph corners. */
export function extractTextObjects(items: unknown[], styles: Record<string, FontStyle>, viewport: PdfViewport, pageNumber: number): PdfTextItem[] {
  return items.flatMap((raw, index) => {
    const item = raw as RawTextItem;
    if (typeof item.str !== "string" || !item.str.trim() || !item.transform) return [];
    const tx = multiplyTransforms(viewport.transform, item.transform);
    const fontSize = Math.max(0.1, Math.hypot(tx[2], tx[3]));
    const advanceScale = Math.hypot(tx[0], tx[1]);
    const ux = tx[0] / (advanceScale || 1), uy = tx[1] / (advanceScale || 1);
    const vx = tx[2] / fontSize, vy = tx[3] / fontSize;
    const style = styles[item.fontName];
    const ascent = (style?.ascent ?? 0.9) * fontSize;
    const descent = (style?.descent ?? -0.2) * fontSize;
    const width = Math.max(0.1, item.width * Math.hypot(viewport.transform[0], viewport.transform[1]));
    const corners = [0, width].flatMap((advance) => [ascent, descent].map((height) => ({
      x: tx[4] + ux * advance + vx * height,
      y: tx[5] + uy * advance + vy * height,
    })));
    const x0 = Math.max(0, Math.min(viewport.width, Math.min(...corners.map((p) => p.x))));
    const y0 = Math.max(0, Math.min(viewport.height, Math.min(...corners.map((p) => p.y))));
    const x1 = Math.max(x0, Math.min(viewport.width, Math.max(...corners.map((p) => p.x))));
    const y1 = Math.max(y0, Math.min(viewport.height, Math.max(...corners.map((p) => p.y))));
    if (x1 - x0 <= 0.01 || y1 - y0 <= 0.01) return [];
    // CropBox PDFs can retain invisible drawing text outside the visible page.
    const baseline = tx[4] >= 0 && tx[4] <= viewport.width && tx[5] >= 0 && tx[5] <= viewport.height
      ? { x: tx[4] / viewport.width, y: tx[5] / viewport.height } : undefined;
    return [{ id: `text-${pageNumber}-${index}`, text: item.str.trim(), fontSize,
      orientation: Math.atan2(uy, ux) * 180 / Math.PI,
      baseline,
      bbox: { x: x0 / viewport.width, y: y0 / viewport.height, width: (x1 - x0) / viewport.width, height: (y1 - y0) / viewport.height },
    }];
  });
}
