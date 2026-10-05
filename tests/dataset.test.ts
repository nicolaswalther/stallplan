import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHistoricalSample } from "../lib/evaluation/dataset";
import type { PlanningHandoff } from "../lib/types";

const handoff: PlanningHandoff = {
  schemaVersion: "1.2", createdAt: "2026-10-05T12:00:00Z",
  project: { fileName: "source.pdf", pageCount: 1, answers: { animalSpecies: "Rind" } },
  analysis: { summary: "", warnings: [] }, measurements: [],
  areas: [{ id: "area1", kind: "feeding_area", label: "Fressbereich", pageNumber: 1, bbox: null, source: "manual", evidence: [], relevantProducts: ["possibility"], requiredMeasurements: [], answers: {} }],
  audit: { aiModel: "none", confirmedAreaCount: 1, detectedMeasurementCount: 0, customerCorrectedMeasurementCount: 0 },
};
const review = { projectId: "test", sourceDocumentHash: "a".repeat(64), finalDocumentHash: "b".repeat(64), reviewedBy: "planner", reviewedAt: "2026-10-05T13:00:00Z", annotations: [{ areaId: "area1", finalSystem: ["reviewed-system"], decisions: { mounting: "wall" }, missingInformation: [], questionsAsked: ["animalSpecies"] }] };
test("historical labels require explicit planner annotation and keep prediction separate", () => {
  const sample = buildHistoricalSample(handoff, review);
  assert.deepEqual(sample.areas[0].planner.finalSystem, ["reviewed-system"]);
  assert.equal(sample.areas[0].prediction.type, "feeding_area");
  assert.equal(sample.areas[0].customerAnswers.animalSpecies, "Rind");
  assert.equal(sample.areas[0].planner.finalSystem.includes("possibility"), false);
});
test("historical data rejects unknown areas and invalid document references", () => {
  assert.throws(() => buildHistoricalSample(handoff, { ...review, annotations: [{ ...review.annotations[0], areaId: "missing" }] }), /Unknown/);
  assert.throws(() => buildHistoricalSample(handoff, { ...review, finalDocumentHash: "missing" }), /SHA-256/);
});
