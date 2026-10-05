import type { LengthUnit, Measurement, NormalizedBox } from "../types";

export interface ReferenceMeasurement {
  id: string;
  value: number;
  unit: LengthUnit;
  pageNumber: number;
  bbox: NormalizedBox;
  chainId?: string;
}

function centerDistance(a: NormalizedBox, b: NormalizedBox) {
  return Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2);
}

export function boxIoU(a: NormalizedBox, b: NormalizedBox) {
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

/** One-to-one, position-aware matching keeps repeated module values distinct.
 * Match the location and number before evaluating unit accuracy, so wrong units
 * cannot disappear from the denominator. Tolerance uses normalized page units.
 */
export function evaluateMeasurements(
  actual: Measurement[],
  expected: ReferenceMeasurement[],
  tolerance = 0.008,
) {
  const candidates = actual.filter((item) => item.status !== "rejected");
  const edges = expected.map((reference) => candidates
    .map((measurement, index) => ({ measurement, index }))
    .filter(({ measurement }) => measurement.pageNumber === reference.pageNumber && measurement.bbox &&
      Math.abs(measurement.value - reference.value) <= Math.max(0.001, Math.abs(reference.value) * 0.0001) &&
      centerDistance(measurement.bbox, reference.bbox) <= tolerance)
    .sort((a, b) => centerDistance(a.measurement.bbox!, reference.bbox) - centerDistance(b.measurement.bbox!, reference.bbox))
    .map(({ index }) => index));
  const assignment = new Map<number, number>();
  function assign(referenceIndex: number, visited: Set<number>): boolean {
    for (const candidateIndex of edges[referenceIndex]) {
      if (visited.has(candidateIndex)) continue;
      visited.add(candidateIndex);
      const previous = assignment.get(candidateIndex);
      if (previous === undefined || assign(previous, visited)) {
        assignment.set(candidateIndex, referenceIndex);
        return true;
      }
    }
    return false;
  }
  expected.forEach((_, index) => assign(index, new Set()));
  const matches = [...assignment].map(([actualIndex, referenceIndex]) => ({
    measurement: candidates[actualIndex], reference: expected[referenceIndex],
  }));
  const matchedReferences = new Set(matches.map(({ reference }) => reference.id));
  const correctUnits = matches.filter(({ measurement, reference }) => measurement.unit === reference.unit).length;
  return {
    expectedCount: expected.length,
    detectedCount: candidates.length,
    correctValueAndPositionCount: matches.length,
    measurementPrecision: candidates.length ? matches.length / candidates.length : null,
    measurementRecall: expected.length ? matches.length / expected.length : null,
    unitAccuracy: matches.length ? correctUnits / matches.length : null,
    meanBoxIoU: matches.length ? matches.reduce((sum, { measurement, reference }) => sum + boxIoU(measurement.bbox!, reference.bbox), 0) / matches.length : null,
    manualCorrectionRate: candidates.length ? candidates.filter((item) => item.source === "customer").length / candidates.length : null,
    matches: matches.map(({ measurement, reference }) => ({ measurementId: measurement.id, referenceId: reference.id })),
    missing: expected.filter((reference) => !matchedReferences.has(reference.id)),
    falsePositives: candidates.filter((_, index) => !assignment.has(index)),
    wrongUnits: matches.filter(({ measurement, reference }) => measurement.unit !== reference.unit),
  };
}
