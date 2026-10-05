import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  evaluateAreas, evaluateAreaRuns, footprintOverlap, maximumWeightAssignment, rectangleFootprint,
  toEvaluationAreas, type AreaFootprint, type EvaluationArea, type ReferenceArea,
} from "../lib/evaluation/areas";
import type { DetectedArea } from "../lib/types";

const area = (id: string, kind = "cubicles", x = .1, pageNumber = 1): EvaluationArea => ({
  id, kind, pageNumber, bbox: { x, y: .1, width: .2, height: .2 }, confidence: .99,
});
const reference = (id: string, kind = "cubicles", x = .1): ReferenceArea => ({ ...area(id, kind, x), geometryQuality: "coarse-room-extent" });
const close = (value: number, expected: number) => assert.ok(Math.abs(value - expected) < 1e-10, `${value} != ${expected}`);

test("spatial assignment exposes feeding/alley swaps regardless of confidence or labels", () => {
  const expected = [reference("feed", "feeding_area", .1), reference("walk", "alley", .6)];
  const result = evaluateAreas([area("a", "alley", .1), area("b", "feeding_area", .6)], expected);
  assert.equal(result.localization.recall, 1);
  assert.equal(result.classification.recall, 0);
  assert.equal(result.detection.recall, 0);
  assert.equal(result.falsePositives.length, 2);
  assert.equal(result.falseNegatives.length, 2);
  assert.equal(result.confusionMatrix.feeding_area.alley, 1);
  assert.equal(result.confusionMatrix.alley.feeding_area, 1);
  assert.equal(result.perCategory.feeding_area.falseNegatives, 1);
  assert.equal(result.perCategory.alley.falsePositives, 1);
});

test("Hungarian matching maximizes global overlap instead of greedily taking one box", () => {
  const pairs = maximumWeightAssignment([[.9, .8], [.85, 0]]);
  assert.deepEqual(new Set(pairs.map((pair) => pair.join(":"))), new Set(["0:1", "1:0"]));
  assert.deepEqual(maximumWeightAssignment([]), []);
  assert.equal(maximumWeightAssignment([[0, 0], [0, 0]]).length, 0);
  assert.equal(maximumWeightAssignment([[.8], [.9]]).length, 1);
});

test("changing application UUIDs cannot change equal-overlap assignment", () => {
  const expected = [reference("room", "cubicles")];
  const a = evaluateAreas([area("a", "cubicles"), area("z", "alley")], expected);
  const b = evaluateAreas([area("z", "cubicles"), area("a", "alley")], expected);
  assert.equal(a.matches[0].predictedKind, b.matches[0].predictedKind);
  assert.deepEqual(a.detection, b.detection);
});

test("a partial area remains class-correct but fails localization and completeness", () => {
  const prediction = { ...area("partial"), bbox: { x: .1, y: .1, width: .2, height: .05 } };
  const result = evaluateAreas([prediction], [reference("room")]);
  assert.equal(result.classification.recall, 1);
  assert.equal(result.detection.recall, 0);
  close(result.matches[0].referenceCoverage, .25);
  close(result.matches[0].predictionPrecision, 1);
  assert.equal(result.falsePositives[0].reason, "insufficient-footprint-iou");
  assert.equal(result.matches[0].confidence, .99, "high reported confidence cannot override geometry scoring");
});

test("duplicates, invalid geometry and missing rooms remain in metric denominators", () => {
  const bad = { ...area("bad"), bbox: { x: .5, y: .1, width: Number.NaN, height: .2 } };
  const result = evaluateAreas([area("a"), area("duplicate"), bad], [reference("one"), reference("two", "cubicles", .6)]);
  assert.equal(result.classification.precision, 1 / 3);
  assert.equal(result.detection.recall, .5);
  assert.equal(result.localization.meanFootprintIoUAllReferences, .5);
  assert.equal(result.localization.meanReferenceCoverageAllReferences, .5);
  assert.deepEqual(result.invalidPredictions, ["bad"]);
  assert.equal(result.duplicates.length, 1);
  assert.deepEqual(result.missingSpatialReferences, ["two"]);
});

test("other pages cannot spatially match and explicitly excluded rooms are separately reported", () => {
  const result = evaluateAreas([area("correct"), area("other-page", "cubicles", .6, 2), area("service", "unknown", .8)],
    [reference("principal"), reference("missing", "cubicles", .6)], { excludedReferences: [reference("auxiliary", "service", .8)] });
  assert.equal(result.predictionCount, 3);
  assert.equal(result.scoredPredictionCount, 2);
  assert.equal(result.detection.precision, .5);
  assert.deepEqual(result.ignoredPredictions, [{ predictionId: "service", referenceId: "auxiliary", reason: "outside-defined-reference-scope" }]);
  assert.equal(result.falsePositives[0].id, "other-page");
});

test("unannotated equipment is reported as unscored rather than assumed to be a false positive", () => {
  const result = evaluateAreas([area("room"), area("gate", "gate", .6)], [reference("principal")], { unscoredKinds: ["gate"] });
  assert.equal(result.predictionCount, 2);
  assert.equal(result.scoredPredictionCount, 1);
  assert.equal(result.detection.precision, 1);
  assert.equal(result.falsePositives.length, 0);
  assert.equal(result.ignoredPredictions[0].reason, "category-without-complete-reference-annotations");
  assert.throws(() => evaluateAreas([], [reference("r")], { unscoredKinds: ["cubicles"] }), /cannot also be unscored/);
});

test("exact footprint overlap subtracts holes and does not count overlapping parts twice", () => {
  const square = rectangleFootprint({ x: 0, y: 0, width: 1, height: 1 });
  const holed = { parts: [{ ...square.parts[0], holes: [rectangleFootprint({ x: .2, y: .2, width: .6, height: .6 }).parts[0].outer] }] };
  const result = footprintOverlap(square, holed);
  close(result.iou, .64); close(result.referenceCoverage, 1); close(result.predictionPrecision, .64);
  const overlappingParts: AreaFootprint = { parts: [
    ...rectangleFootprint({ x: 0, y: 0, width: .75, height: 1 }).parts,
    ...rectangleFootprint({ x: .25, y: 0, width: .75, height: 1 }).parts,
  ] };
  close(footprintOverlap(overlappingParts, square).iou, 1);
});

test("diagonal polygon intersections integrate exactly without a pixel grid", () => {
  const left: AreaFootprint = { parts: [{ outer: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] };
  const right: AreaFootprint = { parts: [{ outer: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] };
  const result = footprintOverlap(left, right);
  close(result.iou, 1 / 3); close(result.referenceCoverage, .5); close(result.predictionPrecision, .5);
  close(result.intersectionArea, .25);
});

test("explicit polygon adapter scores holes and rejected candidates do not reappear", () => {
  const detected: DetectedArea = { ...area("a"), kind: "cubicles", confidence: .99, label: "Liegeboxen",
    source: "ai", status: "unconfirmed", evidence: [], hasBbox: true };
  const footprint = rectangleFootprint(detected.bbox);
  const adapted = toEvaluationAreas([detected, { ...detected, id: "removed", status: "rejected" }], () => footprint);
  assert.equal(adapted.length, 1);
  assert.equal(adapted[0].footprint, footprint);
  const { x, y, width, height } = detected.bbox;
  const withHole = { parts: [{ outer: footprint.parts[0].outer, holes: [[
    { x: x + width * .2, y: y + height * .2 }, { x: x + width * .8, y: y + height * .2 },
    { x: x + width * .8, y: y + height * .8 }, { x: x + width * .2, y: y + height * .8 },
  ]] }] };
  const native = toEvaluationAreas([{ ...detected, footprint: withHole }]);
  const expected = [{ ...native[0], id: "reference" }];
  close(evaluateAreas(native, expected).localization.meanFootprintIoUAllReferences!, 1);
  assert.ok(evaluateAreas(adapted, expected).localization.meanFootprintIoUAllReferences! < .7,
    "the default production adapter must not fill an excluded island");
  const malformed = toEvaluationAreas([{ ...detected, hasBbox: false }]);
  assert.deepEqual(evaluateAreas(malformed, [reference("r")]).invalidPredictions, ["a"]);
});

test("repeated runs expose per-room class instability, missing rooms and shape jitter", () => {
  const expected = [reference("feed", "feeding_area", .1), reference("walk", "alley", .6)];
  const result = evaluateAreaRuns([
    { id: "one", areas: [area("feed-one", "feeding_area", .1), area("walk-one", "alley", .6)], usage: { inputTokens: 5 } },
    { id: "two", areas: [area("feed-two", "alley", .1), area("walk-two", "alley", .61)] },
    { id: "three", areas: [area("feed-three", "feeding_area", .1)] },
  ], expected);
  assert.equal(result.runCount, 3);
  assert.equal(result.stability[0].correctClassRate, 2 / 3);
  assert.deepEqual(result.stability[0].observedClasses, ["alley", "feeding_area"]);
  assert.equal(result.stability[1].spatialPresenceRate, 2 / 3);
  assert.equal(result.stability[1].minFootprintIoUAllRuns, 0);
  assert.ok(result.stability[1].meanPairwisePredictionIoUWhenPresent! < 1);
  assert.equal(result.summary.minDetectionRecall, .5);
  assert.equal(result.summary.maxDetectionRecall, 1);
  assert.deepEqual(result.summary.alwaysCorrectLocalizedReferenceIds, []);
  assert.deepEqual(result.runs[0].usage, { inputTokens: 5 });
});

test("the committed reference preserves independent principal scope and nonrectangular walkway", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/obora-areas-reference.json", import.meta.url), "utf8"));
  assert.equal(fixture.areas.length, 10);
  assert.equal(fixture.excludedAreas.length, 6);
  const walkway: ReferenceArea = fixture.areas.find((item: ReferenceArea) => item.roomNumber === 9);
  assert.equal(walkway.footprint?.parts[0].holes?.length, 2);
  const result = evaluateAreas(fixture.areas, fixture.areas);
  assert.equal(result.detection.recall, 1);
  assert.equal(result.localization.meanFootprintIoUAllReferences, 1);
  const rectanglesOnly = fixture.areas.map((item: ReferenceArea) => ({ ...item, footprint: undefined }));
  const bboxResult = evaluateAreas(rectanglesOnly, fixture.areas);
  assert.ok(bboxResult.matches.find((item) => item.referenceId === walkway.id)!.footprintIoU < 1,
    "a enclosing rectangle must not be mistaken for an exact walkway outline");
});

test("empty predictions, invalid references and duplicate IDs fail or report honestly", () => {
  const empty = evaluateAreas([], [reference("r")]);
  assert.equal(empty.classification.precision, null);
  assert.equal(empty.detection.recall, 0);
  assert.equal(empty.localization.meanFootprintIoUAllReferences, 0);
  assert.equal(evaluateAreas([], []).detection.recall, null);
  assert.throws(() => evaluateAreas([area("same"), area("same")], [reference("r")]), /Duplicate prediction/);
  assert.throws(() => evaluateAreas([], [reference("same"), reference("same")]), /duplicate reference/);
  assert.throws(() => evaluateAreas([], [reference("r")], { associationIoU: .6, localizationIoU: .5 }), /threshold/);
  const malformed = { ...area("bad-footprint"), footprint: {} as AreaFootprint };
  assert.deepEqual(evaluateAreas([malformed], [reference("r")]).invalidPredictions, ["bad-footprint"]);
});
