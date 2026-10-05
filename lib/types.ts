export const AREA_TYPES = [
  "feeding_area",
  "cubicles",
  "alley",
  "calving",
  "gate",
  "unknown",
] as const;

export type AreaType = (typeof AREA_TYPES)[number];
export type AreaSource = "ai" | "manual" | "pdf-text" | "geometry";
export type ReviewStatus = "unconfirmed" | "confirmed" | "rejected";
export type MeasurementSource = "pdf-text" | "geometry" | "ai" | "customer";
export type LengthUnit = "m" | "cm" | "mm" | "unknown";
export type DocumentKind = "vector" | "raster" | "mixed";

export interface PlanPoint { x: number; y: number }
export interface PdfLine { id: string; start: PlanPoint; end: PlanPoint; strokeWidth?: number }
export interface UnitInference { unit: LengthUnit; confidence: number; evidence: string }

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTextItem {
  text: string;
  bbox: NormalizedBox;
  id?: string;
  orientation?: number; // degrees in page coordinates
  fontSize?: number; // PDF points
  baseline?: PlanPoint;
}

export interface PdfPageData {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  textItems: PdfTextItem[];
  imageDataUrl: string;
  lines?: PdfLine[];
  documentKind?: DocumentKind;
  imageCount?: number;
  extractionWarnings?: string[];
}

export interface Measurement {
  id: string;
  key: string;
  label: string;
  value: number;
  unit: LengthUnit;
  source: MeasurementSource;
  status: ReviewStatus;
  confidence: number | null;
  pageNumber: number | null;
  bbox: NormalizedBox | null;
  evidence: string;
  sources?: string[];
  textObjectId?: string;
  kind?: "plan-length" | "opening-width" | "opening-height";
  pairedMeasurementId?: string;
  parentMeasurementId?: string;
  orientation?: "horizontal" | "vertical";
  dimensionLine?: { start: PlanPoint; end: PlanPoint };
  startReference?: PlanPoint;
  endReference?: PlanPoint;
  chainId?: string;
  unitInference?: UnitInference;
  signals?: Record<string, number>;
  originalValue?: number;
  originalUnit?: LengthUnit;
  originalUnitInference?: UnitInference;
  corrections?: Array<{ at: string; value: number; unit: LengthUnit; source: MeasurementSource }>;
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
  originalBbox?: NormalizedBox;
  originalSource?: AreaSource;
  originalConfidence?: number | null;
  geometryCorrections?: Array<{ at: string; bbox: NormalizedBox; source: "customer" }>;
}

export type QuestionType = "text" | "number" | "select" | "boolean";

export interface DomainQuestion {
  id: string;
  label: string;
  type: QuestionType;
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
  schemaVersion: "1.2";
  createdAt: string;
  project: {
    fileName: string;
    pageCount: number;
    answers?: Record<string, string | number | boolean>;
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
    confidence?: number | null;
    evidence: string[];
    relevantProducts: string[];
    requiredMeasurements: string[];
    answers: Record<string, string | number | boolean>;
  }>;
  measurements: Measurement[];
  documents?: Array<{ fileName: string; pages: Array<{
    pageNumber: number; width: number; height: number; documentKind?: DocumentKind;
    textObjects: PdfTextItem[]; geometryObjects: PdfLine[]; extractionWarnings?: string[];
  }> }>;
  areaReviews?: DetectedArea[];
  relationships?: Array<{ measurementId: string; areaId: string; relation: "inside"; confidence: number }>;
  review?: { openAreaCount: number; unresolvedMeasurementCount: number; missingAnswerCount: number; pendingAnalysis?: boolean; ready: boolean };
  audit: {
    aiModel: string;
    actualModels?: { areas?: string; measurements?: string };
    rulesVersion?: string;
    confirmedAreaCount: number;
    detectedMeasurementCount: number;
    customerCorrectedMeasurementCount: number;
  };
}
