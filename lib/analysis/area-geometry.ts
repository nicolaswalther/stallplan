import type { DetectedArea, PdfPageData } from "../types";
import { classifyUnambiguousAreaLabel } from "./areas";
import { detectRoomContours, type RoomContourCandidate } from "../geometry/room-contours";

const cache = new WeakMap<PdfPageData, RoomContourCandidate[]>();
const ROOM_KINDS = new Set(["feeding_area", "cubicles", "alley", "calving", "pens", "isolation"]);
function roomNumber(area: DetectedArea) {
  return (area.originalLabel ?? "").match(/^\s*(?:(?:raum|room|nr\.?|pomieszczenie)\s*)?([1-9]\d{0,2})\s*[.)–—:]\s*/i)?.[1];
}

/** A native number does not classify a room. Link a literal numbered functional
 * label to one unique, enclosed vector component; never link adjacent equipment.
 */
export function applyVectorRoomContours(areas: DetectedArea[], pages: PdfPageData[]): DetectedArea[] {
  const identifiers = new Map<string, number>();
  for (const area of areas) {
    const number = roomNumber(area);
    if (area.status === "rejected" || !number || !ROOM_KINDS.has(area.kind)) continue;
    const key = `${area.pageNumber}:${number}`;
    identifiers.set(key, (identifiers.get(key) ?? 0) + 1);
  }
  return areas.map((area) => {
    if (!ROOM_KINDS.has(area.kind) || area.source === "manual" || area.status === "rejected" || area.geometryCorrections?.length || area.contourProvenance) return area;
    const label = area.originalLabel ?? "";
    const number = roomNumber(area);
    if (!number || identifiers.get(`${area.pageNumber}:${number}`) !== 1 || classifyUnambiguousAreaLabel(label) !== area.kind) return area;
    const page = pages.find((candidate) => candidate.pageNumber === area.pageNumber);
    if (!page || page.documentKind === "raster" || !page.lines?.length) return area;
    let candidates = cache.get(page);
    if (!candidates) { candidates = detectRoomContours(page); cache.set(page, candidates); }
    const contour = candidates.find((candidate) => candidate.anchor.number === number);
    if (!contour) return area;
    const cx = contour.anchor.bbox.x + contour.anchor.bbox.width / 2;
    const cy = contour.anchor.bbox.y + contour.anchor.bbox.height / 2;
    const modelBoxConflict = !area.hasBbox || cx < area.bbox.x || cy < area.bbox.y || cx > area.bbox.x + area.bbox.width || cy > area.bbox.y + area.bbox.height;
    // A clearly read room-table identifier can be more reliable than an
    // estimated image box. Require the independently extracted detail image
    // and a strong semantic result; preserve this disagreement for review.
    // Without this second document signal, a remote model box stays untouched.
    if (modelBoxConflict && ((area.confidence ?? 0) < 0.9 || !page.semanticDetails?.some((detail) => detail.kind === "outline-text"))) return area;
    return { ...area, bbox: contour.bbox, hasBbox: true, footprint: contour.footprint,
      originalBbox: area.originalBbox ?? area.bbox,
      contourProvenance: { method: contour.method, roomNumber: number, textItemId: contour.anchor.textItemId,
        sourceLineIds: contour.sourceLineIds, resolutionPoints: contour.resolutionPoints,
        ...(modelBoxConflict ? { modelBoxConflict: true } : {}) },
      evidence: [...area.evidence, `Raum ${number}: zusammenhängende Vektorfläche mit genau einem direkten PDF-Raumkennzeichen; Aussparungen erhalten.`,
        ...(modelBoxConflict ? ["Abweichende KI-Position anhand der gelesenen Raumnummer und PDF-Kontur korrigiert; Zuordnung kurz prüfen."] : [])] };
  });
}
