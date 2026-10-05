import type { LengthUnit, PdfPageData, UnitInference } from "../types";
import type { LineAssociation } from "../geometry/dimension-lines";

export const MM_PER_UNIT: Record<Exclude<LengthUnit, "unknown">, number> = { mm: 1, cm: 10, m: 1000 };
export interface UnitCandidate { value: number; associations: LineAssociation[]; explicitUnit?: LengthUnit }
export function drawingScale(page: PdfPageData): number | null {
  const scales = [...page.text.matchAll(/\b1\s*:\s*(\d{1,4})(?!\d)/g)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 2000);
  return new Set(scales).size === 1 ? scales[0] : null;
}
export function scaleAgreement(length: number, value: number, unit: Exclude<LengthUnit, "unknown">, scale: number): number {
  const expected = value * MM_PER_UNIT[unit] / scale * 72 / 25.4;
  const error = Math.abs(length - expected);
  // Small dimension segments are quantized; large ones must agree proportionally.
  return Math.max(0, 1 - error / Math.max(0.85, expected * 0.045));
}

/** Printed scale alone does not establish a unit. Require several independent line/value matches. */
export function inferDrawingUnit(page: PdfPageData, candidates: UnitCandidate[]): UnitInference {
  const annotations = [...page.text.matchAll(/(?:ma(?:ß|ss)e?|dimensions?|wymiary|units?)\s*(?:in|w|:|=)?\s*(mm|cm|m)\b/gi)];
  const annotationUnits = new Set(annotations.map((match) => match[1].toLowerCase()));
  if (annotationUnits.size > 1) return { unit: "unknown", confidence: 0, evidence: "Widersprüchliche Zeichnungsangaben zu Längeneinheiten." };
  if (annotations.length) return { unit: annotations[0][1].toLowerCase() as LengthUnit, confidence: 0.97, evidence: `Zeichnungsangabe: „${annotations[0][0]}“.` };
  const scale = drawingScale(page);
  if (scale) {
    const votes = Object.entries(MM_PER_UNIT).map(([unit]) => {
      const typedUnit = unit as Exclude<LengthUnit, "unknown">;
      const support = candidates.filter((candidate) => candidate.value >= 30 && (!candidate.explicitUnit || candidate.explicitUnit === typedUnit) && candidate.associations.some((a) => a.centered > 0.6 && scaleAgreement(a.line.length, candidate.value, typedUnit, scale) >= 0.65));
      return { unit: typedUnit, count: support.length, support };
    }).sort((a, b) => b.count - a.count);
    if (votes[0].count >= 3 && votes[0].count >= votes[1].count * 3) {
      return { unit: votes[0].unit, confidence: Math.min(0.99, 0.9 + votes[0].count * 0.004), evidence: `Maßstab 1:${scale}; ${votes[0].count} Maßtext-/Vektorstrecken stimmen mit ${votes[0].unit} überein.` };
    }
  }
  const units = candidates.filter((c) => c.explicitUnit && c.explicitUnit !== "unknown" && c.associations.some((a) => a.centered > 0.65));
  const counts = Object.keys(MM_PER_UNIT).map((unit) => ({ unit, count: units.filter((c) => c.explicitUnit === unit).length })).sort((a, b) => b.count - a.count);
  if (counts[0].count >= 3 && counts[1].count === 0) return { unit: counts[0].unit as LengthUnit, confidence: 0.9, evidence: `${counts[0].count} explizit bemaßte Vektorstrecken verwenden ${counts[0].unit}.` };
  return { unit: "unknown", confidence: 0, evidence: "Keine ausreichend belegte Zeichnungseinheit; Zahlen bleiben unkonvertiert." };
}
