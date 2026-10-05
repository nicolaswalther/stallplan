export const AREA_TYPES = [
  "feeding_area",
  "cubicles",
  "alley",
  "calving",
  "gate",
  "unknown",
] as const;

export type AreaType = (typeof AREA_TYPES)[number];
export type AreaSource = "ai" | "manual" | "pdf-text";
export type ReviewStatus = "unconfirmed" | "confirmed" | "rejected";
export type MeasurementSource = "pdf-text" | "ai" | "customer";

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageData {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  imageDataUrl: string;
}

export interface Measurement {
  id: string;
  key: string;
  label: string;
  value: number;
  unit: "m" | "cm" | "mm";
  source: MeasurementSource;
  status: ReviewStatus;
  confidence: number | null;
  pageNumber: number | null;
  evidence: string;
}

export interface DetectedArea {
  id: string;
  kind: AreaType;
  label: string;
  confidence: number | null;
  source: AreaSource;
  status: ReviewStatus;
  pageNumber: number;
  bbox: NormalizedBox;
  hasBbox: boolean;
  evidence: string[];
}

export type QuestionType = "text" | "number" | "select" | "boolean";

export interface DomainQuestion {
  id: string;
  label: string;
  help?: string;
  type: QuestionType;
  unit?: string;
  options?: string[];
  required: boolean;
}

export interface AreaRule {
  title: string;
  description: string;
  products: string[];
  measurements: string[];
  questions: DomainQuestion[];
}

export interface AiAnalysisResult {
  documentSummary: string;
  warnings: string[];
  areas: DetectedArea[];
  measurements: Measurement[];
}

export interface PlanningHandoff {
  schemaVersion: "1.0";
  createdAt: string;
  project: {
    fileName: string;
    pageCount: number;
  };
  analysis: {
    summary: string;
    warnings: string[];
  };
  areas: Array<{
    id: string;
    kind: AreaType;
    label: string;
    pageNumber: number;
    bbox: NormalizedBox | null;
    source: AreaSource;
    evidence: string[];
    relevantProducts: string[];
    requiredMeasurements: string[];
    answers: Record<string, string | number | boolean>;
  }>;
  measurements: Measurement[];
  audit: {
    aiModel: string;
    confirmedAreaCount: number;
    confirmedMeasurementCount: number;
  };
}
