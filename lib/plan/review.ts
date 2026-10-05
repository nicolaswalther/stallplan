import type { DetectedArea, Measurement, NormalizedBox } from "@/lib/types";
import { transformAreaFootprint } from "./area-geometry";

export type AreaGeometryGesture = "move" | "nw" | "ne" | "sw" | "se";
const MIN_AREA_SIZE = 0.01;
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

/** Resize against the opposite fixed corner, or translate without changing the size. */
export function transformAreaBox(box: NormalizedBox, gesture: AreaGeometryGesture, dx: number, dy: number): NormalizedBox {
  if (![dx, dy].every(Number.isFinite)) return box;
  const width = clamp(box.width, MIN_AREA_SIZE, 1), height = clamp(box.height, MIN_AREA_SIZE, 1);
  const base = { x: clamp(box.x, 0, 1 - width), y: clamp(box.y, 0, 1 - height), width, height };
  if (gesture === "move") return { ...base, x: clamp(base.x + dx, 0, 1 - width), y: clamp(base.y + dy, 0, 1 - height) };
  const right = base.x + width, bottom = base.y + height;
  const leftEdge = gesture === "nw" || gesture === "sw";
  const topEdge = gesture === "nw" || gesture === "ne";
  const x = leftEdge ? clamp(base.x + dx, 0, right - MIN_AREA_SIZE) : base.x;
  const y = topEdge ? clamp(base.y + dy, 0, bottom - MIN_AREA_SIZE) : base.y;
  const endX = leftEdge ? right : clamp(right + dx, base.x + MIN_AREA_SIZE, 1);
  const endY = topEdge ? bottom : clamp(bottom + dy, base.y + MIN_AREA_SIZE, 1);
  return { x, y, width: endX - x, height: endY - y };
}

export function applyAreaGeometryCorrection(area: DetectedArea, bbox: NormalizedBox): DetectedArea {
  if (![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)
    || bbox.x < 0 || bbox.y < 0 || bbox.width < MIN_AREA_SIZE - 1e-9 || bbox.height < MIN_AREA_SIZE - 1e-9
    || bbox.x + bbox.width > 1 + 1e-9 || bbox.y + bbox.height > 1 + 1e-9) return area;
  if (Math.abs(bbox.x - area.bbox.x) + Math.abs(bbox.y - area.bbox.y)
    + Math.abs(bbox.width - area.bbox.width) + Math.abs(bbox.height - area.bbox.height) < 1e-6) return area;
  const footprint = area.footprint ? transformAreaFootprint(area.footprint, area.bbox, bbox) : undefined;
  return { ...area, originalBbox: area.originalBbox ?? area.bbox, originalSource: area.originalSource ?? area.source,
    originalFootprint: area.originalFootprint ?? area.footprint,
    originalContourProvenance: area.originalContourProvenance ?? area.contourProvenance,
    footprint, contourProvenance: undefined,
    originalConfidence: area.originalConfidence !== undefined ? area.originalConfidence : area.confidence,
    bbox, hasBbox: true, source: "manual", confidence: null, boundaryAssessment: undefined,
    geometryCorrections: [...(area.geometryCorrections ?? []), { at: new Date().toISOString(), bbox, ...(footprint ? { footprint } : {}), source: "customer" }] };
}

/** Removed objects remain as tombstones so late analysis cannot recreate them. */
export function removeArea(area: DetectedArea, at = new Date().toISOString()): DetectedArea {
  return area.removedAt ? area : { ...area, status: "rejected", removedAt: at, removalPreviousStatus: area.status };
}

export function restoreArea(area: DetectedArea): DetectedArea {
  if (!area.removedAt) return area;
  const { removedAt: _at, removalPreviousStatus, ...rest } = area;
  void _at;
  return { ...rest, status: removalPreviousStatus ?? "unconfirmed" };
}

function center(box: NormalizedBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function sameMeasurement(a: Measurement, b: Measurement) {
  if (a.id === b.id) return true;
  if (a.pageNumber !== b.pageNumber) return false;
  if (a.textObjectId && b.textObjectId) return a.textObjectId === b.textObjectId;
  if (!a.bbox || !b.bbox) return false;
  const ac = center(a.bbox);
  const bc = center(b.bbox);
  const value = a.originalValue ?? a.value;
  return Math.abs(value - b.value) < Math.max(0.001, value * 0.002)
    && Math.hypot(ac.x - bc.x, ac.y - bc.y) < 0.012;
}

/** Fuse evidence without replacing a user's correction or repeated nearby dimensions. */
export function mergeMeasurements(base: Measurement[], incoming: Measurement[]) {
  const merged = [...base];
  for (const candidate of incoming) {
    const index = merged.findIndex((measurement) => sameMeasurement(measurement, candidate));
    if (index === -1) {
      merged.push(candidate);
      continue;
    }
    const current = merged[index];
    if (current.source === "customer" || current.status === "rejected") continue;
    merged[index] = {
      ...current,
      sources: [...new Set([...(current.sources ?? [current.source]), ...(candidate.sources ?? [candidate.source])])],
      bbox: current.bbox ?? candidate.bbox,
      evidence: candidate.evidence && !current.evidence.includes(candidate.evidence)
        ? [current.evidence, candidate.evidence].filter(Boolean).join(" · ") : current.evidence,
    };
  }
  return merged;
}

export function applyMeasurementCorrection(measurement: Measurement, value: number, unit: Measurement["unit"]): Measurement {
  if (!Number.isFinite(value) || value <= 0 || (value === measurement.value && unit === measurement.unit)) return measurement;
  return {
    ...measurement,
    originalValue: measurement.originalValue ?? measurement.value,
    originalUnit: measurement.originalUnit ?? measurement.unit,
    originalUnitInference: measurement.originalUnitInference ?? measurement.unitInference,
    value,
    unit,
    source: "customer",
    sources: [...new Set([...(measurement.sources ?? [measurement.source]), "customer"])],
    status: "confirmed",
    confidence: null,
    unitInference: { unit, confidence: unit === "unknown" ? 0 : 1, evidence: "Vom Nutzer korrigiert." },
    corrections: [...(measurement.corrections ?? []), { at: new Date().toISOString(), value, unit, source: "customer" }],
  };
}

export function needsMeasurementReview(measurement: Measurement) {
  return measurement.status !== "rejected" && (measurement.unit === "unknown"
    || (measurement.status !== "confirmed" && measurement.source !== "customer" && (measurement.confidence ?? 0) < 0.9));
}

function overlap(a: NormalizedBox, b: NormalizedBox) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / Math.max(0.000001, Math.min(a.width * a.height, b.width * b.height));
}

export function prepareArea(area: DetectedArea): DetectedArea {
  // A vision model's classification certainty is not evidence that its box
  // follows the room boundary. Keep AI geometry reviewable until independent
  // geometry validation exists, even when the model reports 0.97 confidence.
  return area.status === "unconfirmed" && area.source !== "ai" && area.kind !== "unknown" && area.hasBbox && (area.confidence ?? 0) >= 0.93
    ? { ...area, status: "confirmed" } : area;
}

/** Keep structural enclosures and reviewed/manual objects when optional semantic results arrive. */
export function mergeAreas(base: DetectedArea[], incoming: DetectedArea[]) {
  const merged = [...base];
  for (const proposal of incoming) {
    const candidate = prepareArea(proposal);
    // Deleted or manually corrected rooms keep the user's decision even when
    // a later model classifies the same footprint differently.
    // Symmetric IoU protects small real objects located inside a removed room.
    if (merged.some((current) => {
      if ((!current.removedAt && current.source !== "manual") || current.pageNumber !== candidate.pageNumber || !current.hasBbox || !candidate.hasBbox) return false;
      const intersection = Math.max(0, Math.min(current.bbox.x + current.bbox.width, candidate.bbox.x + candidate.bbox.width) - Math.max(current.bbox.x, candidate.bbox.x))
        * Math.max(0, Math.min(current.bbox.y + current.bbox.height, candidate.bbox.y + candidate.bbox.height) - Math.max(current.bbox.y, candidate.bbox.y));
      const union = current.bbox.width * current.bbox.height + candidate.bbox.width * candidate.bbox.height - intersection;
      return current.id === candidate.id || union > 0 && intersection / union >= 0.65;
    })) continue;
    const index = merged.findIndex((current) => current.id === candidate.id
      || (current.pageNumber === candidate.pageNumber && current.kind === candidate.kind
        && current.hasBbox && candidate.hasBbox && overlap(current.bbox, candidate.bbox) >= 0.65));
    if (index === -1) merged.push(candidate);
    else {
      const current = merged[index];
      if (current.source === "manual" || current.status !== "unconfirmed") continue;
      merged[index] = { ...current, evidence: [...new Set([...current.evidence, ...candidate.evidence])] };
    }
  }
  return merged;
}
