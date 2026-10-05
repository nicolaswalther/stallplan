import type { AnalysisUsage } from "./ai/usage";
import type { AreaFootprint } from "./plan/area-geometry";

export const AREA_TYPES = [
  "feeding_area",
  "cubicles",
  "alley",
  "calving",
  "pens",
  "isolation",
  "gate",
  "drinker",
  "brush",
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
export interface PdfDetailImage {
  kind: "outline-text";
  bbox: NormalizedBox;
  imageDataUrl: string;
  sourceLineIds: string[];
  sourceLineCount: number;
  rowCount: number;
}
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
  semanticDetails?: PdfDetailImage[];
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
  originalEvidence?: string;
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
  footprint?: AreaFootprint;
  originalFootprint?: AreaFootprint;
  contourProvenance?: {
    method: "vector-free-space";
    roomNumber: string;
    textItemId: string;
    sourceLineIds: string[];
    resolutionPoints: number;
    /** A literal table/room identifier resolved a conflicting model position. */
    modelBoxConflict?: boolean;
  };
  originalContourProvenance?: DetectedArea["contourProvenance"];
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
  originalLabel?: string;
  originalEvidence?: string[];
  removedAt?: string;
  removalPreviousStatus?: ReviewStatus;
  boundaryAssessment?: {
    method: "vector-side-support";
    supportedSides: Array<"left" | "top" | "right" | "bottom">;
    sourceLineIds: string[];
  };
  boundaryRefinement?: {
    method: "vector-rails";
    originalBbox: NormalizedBox;
    snappedSides: Array<"left" | "top" | "right" | "bottom">;
    sourceLineIds: string[];
    confidence: number;
  };
  originalBbox?: NormalizedBox;
  originalSource?: AreaSource;
  originalConfidence?: number | null;
  geometryCorrections?: Array<{ at: string; bbox: NormalizedBox; footprint?: AreaFootprint; source: "customer" }>;
}

export type QuestionType = "text" | "number" | "select" | "boolean";
export type AnswerValue = string | number | boolean;
export type AnswerMap = Record<string, AnswerValue>;
export interface ProjectFact {
  value: AnswerValue;
  confidence: number;
  evidence: string[];
  source: "pdf-text" | "ai";
  pageNumber?: number;
  scope: "project" | "group";
  groupKind?: AreaType;
}
export type ProjectFacts = Record<string, ProjectFact>;
export const EQUIPMENT_TYPES = ["drinker", "brush", "gate"] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

/** Shared wishes never create a detected object or imply an equipment location. */
export interface PlanningPreferences {
  groupAnswers: Partial<Record<AreaType, AnswerMap>>;
  groupAnswerProvenance?: Partial<Record<AreaType, Record<string, AnswerProvenance>>>;
  areaOverrides: Record<string, AnswerMap>;
  additionalEquipment: Partial<Record<EquipmentType, boolean>>;
}

export interface AnswerProvenance {
  source: "customer" | "pdf-text" | "ai";
  scope: "project" | "group" | "area";
  groupKind?: AreaType;
  areaId?: string;
  confidence?: number;
  evidence?: string[];
  pageNumber?: number;
}

export interface PlanningGroup {
  id: AreaType;
  kind: AreaType;
  title: string;
  areaIds: string[];
  additional: boolean;
}

export interface DomainQuestion {
  id: string;
  label: string;
  type: QuestionType;
  options?: string[];
  required: boolean;
  /** Hidden branches must not become unanswered requirements. */
  when?: { questionId: string; values: AnswerValue[]; and?: Array<{ questionId: string; values: AnswerValue[] }> };
}

export interface AreaRule {
  title: string;
  description: string;
  products: string[];
  measurements: string[];
  questions: DomainQuestion[];
  sources?: Array<{ label: string; url: string }>;
}

export interface AiAnalysisResult {
  documentSummary: string;
  warnings: string[];
  areas: DetectedArea[];
  measurements: Measurement[];
  projectFacts?: ProjectFacts;
  originalAnalysis?: { documentSummary: string; warnings: string[] };
}

export interface PlanningHandoff {
  schemaVersion: "1.2" | "1.3" | "1.4";
  createdAt: string;
  project: {
    fileName: string;
    pageCount: number;
    answers?: AnswerMap;
    answerProvenance?: Record<string, AnswerProvenance>;
    detectedFacts?: ProjectFacts;
  };
  analysis: {
    summary: string;
    warnings: string[];
    originalAnalysis?: { documentSummary: string; warnings: string[] };
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
    originalLabel?: string;
    originalEvidence?: string[];
    boundaryRefinement?: DetectedArea["boundaryRefinement"];
    boundaryAssessment?: DetectedArea["boundaryAssessment"];
    footprint?: AreaFootprint;
    contourProvenance?: DetectedArea["contourProvenance"];
    relevantProducts: string[];
    requiredMeasurements: string[];
    answers: AnswerMap;
    answerProvenance?: Record<string, AnswerProvenance>;
  }>;
  measurements: Measurement[];
  preferences?: PlanningPreferences;
  planningGroups?: Array<PlanningGroup & { answers: AnswerMap; answerProvenance: Record<string, AnswerProvenance> }>;
  documents?: Array<{ fileName: string; pages: Array<{
    pageNumber: number; width: number; height: number; documentKind?: DocumentKind;
    textObjects: PdfTextItem[]; geometryObjects: PdfLine[]; extractionWarnings?: string[];
  }> }>;
  areaReviews?: DetectedArea[];
  relationships?: Array<{ measurementId: string; areaId: string; relation: "inside"; confidence: number }>;
  review?: { openAreaCount: number; unresolvedMeasurementCount: number; missingAnswerCount: number; pendingAnalysis?: boolean; ready: boolean };
  audit: {
    usage?: AnalysisUsage[];
    aiModel: string;
    actualModels?: { areas?: string; measurements?: string };
    rulesVersion?: string;
    confirmedAreaCount: number;
    detectedMeasurementCount: number;
    customerCorrectedMeasurementCount: number;
  };
}
