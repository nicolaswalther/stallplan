import { z } from "zod";
import type { PdfPageData } from "../types";

// PDF strokes/baselines can cross the viewport slightly; unlike UI boxes, raw
// document geometry is retained with a bounded overscan rather than distorted.
export const pointSchema = z.object({ x: z.number().min(-0.02).max(1.02), y: z.number().min(-0.02).max(1.02) });
export const bboxSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().min(0).max(1), height: z.number().min(0).max(1),
}).refine((box) => box.x + box.width <= 1.00001 && box.y + box.height <= 1.00001, "Box liegt außerhalb der Seite.");

// Dense CAD drawings can exceed 150k painted segments without exceeding the
// separately enforced 4 MiB compressed / 64 MiB decoded transport budgets.
const MAX_VECTOR_LINES_PER_PAGE = 350_000;

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
    semanticAreaImage: z.object({
      imageDataUrl: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,/).max(3_000_000),
      hiddenLayers: z.array(z.string().max(240)).min(1).max(100),
    }).optional(),
    areaDetailImages: z.array(z.object({
      bbox: bboxSchema.refine((box) => box.width > 0 && box.height > 0, "Ausschnitt benötigt eine Fläche."),
      imageDataUrl: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,/).max(3_000_000),
      pixelWidth: z.number().int().min(1).max(1_800), pixelHeight: z.number().int().min(1).max(1_800),
    }).refine((image) => image.pixelWidth * image.pixelHeight <= 2_000_000, "Ausschnitt überschreitet das Pixelbudget.")).max(4).optional(),
    semanticDetails: z.array(z.object({
      kind: z.literal("outline-text"), bbox: bboxSchema.refine((box) => box.width > 0 && box.height > 0, "Ausschnitt benötigt eine Fläche."),
      imageDataUrl: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,/).max(3_000_000),
      sourceLineIds: z.array(z.string().max(160)).max(64),
      sourceLineCount: z.number().int().min(1).max(MAX_VECTOR_LINES_PER_PAGE), rowCount: z.number().int().min(1).max(10_000),
    })).max(2).optional(),
    lines: z.array(z.object({ id: z.string(), start: pointSchema, end: pointSchema, strokeWidth: z.number().nonnegative().optional(),
      layerName: z.string().max(240).optional(),
    })).max(MAX_VECTOR_LINES_PER_PAGE).optional(),
    documentKind: z.enum(["vector", "raster", "mixed"]).optional(),
    imageCount: z.number().int().nonnegative().optional(), extractionWarnings: z.array(z.string()).optional(),
    rasterImages: z.array(bboxSchema).max(10_000).optional(), rasterGeometryComplete: z.boolean().optional(),
    curveInkBounds: z.array(bboxSchema).max(10_000).optional(), vectorInkComplete: z.boolean().optional(),
  })).min(1).max(40),
}).refine((request) => new Set(request.pages.map((page) => page.pageNumber)).size === request.pages.length, "Seitenzahlen müssen eindeutig sein.")
  .refine((request) => request.pages.reduce((count, page) => count + (page.areaDetailImages?.length ?? 0), 0) <= 4, "Höchstens vier Bereichsausschnitte je Analyse.");

export type AnalysisRequest = { fileName: string; pages: PdfPageData[] };

export function parseAnalysisRequest(input: unknown): AnalysisRequest {
  const payload = analysisRequestSchema.parse(input);
  return { ...payload, pages: payload.pages.map((page) => ({ ...page, imageDataUrl: page.imageDataUrl ?? "" })) };
}
