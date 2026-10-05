import type { DetectedArea } from "../types";
import { isValidAreaFootprint } from "./area-geometry";

/** Geometry evidence and semantic confidence are intentionally separate gates. */
export function areaReviewReason(area: DetectedArea): string | undefined {
  if (area.status !== "unconfirmed") return;
  if (!area.hasBbox) return "Position im Plan ergänzen";
  if (area.kind === "unknown") return "Bereichstyp auswählen";
  if (area.geometryCorrections?.length || area.source === "manual") return;
  if ((area.confidence ?? 0) < 0.8) return "Nutzung kurz prüfen";
  if (area.contourProvenance?.modelBoxConflict) return "Zuordnung zur Raumnummer kurz prüfen";
  if (area.contourProvenance && isValidAreaFootprint(area.footprint)) return;
  if (area.kind === "alley") return "Verlauf des gesamten Gangs prüfen";
  if (!area.boundaryAssessment || area.boundaryAssessment.supportedSides.length < 4) return "Umrandung kurz prüfen";
}

export function canAcceptAreaTogether(area: DetectedArea): boolean {
  return area.status === "unconfirmed" && !areaReviewReason(area);
}
