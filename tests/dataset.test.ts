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
for (const schemaVersion of ["1.3", "1.4"] as const) test(`${schemaVersion} historical samples retain project totals separately from effective area answers`, () => {
  const current: PlanningHandoff = { ...handoff, schemaVersion,
    project: { ...handoff.project, answers: { animalSpecies: "Rind", animalCount: 200 },
      answerProvenance: { animalSpecies: { source: "pdf-text", scope: "project", confidence: 0.97, evidence: ["200 Rinder insgesamt"], pageNumber: 1 } },
      detectedFacts: { animalSpecies: { value: "Rind", source: "pdf-text", scope: "project", confidence: 0.97, evidence: ["200 Rinder insgesamt"], pageNumber: 1 } },
    },
    areas: [{ ...handoff.areas[0], answers: { animalSpecies: "Rind", feedingRestraint: "Ja" },
      answerProvenance: { feedingRestraint: { source: "customer", scope: "group", groupKind: "feeding_area" } } }],
    preferences: { groupAnswers: { feeding_area: { feedingRestraint: "Ja" } }, areaOverrides: {}, additionalEquipment: {} },
  };
  const sample = buildHistoricalSample(current, review);
  assert.equal(sample.areas[0].customerAnswers.animalCount, undefined);
  assert.equal(sample.planningContext.projectAnswers.animalCount, 200);
  assert.equal(sample.areas[0].customerAnswerProvenance?.feedingRestraint.scope, "group");
  assert.deepEqual(sample.planningContext.preferences, current.preferences);
  assert.deepEqual(sample.planningContext.projectAnswerProvenance, current.project.answerProvenance);
  assert.deepEqual(sample.planningContext.detectedFacts, current.project.detectedFacts);
});

test("legacy historical samples keep inheritance and tolerate absent provenance/facts", () => {
  const sample = buildHistoricalSample(handoff, review);
  assert.equal(sample.areas[0].customerAnswers.animalSpecies, "Rind");
  assert.deepEqual(sample.planningContext.projectAnswerProvenance, {});
  assert.deepEqual(sample.planningContext.detectedFacts, {});
});

test("historical geometry preserves predicted holes and a separately reviewed planner footprint", () => {
  const footprint = { parts: [{ outer: [{ x: .1, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .8 }, { x: .1, y: .8 }],
    holes: [[{ x: .3, y: .3 }, { x: .5, y: .3 }, { x: .5, y: .5 }, { x: .3, y: .5 }]] }] };
  const current: PlanningHandoff = { ...handoff, schemaVersion: "1.4", areas: [{ ...handoff.areas[0], footprint, originalLabel: "9. komunikacja",
    contourProvenance: { method: "vector-free-space", roomNumber: "9", textItemId: "r9", sourceLineIds: ["wall"], resolutionPoints: 1 } }] };
  const annotation = { ...review.annotations[0], finalFootprint: footprint };
  const sample = buildHistoricalSample(current, { ...review, annotations: [annotation] });
  assert.deepEqual(sample.areas[0].prediction.footprint, footprint);
  assert.deepEqual(sample.areas[0].planner.finalFootprint, footprint);
  assert.equal(sample.areas[0].prediction.contourProvenance?.roomNumber, "9");
  assert.equal(sample.areas[0].prediction.originalLabel, "9. komunikacja");
  const invalid = { parts: [{ outer: [{ x: -.1, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .8 }] }] };
  assert.throws(() => buildHistoricalSample(current, { ...review, annotations: [{ ...annotation, finalFootprint: invalid }] }), /Invalid final footprint/);
});
