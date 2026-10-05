import type { Measurement, PlanPoint } from "../types";

export interface StructureReference {
  measurements: Array<{ id: string; role: string; page: number; dimensionLine?: { start: number[]; end: number[] } }>;
  dimensionChains: Array<{ id: string; measurementIds: string[] }>;
  document: { pages: Array<{ page: number; widthPoints: number; heightPoints: number }> };
}

/** Evaluate only reviewed relations; unannotated geometry is not ground truth. */
export function evaluateStructure(actual: Measurement[], reference: StructureReference,
  matches: Array<{ measurementId: string; referenceId: string }>) {
  const byId = new Map(actual.map((item) => [item.id, item]));
  const matched = new Map(matches.map((pair) => [pair.referenceId, byId.get(pair.measurementId)!]));
  const expectedKind = (role: string) => role === "plan-dimension" ? "plan-length" : role;
  const rolesCorrect = reference.measurements.filter((item) => matched.get(item.id)?.kind === expectedKind(item.role)).length;
  const endpointErrors: number[] = [];
  for (const item of reference.measurements.filter((item) => item.dimensionLine)) {
    const measurement = matched.get(item.id);
    const page = reference.document.pages.find((page) => page.page === item.page);
    if (!measurement?.dimensionLine || !page) continue;
    const error = (point: PlanPoint, expected: number[]) => Math.hypot((point.x - expected[0]) * page.widthPoints, (point.y - expected[1]) * page.heightPoints);
    const line = measurement.dimensionLine;
    const truth = item.dimensionLine!;
    endpointErrors.push(Math.min(Math.max(error(line.start, truth.start), error(line.end, truth.end)),
      Math.max(error(line.start, truth.end), error(line.end, truth.start))));
  }
  const membership = new Map<string, string>();
  for (const chain of reference.dimensionChains) for (const id of chain.measurementIds) membership.set(id, chain.id);
  const reviewedIds = [...membership.keys()];
  let correctPairs = 0, expectedPairs = 0, predictedPairs = 0;
  for (let i = 0; i < reviewedIds.length; i++) for (let j = i + 1; j < reviewedIds.length; j++) {
    const a = reviewedIds[i], b = reviewedIds[j];
    const expectedSame = membership.get(a) === membership.get(b);
    const predictedSame = !!matched.get(a)?.chainId && matched.get(a)?.chainId === matched.get(b)?.chainId;
    if (expectedSame) expectedPairs++;
    if (predictedSame) predictedPairs++;
    if (expectedSame && predictedSame) correctPairs++;
  }
  return {
    roleAccuracy: reference.measurements.length ? rolesCorrect / reference.measurements.length : null,
    annotatedLineCount: reference.measurements.filter((item) => item.dimensionLine).length,
    matchedLineCount: endpointErrors.length,
    maxAnnotatedLineEndpointErrorPoints: endpointErrors.length ? Math.max(...endpointErrors) : null,
    dimensionChainPairPrecision: predictedPairs ? correctPairs / predictedPairs : null,
    dimensionChainPairRecall: expectedPairs ? correctPairs / expectedPairs : null,
    correctChainPairs: correctPairs, expectedChainPairs: expectedPairs, predictedChainPairs: predictedPairs,
  };
}
