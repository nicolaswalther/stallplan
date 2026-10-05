import type { DetectedArea, NormalizedBox, PlanPoint } from "../types";
import { boxIoU } from "./measurements";

/** Page-normalized coordinates, with document rotation already applied.
 * Parts are combined by union; holes are subtracted from their own outer ring.
 * No application-specific polygon property is guessed by the evaluator.
 */
export interface AreaFootprint {
  parts: Array<{ outer: PlanPoint[]; holes?: PlanPoint[][] }>;
}

export interface EvaluationArea {
  id: string;
  kind: string;
  pageNumber: number;
  bbox: NormalizedBox;
  footprint?: AreaFootprint;
  confidence?: number | null;
}

export interface ReferenceArea extends EvaluationArea {
  label?: string;
  roomNumber?: number;
  geometryQuality?: string;
}

export interface AreaEvaluationOptions {
  /** Loose diagnostic association exposes wrong classes and incomplete shapes. */
  associationIoU?: number;
  /** Class-correct detections must also exceed this footprint IoU. */
  localizationIoU?: number;
  /** Annotated rooms outside the defined product scope, reported separately. */
  excludedReferences?: ReferenceArea[];
  /** Categories without complete annotations must not be called false positives. */
  unscoredKinds?: string[];
}

type Interval = [number, number];
type Edge = [PlanPoint, PlanPoint];
const EPSILON = 1e-12;
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function rectangleFootprint(box: NormalizedBox): AreaFootprint {
  return { parts: [{ outer: [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height },
  ] }] };
}

function edges(ring: PlanPoint[]): Edge[] {
  return ring.map((point, index) => [point, ring[(index + 1) % ring.length]]);
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    if (end - start <= EPSILON) continue;
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + EPSILON) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function ringIntervals(ring: PlanPoint[], x: number): Interval[] {
  const crossingYs = edges(ring).flatMap(([a, b]) =>
    (a.x <= x && x < b.x) || (b.x <= x && x < a.x)
      ? [a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x)] : []);
  crossingYs.sort((a, b) => a - b);
  const intervals: Interval[] = [];
  for (let index = 0; index + 1 < crossingYs.length; index += 2) intervals.push([crossingYs[index], crossingYs[index + 1]]);
  return intervals;
}

function subtractIntervals(outer: Interval[], holes: Interval[]): Interval[] {
  let remaining = outer;
  for (const [start, end] of holes) remaining = remaining.flatMap(([a, b]) => {
    if (end <= a || start >= b) return [[a, b] as Interval];
    const result: Interval[] = [];
    if (start > a) result.push([a, start]);
    if (end < b) result.push([end, b]);
    return result;
  });
  return remaining;
}

function crossSection(footprint: AreaFootprint, x: number): Interval[] {
  return mergeIntervals(footprint.parts.flatMap((part) => subtractIntervals(
    ringIntervals(part.outer, x), mergeIntervals((part.holes ?? []).flatMap((hole) => ringIntervals(hole, x))),
  )));
}

function intersectionLength(a: Interval[], b: Interval[]) {
  let total = 0, left = 0, right = 0;
  while (left < a.length && right < b.length) {
    total += Math.max(0, Math.min(a[left][1], b[right][1]) - Math.max(a[left][0], b[right][0]));
    if (a[left][1] < b[right][1]) left++; else right++;
  }
  return total;
}

function intersectionX(first: Edge, second: Edge): number | null {
  const [a, b] = first, [c, d] = second;
  const dx = b.x - a.x, dy = b.y - a.y, ex = d.x - c.x, ey = d.y - c.y;
  const denominator = dx * ey - dy * ex;
  if (Math.abs(denominator) < EPSILON) return null;
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denominator;
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denominator;
  return t > EPSILON && t < 1 - EPSILON && u > EPSILON && u < 1 - EPSILON ? a.x + t * dx : null;
}

/** Exact vertical-slab integration for straight-edged polygons, including holes.
 * Edge crossings split slabs so cross-section lengths are linear within each
 * slab. Two interior samples then integrate that length without boundary ties.
 * This also works for diagonal rings, rather than sampling a coarse pixel grid.
 */
export function footprintOverlap(prediction: AreaFootprint, reference: AreaFootprint) {
  const allEdges = [prediction, reference].flatMap((shape) => shape.parts.flatMap((part) =>
    [part.outer, ...(part.holes ?? [])].flatMap(edges)));
  const xs = new Set(allEdges.flatMap(([a, b]) => [a.x, b.x]));
  for (let i = 0; i < allEdges.length; i++) for (let j = i + 1; j < allEdges.length; j++) {
    const x = intersectionX(allEdges[i], allEdges[j]);
    if (x !== null) xs.add(x);
  }
  const sorted = [...xs].sort((a, b) => a - b);
  let predictionArea = 0, referenceArea = 0, intersectionArea = 0;
  for (let index = 0; index + 1 < sorted.length; index++) {
    const width = sorted[index + 1] - sorted[index];
    if (width <= EPSILON) continue;
    for (const portion of [.25, .75]) {
      const x = sorted[index] + width * portion;
      const predictedIntervals = crossSection(prediction, x), referenceIntervals = crossSection(reference, x);
      predictionArea += width / 2 * predictedIntervals.reduce((sum, [a, b]) => sum + b - a, 0);
      referenceArea += width / 2 * referenceIntervals.reduce((sum, [a, b]) => sum + b - a, 0);
      intersectionArea += width / 2 * intersectionLength(predictedIntervals, referenceIntervals);
    }
  }
  return {
    iou: ratio(intersectionArea, predictionArea + referenceArea - intersectionArea) ?? 0,
    referenceCoverage: ratio(intersectionArea, referenceArea) ?? 0,
    predictionPrecision: ratio(intersectionArea, predictionArea) ?? 0,
    predictionArea, referenceArea, intersectionArea,
  };
}

/** Preserve rejected/no-geometry handling and the production footprint. An
 * explicit adapter supports other import schemas without discarding holes.
 */
export function toEvaluationAreas(
  areas: DetectedArea[], footprintAdapter?: (area: DetectedArea) => AreaFootprint | undefined,
): EvaluationArea[] {
  return areas.filter((area) => area.status !== "rejected").map((area) => ({
    id: area.id, kind: area.kind, pageNumber: area.pageNumber,
    bbox: area.hasBbox ? area.bbox : { x: Number.NaN, y: Number.NaN, width: 0, height: 0 },
    confidence: area.confidence, footprint: footprintAdapter ? footprintAdapter(area) : area.footprint,
  }));
}

function validArea(area: EvaluationArea) {
  const b = area.bbox;
  if (!area.id || !area.kind || !Number.isInteger(area.pageNumber) || area.pageNumber < 1 ||
    !b || !Object.values(b).every(Number.isFinite) || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 ||
    b.x + b.width > 1 + EPSILON || b.y + b.height > 1 + EPSILON) return false;
  const shape = area.footprint;
  if (shape && (!Array.isArray(shape.parts) || !shape.parts.length || !shape.parts.every((part) =>
    part && Array.isArray(part.outer) && (part.holes === undefined || Array.isArray(part.holes)) &&
    [part.outer, ...(part.holes ?? [])].every((ring) => Array.isArray(ring) && ring.length >= 3 && ring.every((p) =>
      p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= 1 && p.y <= 1))))) return false;
  return !shape || footprintOverlap(shape, shape).referenceArea > EPSILON;
}

/** Maximum-weight, one-to-one spatial assignment (Hungarian algorithm).
 * Classes, confidence, labels and room numbers do not influence assignment.
 */
export function maximumWeightAssignment(weights: number[][]): Array<[number, number]> {
  const rows = weights.length, columns = Math.max(0, ...weights.map((row) => row.length));
  const n = Math.max(rows, columns);
  if (!n) return [];
  const u = Array(n + 1).fill(0), v = Array(n + 1).fill(0), p = Array(n + 1).fill(0), way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cost = 1 - (weights[i0 - 1]?.[j - 1] ?? 0) - u[i0] - v[j];
        if (cost < min[j]) { min[j] = cost; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta;
      }
      j0 = j1;
    } while (p[j0]);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  return p.flatMap((row, column) => row > 0 && row <= rows && column > 0 && column <= columns &&
    weights[row - 1][column - 1] > 0 ? [[row - 1, column - 1] as [number, number]] : []);
}

function metrics(truePositives: number, predictionCount: number, referenceCount: number) {
  const precision = ratio(truePositives, predictionCount), recall = ratio(truePositives, referenceCount);
  return { truePositives, falsePositives: predictionCount - truePositives, falseNegatives: referenceCount - truePositives,
    precision, recall, f1: precision !== null && recall !== null ? (precision + recall ? 2 * precision * recall / (precision + recall) : 0) : null };
}

export function evaluateAreas(actual: EvaluationArea[], expected: ReferenceArea[], options: AreaEvaluationOptions = {}) {
  const associationIoU = options.associationIoU ?? .1, localizationIoU = options.localizationIoU ?? .5;
  if (![associationIoU, localizationIoU].every(Number.isFinite) || associationIoU <= 0 || associationIoU > localizationIoU || localizationIoU > 1) throw new Error("Invalid area evaluation thresholds.");
  if (!expected.every(validArea) || new Set(expected.map((area) => area.id)).size !== expected.length) throw new Error("Invalid or duplicate reference areas.");
  if (!(options.excludedReferences ?? []).every(validArea)) throw new Error("Invalid excluded reference areas.");
  const unscoredKinds = new Set(options.unscoredKinds ?? []);
  if (expected.some((area) => unscoredKinds.has(area.kind))) throw new Error("Annotated reference categories cannot also be unscored.");
  const invalidPredictions = actual.filter((area) => !validArea(area));
  const unscoredPredictions = actual.filter((area) => unscoredKinds.has(area.kind));
  // Preserve response order for deterministic tie handling. Application IDs are
  // randomly generated on validation and must not influence evaluation results.
  const candidates = actual.filter((area) => validArea(area) && !unscoredKinds.has(area.kind));
  if (new Set(actual.map((area) => area.id)).size !== actual.length) throw new Error("Duplicate prediction IDs are not valid evaluation input.");
  const overlaps = expected.map((reference) => candidates.map((prediction) => {
    const bboxIoU = prediction.pageNumber === reference.pageNumber ? boxIoU(prediction.bbox, reference.bbox) : 0;
    const footprint = prediction.pageNumber === reference.pageNumber
      ? footprintOverlap(prediction.footprint ?? rectangleFootprint(prediction.bbox), reference.footprint ?? rectangleFootprint(reference.bbox))
      : { iou: 0, referenceCoverage: 0, predictionPrecision: 0 };
    return { bboxIoU, ...footprint };
  }));
  // Bounding extents associate incomplete/U-shaped predictions to their room;
  // true localization is always scored against the annotated footprint below.
  const weights = overlaps.map((row) => row.map((overlap) => overlap.bboxIoU >= associationIoU ? overlap.bboxIoU : 0));
  const assignment = maximumWeightAssignment(weights);
  const matches = assignment.map(([referenceIndex, predictionIndex]) => {
    const reference = expected[referenceIndex], prediction = candidates[predictionIndex], overlap = overlaps[referenceIndex][predictionIndex];
    const classCorrect = prediction.kind === reference.kind, localized = overlap.iou >= localizationIoU;
    return {
      predictionId: prediction.id, referenceId: reference.id, roomNumber: reference.roomNumber,
      predictedKind: prediction.kind, expectedKind: reference.kind, confidence: prediction.confidence ?? null,
      bboxIoU: overlap.bboxIoU, footprintIoU: overlap.iou, referenceCoverage: overlap.referenceCoverage,
      predictionPrecision: overlap.predictionPrecision, classCorrect, localized, truePositive: classCorrect && localized,
      referenceGeometryQuality: reference.geometryQuality ?? null,
    };
  }).sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  const matchedPredictions = new Set(matches.map((match) => match.predictionId));
  const matchedReferences = new Set(matches.map((match) => match.referenceId));
  const unmatched = candidates.filter((candidate) => !matchedPredictions.has(candidate.id));
  const ignoredPredictions: Array<{ predictionId: string; referenceId?: string; reason: string }> = unmatched.flatMap((prediction) => {
    const excluded = (options.excludedReferences ?? []).map((reference) => ({ reference,
      iou: prediction.pageNumber === reference.pageNumber ? boxIoU(prediction.bbox, reference.bbox) : 0,
    })).sort((a, b) => b.iou - a.iou)[0];
    return excluded && excluded.iou >= localizationIoU ? [{ predictionId: prediction.id, referenceId: excluded.reference.id, reason: "outside-defined-reference-scope" }] : [];
  });
  ignoredPredictions.push(...unscoredPredictions.map((area) => ({ predictionId: area.id, reason: "category-without-complete-reference-annotations" })));
  const ignoredIds = new Set(ignoredPredictions.map((area) => area.predictionId));
  const scored = actual.filter((area) => !ignoredIds.has(area.id));
  const falsePositives = scored.filter((prediction) => !matches.some((match) => match.predictionId === prediction.id && match.truePositive));
  const falseNegatives = expected.filter((reference) => !matches.some((match) => match.referenceId === reference.id && match.truePositive));
  const duplicates = unmatched.filter((prediction) => !ignoredIds.has(prediction.id)).flatMap((prediction) => {
    const overlapsMatched = expected.filter((reference) => matchedReferences.has(reference.id)).map((reference) => ({ reference,
      iou: prediction.pageNumber === reference.pageNumber ? boxIoU(prediction.bbox, reference.bbox) : 0,
    })).sort((a, b) => b.iou - a.iou)[0];
    return overlapsMatched && overlapsMatched.iou >= localizationIoU
      ? [{ predictionId: prediction.id, referenceId: overlapsMatched.reference.id, bboxIoU: overlapsMatched.iou }] : [];
  });
  const kinds = [...new Set([...expected.map((area) => area.kind), ...scored.map((area) => area.kind)])].sort();
  const perCategory = Object.fromEntries(kinds.map((kind) => [kind, {
    expectedCount: expected.filter((area) => area.kind === kind).length,
    predictionCount: scored.filter((area) => area.kind === kind).length,
    ...metrics(matches.filter((match) => match.truePositive && match.expectedKind === kind).length,
      scored.filter((area) => area.kind === kind).length, expected.filter((area) => area.kind === kind).length),
  }]));
  const confusionMatrix: Record<string, Record<string, number>> = {};
  for (const reference of expected) {
    const match = matches.find((item) => item.referenceId === reference.id);
    const predictedKind = match?.predictedKind ?? "missing";
    confusionMatrix[reference.kind] ??= {};
    confusionMatrix[reference.kind][predictedKind] = (confusionMatrix[reference.kind][predictedKind] ?? 0) + 1;
  }
  return {
    definition: { matching: "class-agnostic maximum-weight bbox IoU assignment", associationIoU, localizationIoU, unscoredKinds: [...unscoredKinds],
      geometryScoring: "annotated footprint IoU including polygon holes; missing rooms count as zero in all-reference means" },
    expectedCount: expected.length, predictionCount: actual.length, scoredPredictionCount: scored.length,
    classification: { ...metrics(matches.filter((match) => match.classCorrect).length, scored.length, expected.length),
      accuracyAmongSpatialMatches: ratio(matches.filter((match) => match.classCorrect).length, matches.length) },
    detection: metrics(matches.filter((match) => match.truePositive).length, scored.length, expected.length),
    localization: { ...metrics(matches.filter((match) => match.localized).length, scored.length, expected.length),
      meanBboxIoUAmongMatches: mean(matches.map((match) => match.bboxIoU)),
      meanFootprintIoUAmongMatches: mean(matches.map((match) => match.footprintIoU)),
      meanFootprintIoUAllReferences: ratio(matches.reduce((sum, match) => sum + match.footprintIoU, 0), expected.length),
      meanReferenceCoverageAllReferences: ratio(matches.reduce((sum, match) => sum + match.referenceCoverage, 0), expected.length),
    },
    matches, perCategory, confusionMatrix,
    missingSpatialReferences: expected.filter((reference) => !matchedReferences.has(reference.id)).map((area) => area.id),
    falsePositives: falsePositives.map((area) => ({ id: area.id, kind: area.kind,
      reason: invalidPredictions.some((item) => item.id === area.id) ? "invalid-geometry" :
        matches.some((match) => match.predictionId === area.id && !match.classCorrect) ? "wrong-class" :
          matches.some((match) => match.predictionId === area.id) ? "insufficient-footprint-iou" : "unmatched" })),
    falseNegatives: falseNegatives.map((area) => ({ id: area.id, kind: area.kind })),
    invalidPredictions: invalidPredictions.map((area) => area.id), duplicates, ignoredPredictions,
  };
}

export interface AreaEvaluationRun {
  id: string;
  model?: string;
  areas: EvaluationArea[];
  durationMs?: number;
  usage?: unknown;
  metadata?: Record<string, unknown>;
}

export function evaluateAreaRuns(runs: AreaEvaluationRun[], expected: ReferenceArea[], options: AreaEvaluationOptions = {}) {
  if (new Set(runs.map((run) => run.id)).size !== runs.length) throw new Error("Repeated run IDs must be distinct.");
  const evaluated = runs.map(({ areas, ...run }) => ({ ...run, evaluation: evaluateAreas(areas, expected, options) }));
  const stability = expected.map((reference) => {
    const matches = evaluated.flatMap((run) => run.evaluation.matches.filter((match) => match.referenceId === reference.id));
    const shapes = runs.flatMap((run, index) => {
      const match = evaluated[index].evaluation.matches.find((item) => item.referenceId === reference.id);
      const area = match && run.areas.find((area) => area.id === match.predictionId);
      return area ? [area.footprint ?? rectangleFootprint(area.bbox)] : [];
    });
    const pairwiseIoUs: number[] = [];
    for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) pairwiseIoUs.push(footprintOverlap(shapes[i], shapes[j]).iou);
    return {
      referenceId: reference.id, roomNumber: reference.roomNumber, kind: reference.kind,
      spatialPresenceRate: ratio(matches.length, runs.length),
      correctClassRate: ratio(matches.filter((match) => match.classCorrect).length, runs.length),
      correctLocalizedDetectionRate: ratio(matches.filter((match) => match.truePositive).length, runs.length),
      observedClasses: [...new Set(matches.map((match) => match.predictedKind))].sort(),
      meanFootprintIoUAllRuns: ratio(matches.reduce((sum, match) => sum + match.footprintIoU, 0), runs.length),
      minFootprintIoUAllRuns: runs.length ? Math.min(...matches.map((match) => match.footprintIoU), ...(matches.length < runs.length ? [0] : [])) : null,
      meanPairwisePredictionIoUWhenPresent: mean(pairwiseIoUs),
    };
  });
  const strictRecalls = evaluated.flatMap((run) => run.evaluation.detection.recall === null ? [] : [run.evaluation.detection.recall]);
  return {
    runCount: runs.length,
    summary: {
      meanDetectionRecall: mean(strictRecalls), minDetectionRecall: strictRecalls.length ? Math.min(...strictRecalls) : null,
      maxDetectionRecall: strictRecalls.length ? Math.max(...strictRecalls) : null,
      meanDetectionPrecision: mean(evaluated.flatMap((run) => run.evaluation.detection.precision === null ? [] : [run.evaluation.detection.precision])),
      meanFootprintIoUAllReferences: mean(evaluated.flatMap((run) => run.evaluation.localization.meanFootprintIoUAllReferences === null ? [] : [run.evaluation.localization.meanFootprintIoUAllReferences])),
      alwaysCorrectLocalizedReferenceIds: stability.filter((area) => area.correctLocalizedDetectionRate === 1).map((area) => area.referenceId),
      unstableReferenceIds: stability.filter((area) => area.spatialPresenceRate !== 1 || area.correctClassRate !== 1 || area.correctLocalizedDetectionRate !== 1).map((area) => area.referenceId),
    },
    stability, runs: evaluated,
  };
}
