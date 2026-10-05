import type { NormalizedBox, PlanningHandoff } from "../types";

export interface PlannerAnnotation {
  areaId: string;
  finalSystem: string[];
  decisions: Record<string, string | number | boolean>;
  missingInformation: string[];
  questionsAsked: string[];
  finalGeometry?: NormalizedBox;
}

/** Explicit planner annotations are the only source of final-system labels.
 * Predictions remain separate, so historical pairs cannot accidentally become
 * model-generated ground truth. This does not train or call a model.
 */
export function buildHistoricalSample(
  source: PlanningHandoff,
  review: {
    projectId: string;
    sourceDocumentHash: string;
    finalDocumentHash: string;
    reviewedBy: string;
    reviewedAt: string;
    annotations: PlannerAnnotation[];
    preparationMinutes?: number;
  },
) {
  if (!review.projectId.trim() || !review.reviewedBy.trim() || Number.isNaN(Date.parse(review.reviewedAt))) {
    throw new Error("Project, reviewer and valid review date are required.");
  }
  if (![review.sourceDocumentHash, review.finalDocumentHash].every((hash) => /^[a-f\d]{64}$/i.test(hash))) {
    throw new Error("Both document references must be SHA-256 hashes.");
  }
  const seen = new Set<string>();
  const areas = review.annotations.map((annotation) => {
    const area = source.areas.find((item) => item.id === annotation.areaId);
    if (!area || seen.has(annotation.areaId)) throw new Error(`Unknown or duplicate area: ${annotation.areaId}`);
    seen.add(annotation.areaId);
    const geometry = annotation.finalGeometry;
    if (geometry && (!Object.values(geometry).every(Number.isFinite) || geometry.x < 0 || geometry.y < 0 ||
      geometry.width <= 0 || geometry.height <= 0 || geometry.x + geometry.width > 1 || geometry.y + geometry.height > 1)) {
      throw new Error(`Invalid final geometry: ${annotation.areaId}`);
    }
    const relatedIds = new Set(source.relationships?.filter((item) => item.areaId === area.id).map((item) => item.measurementId));
    return {
      areaId: area.id,
      prediction: { type: area.kind, geometry: area.bbox, labels: area.evidence, source: area.source,
        confidence: area.confidence ?? null, review: source.areaReviews?.find((item) => item.id === area.id) ?? null },
      measurements: source.measurements.filter((item) => relatedIds.has(item.id)),
      // 1.3 already resolves area answers with scope-aware inheritance. A project
      // total must not be introduced as an individual area's animal count.
      customerAnswers: source.schemaVersion === "1.3" ? { ...area.answers } : { ...source.project.answers, ...area.answers },
      customerAnswerProvenance: area.answerProvenance ?? null,
      planner: { ...annotation },
    };
  });
  return {
    schemaVersion: "historical-pair/1.0" as const,
    sourceSchemaVersion: source.schemaVersion,
    projectId: review.projectId,
    documents: { sourceSha256: review.sourceDocumentHash, finalSha256: review.finalDocumentHash },
    review: { by: review.reviewedBy, at: review.reviewedAt, preparationMinutes: review.preparationMinutes ?? null },
    analysis: source.analysis,
    audit: source.audit,
    planningContext: {
      projectAnswers: source.project.answers ?? {},
      preferences: source.preferences ?? null,
      groups: source.planningGroups ?? [],
    },
    areas,
    unassignedMeasurements: source.measurements.filter((item) => !source.relationships?.some((relation) => relation.measurementId === item.id)),
  };
}
