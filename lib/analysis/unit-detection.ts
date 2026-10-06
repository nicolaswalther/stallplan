import type { LengthUnit, PdfPageData, PdfTextItem, UnitInference } from "../types";
import type { LineAssociation } from "../geometry/dimension-lines";

export const MM_PER_UNIT: Record<Exclude<LengthUnit, "unknown">, number> = { mm: 1, cm: 10, m: 1000 };
export interface UnitCandidate { value: number; associations: LineAssociation[]; explicitUnit?: LengthUnit; item?: PdfTextItem }
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

/** Independent native rails establish which notations occur on this page.
 * A drawing can use 5,00 metres and 20 centimetres in the very same chain.
 * Repeating a label beside one long wall must not supply several unit votes.
 */
export function supportedScaleUnits(page: PdfPageData, candidates: UnitCandidate[]): Array<{ unit: Exclude<LengthUnit, "unknown">; count: number }> {
  const scale = drawingScale(page);
  if (!scale) return [];
  return Object.keys(MM_PER_UNIT).map((unit) => {
    const typedUnit = unit as Exclude<LengthUnit, "unknown">;
    const rails = new Set<string>();
    let count = 0;
    for (const candidate of candidates) {
      if (candidate.explicitUnit && candidate.explicitUnit !== typedUnit) continue;
      const font = candidate.item?.fontSize ?? 0;
      const best = candidate.associations.filter((a) => a.centered > .6 && a.line.length >= Math.max(4, font * .5)
        && scaleAgreement(a.line.length, candidate.value, typedUnit, scale) >= .65)
        .sort((a, b) => scaleAgreement(b.line.length, candidate.value, typedUnit, scale) - scaleAgreement(a.line.length, candidate.value, typedUnit, scale))[0];
      if (!best) continue;
      const id = best.line.sourceLineIds?.[0] ?? best.line.source.id;
      if (rails.has(id)) continue;
      rails.add(id); count++;
    }
    return { unit: typedUnit, count };
  }).sort((a, b) => b.count - a.count);
}

export function drawingUnitDeclaration(page: PdfPageData): UnitInference | null {
  const annotations = [...page.text.matchAll(/(?:ma(?:ß|ss)e?|dimensions?|wymiary|units?)\s*(?:in|w|:|=)?\s*(mm|cm|m)\b/gi),
    // The accompanying Latvian height note uses metres; it does not change
    // the explicitly declared millimetre dimension chains.
    ...page.text.matchAll(/(?:mērķēdes|izmēri)[^.;]{0,80}?(?:milimetros|centimetros|metros)\s*\((mm|cm|m)\)/gi)];
  const annotationUnits = new Set(annotations.map((match) => match[1].toLowerCase()));
  if (annotationUnits.size > 1) return { unit: "unknown", confidence: 0, evidence: "Widersprüchliche Zeichnungsangaben zu Längeneinheiten." };
  if (annotations.length) return { unit: annotations[0][1].toLowerCase() as LengthUnit, confidence: 0.97, evidence: `Zeichnungsangabe: „${annotations[0][0]}“.` };
  return null;
}

/** Printed scale alone does not establish a unit. Require several independent line/value matches. */
export function inferDrawingUnit(page: PdfPageData, candidates: UnitCandidate[]): UnitInference {
  const declaration = drawingUnitDeclaration(page);
  if (declaration) return declaration;
  const scale = drawingScale(page);
  if (scale) {
    const votes = supportedScaleUnits(page, candidates);
    if (votes.filter((vote) => vote.count >= 3).length > 1) return { unit: "unknown", confidence: 0,
      evidence: "Mehrere Längeneinheiten sind durch unabhängige Maßtext-/Vektorstrecken belegt; die Einheit wird je Maß bestimmt." };
    if (votes[0].count >= 3 && votes[0].count >= votes[1].count * 3) {
      return { unit: votes[0].unit, confidence: Math.min(0.99, 0.9 + votes[0].count * 0.004), evidence: `Maßstab 1:${scale}; ${votes[0].count} Maßtext-/Vektorstrecken stimmen mit ${votes[0].unit} überein.` };
    }
  }
  const units = candidates.filter((c) => c.explicitUnit && c.explicitUnit !== "unknown" && c.associations.some((a) => a.centered > 0.65));
  const counts = Object.keys(MM_PER_UNIT).map((unit) => ({ unit, count: units.filter((c) => c.explicitUnit === unit).length })).sort((a, b) => b.count - a.count);
  if (counts[0].count >= 3 && counts[1].count === 0) return { unit: counts[0].unit as LengthUnit, confidence: 0.9, evidence: `${counts[0].count} explizit bemaßte Vektorstrecken verwenden ${counts[0].unit}.` };
  return { unit: "unknown", confidence: 0, evidence: "Keine ausreichend belegte Zeichnungseinheit; Zahlen bleiben unkonvertiert." };
}
