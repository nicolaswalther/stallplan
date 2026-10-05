import { z } from "zod";
import type { PdfPageData } from "../types";

// PDF strokes/baselines can cross the viewport slightly; unlike UI boxes, raw
// document geometry is retained with a bounded overscan rather than distorted.
export const pointSchema = z.object({ x: z.number().min(-0.02).max(1.02), y: z.number().min(-0.02).max(1.02) });
export const bboxSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().min(0).max(1), height: z.number().min(0).max(1),
}).refine((box) => box.x + box.width <= 1.00001 && box.y + box.height <= 1.00001, "Box liegt außerhalb der Seite.");

export const analysisRequestSchema = z.object({
  fileName: z.string().min(1).max(240),
  pages: z.array(z.object({
    pageNumber: z.number().int().positive(), width: z.number().positive(), height: z.number().positive(),
    text: z.string().max(1_000_000),
    textItems: z.array(z.object({
      id: z.string().optional(), text: z.string(), bbox: bboxSchema,
      orientation: z.number().optional(), fontSize: z.number().positive().optional(), baseline: pointSchema.optional(),
    })).max(100_000),
    imageDataUrl: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,/).max(15_000_000).optional(),
    lines: z.array(z.object({ id: z.string(), start: pointSchema, end: pointSchema, strokeWidth: z.number().nonnegative().optional() })).max(150_000).optional(),
    documentKind: z.enum(["vector", "raster", "mixed"]).optional(),
    imageCount: z.number().int().nonnegative().optional(), extractionWarnings: z.array(z.string()).optional(),
  })).min(1).max(40),
}).refine((request) => new Set(request.pages.map((page) => page.pageNumber)).size === request.pages.length, "Seitenzahlen müssen eindeutig sein.");

export type AnalysisRequest = { fileName: string; pages: PdfPageData[] };

export function parseAnalysisRequest(input: unknown): AnalysisRequest {
  const payload = analysisRequestSchema.parse(input);
  return { ...payload, pages: payload.pages.map((page) => ({ ...page, imageDataUrl: page.imageDataUrl ?? "" })) };
}
