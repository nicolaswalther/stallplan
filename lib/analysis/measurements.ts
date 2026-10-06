import type { LengthUnit, Measurement, PdfPageData, PdfTextItem } from "../types";
import { axisOf, endpointSupport, indexAxisLines, nearbyDimensionLines, type LineAssociation } from "../geometry/dimension-lines";
import { drawingScale, drawingUnitDeclaration, inferDrawingUnit, scaleAgreement, supportedScaleUnits } from "./unit-detection";
import { detectOpeningAnnotations } from "../geometry/opening-annotations";

interface Candidate { inlineUnit?: boolean; item: PdfTextItem; value: number; explicitUnit?: LengthUnit; associations: LineAssociation[]; chainSupport: number; chainId?: string }
const numberWithUnit = /^(\d{1,6}(?:[.,]\d{1,3})?)\s*(mm|cm|m)?$/i;
const excludedContext = /(?:djp|m[²³]|m\s*[23]\b|n\.?\s*p\.?\s*m\.?|volum|kubatur|pojemno|\bpoj\.|obsada|h\s*=|höhe|höhen|datum|gelände|kote|ü\.\s*n|\bnn\b|\bnhn\b)/i;
function valueOf(text: string, unit?: LengthUnit): number {
  if (unit === "mm" && /^\d{1,3}\.\d{3}$/.test(text)) return Number(text.replace(".", ""));
  return Number(text.replace(",", "."));
}

function isUnitExponent(exponent: PdfTextItem, base: PdfTextItem, page: PdfPageData): boolean {
  if (!/^[²³23]$/.test(exponent.text) || !/(?:\d[\d.,]*\s*(?:mm|cm|m)|^(?:mm|cm|m))\s*$/i.test(base.text)) return false;
  const font = base.fontSize ?? Math.min(base.bbox.width * page.width, base.bbox.height * page.height);
  const exponentFont = exponent.fontSize ?? Math.min(exponent.bbox.width * page.width, exponent.bbox.height * page.height);
  if (!(font > 0) || exponentFont >= font * .85 || axisOf(exponent) !== axisOf(base)) return false;
  const angle = (base.orientation ?? (axisOf(base) === "vertical" ? -90 : 0)) * Math.PI / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const along = (item: PdfTextItem) => {
    const box = item.bbox;
    const values = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
      .map(([x, y]) => x * page.width * direction.x + y * page.height * direction.y);
    return { start: Math.min(...values), end: Math.max(...values) };
  };
  const a = along(base), b = along(exponent), gap = b.start - a.end;
  if (base.baseline && exponent.baseline) {
    // Some PDF font advance boxes overlap their following superscript. Native
    // baseline displacement still distinguishes an exponent from nearby text.
    const dx = (exponent.baseline.x - base.baseline.x) * page.width;
    const dy = (exponent.baseline.y - base.baseline.y) * page.height;
    const raised = dx * direction.y - dy * direction.x;
    return gap >= -(a.end - a.start) * .4 && gap <= font * .9 && raised >= font * .12 && raised <= font * .9;
  }
  if (gap <= -font * .35 || gap >= font * .9) return false;
  if (axisOf(base) === "horizontal") {
    const dy = (exponent.bbox.y - base.bbox.y) * page.height;
    return dy > -font * .8 && dy < font * .35;
  }
  return Math.abs((exponent.bbox.x - base.bbox.x) * page.width) < font;
}

function nonLengthContext(item: PdfTextItem, page: PdfPageData): boolean {
  if (excludedContext.test(item.text)) return true;
  // Architectural room labels often stack 04 / ROOM NAME / floor / area.
  // A zero-padded ID is excluded only with this native label+area context;
  // explicitly unit-bearing lengths and ordinary numbers are unaffected.
  if (/^0\d{1,2}$/.test(item.text)) {
    const font = item.fontSize ?? Math.min(item.bbox.width * page.width, item.bbox.height * page.height);
    const center = (item.bbox.x + item.bbox.width / 2) * page.width;
    const below = (other: PdfTextItem) => (other.bbox.y - item.bbox.y) * page.height;
    const aligned = (other: PdfTextItem) => Math.abs((other.bbox.x + other.bbox.width / 2) * page.width - center) < font * 3;
    const roomName = page.textItems.some((other) => other !== item && aligned(other) && below(other) > font * .5 && below(other) < font * 2.5
      && /^[\p{L}\s.-]{4,}$/u.test(other.text.trim()));
    const roomArea = page.textItems.some((other) => other !== item && aligned(other) && below(other) > font * 2 && below(other) < font * 6
      && (/\d.*m[²2]/i.test(other.text) || /\d.*m\s*$/i.test(other.text) && page.textItems.some((exponent) => isUnitExponent(exponent, other, page))));
    if (roomName && roomArea) return true;
  }
  if (/^[²³23]$/.test(item.text) && page.textItems.some((other) => other !== item && isUnitExponent(item, other, page))) return true;
  const box = item.bbox;
  const nearby = page.textItems.filter((other) => {
    if (other === item) return false;
    const dx = Math.max(box.x, other.bbox.x) - Math.min(box.x + box.width, other.bbox.x + other.bbox.width);
    const dy = Math.max(box.y, other.bbox.y) - Math.min(box.y + box.height, other.bbox.y + other.bbox.height);
    return dx * page.width < 12 && dy * page.height < 3;
  });
  if (nearby.some((other) => excludedContext.test(other.text))) return true;
  // PDF superscripts are frequently separate text objects ("9 m" + "3").
  if (/m\s*$/i.test(item.text) && page.textItems.some((other) => other !== item && isUnitExponent(other, item, page))) return true;
  // Elevation labels are often split into a sign and an unsigned decimal.
  return /^\d+[.,]\d+$/.test(item.text) && nearby.some((other) => /^[+−-]$/.test(other.text));
}
function splitNumericItems(item: PdfTextItem): PdfTextItem[] {
  if (numberWithUnit.test(item.text)) return [item];
  if (!/^\d+(?:[.,]\d+)?(?:\s+\d+(?:[.,]\d+)?)+$/.test(item.text)) return [];
  const axis = axisOf(item), total = item.text.length;
  return [...item.text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m, index) => {
    const offset = (m.index ?? 0) / total, fraction = m[0].length / total;
    const angle = (item.orientation ?? (axis === "vertical" ? -90 : 0)) * Math.PI / 180;
    const reversed = axis === "vertical" ? Math.sin(angle) < 0 : Math.cos(angle) < 0;
    return { ...item, id: `${item.id ?? "text"}-split-${index}`, text: m[0], bbox: axis === "horizontal"
      ? { ...item.bbox, x: item.bbox.x + item.bbox.width * (reversed ? 1 - offset - fraction : offset), width: item.bbox.width * fraction }
      : { ...item.bbox, y: item.bbox.y + item.bbox.height * (reversed ? 1 - offset - fraction : offset), height: item.bbox.height * fraction } };
  });
}
function associateInlineUnit(item: PdfTextItem, page: PdfPageData): PdfTextItem {
  if (!/^\d{1,6}(?:[.,]\d{1,3})?$/.test(item.text)) return item;
  const axis = axisOf(item), font = item.fontSize ?? Math.min(item.bbox.width * page.width, item.bbox.height * page.height);
  const angle = (item.orientation ?? (axis === "vertical" ? -90 : 0)) * Math.PI / 180;
  const forward = axis === "horizontal" ? Math.cos(angle) >= 0 : Math.sin(angle) >= 0;
  const matches = page.textItems.filter((other) => {
    if (!/^(mm|cm|m)$/i.test(other.text) || axisOf(other) !== axis || Math.abs((other.fontSize ?? font) - font) > font * 0.15) return false;
    const a = item.bbox, b = other.bbox;
    const gap = axis === "horizontal"
      ? (forward ? b.x - a.x - a.width : a.x - b.x - b.width) * page.width
      : (forward ? b.y - a.y - a.height : a.y - b.y - b.height) * page.height;
    const cross = axis === "horizontal" ? (b.y + b.height / 2 - a.y - a.height / 2) * page.height : (b.x + b.width / 2 - a.x - a.width / 2) * page.width;
    return gap >= -0.5 && gap <= font * 0.65 && Math.abs(cross) <= font * 0.2;
  });
  if (matches.length !== 1) return item;
  const other = matches[0], x = Math.min(item.bbox.x, other.bbox.x), y = Math.min(item.bbox.y, other.bbox.y);
  return { ...item, text: `${item.text} ${other.text}`, bbox: { x, y,
    width: Math.max(item.bbox.x + item.bbox.width, other.bbox.x + other.bbox.width) - x,
    height: Math.max(item.bbox.y + item.bbox.height, other.bbox.y + other.bbox.height) - y } };
}

function classifyCandidates(page: PdfPageData): Candidate[] {
  const lines = indexAxisLines(page);
  const candidates: Candidate[] = page.textItems.flatMap(splitNumericItems).flatMap((rawItem) => {
    const item = associateInlineUnit(rawItem, page);
    const match = item.text.match(numberWithUnit);
    if (!match || nonLengthContext(item, page)) return [];
    const explicitUnit = match[2]?.toLowerCase() as LengthUnit | undefined;
    const value = valueOf(match[1], explicitUnit);
    if (!Number.isFinite(value) || value <= 0) return [];
    return [{ item, inlineUnit: item !== rawItem, value, explicitUnit, associations: nearbyDimensionLines(item, page, lines), chainSupport: 0 }];
  });
  const axisIdentifiers = detectAxisIdentifiers(candidates, page);
  return candidates.filter((candidate) => !axisIdentifiers.has(candidate));
}

/** Consecutive aligned labels are axis identifiers when native typography is
 * larger than dimension text, or the printed scale contradicts every unit.
 * Repeated modules and ordinary, scale-consistent 1/2/3 dimensions remain valid.
 */
function detectAxisIdentifiers(candidates: Candidate[], page: PdfPageData): Set<Candidate> {
  const result = new Set<Candidate>();
  const integers = candidates.filter((c) => !c.explicitUnit && /^\d{1,3}$/.test(c.item.text) && c.value < 1000);
  const decimalFonts = candidates.filter((c) => /^\d+[.,]\d+$/.test(c.item.text) && (c.item.fontSize ?? 0) > 0)
    .map((c) => c.item.fontSize!).sort((a, b) => a - b);
  const dimensionFont = decimalFonts.length ? decimalFonts[Math.floor(decimalFonts.length / 2)] : undefined;
  const scale = drawingScale(page);
  for (const horizontal of [true, false]) {
    const groups: Array<{ cross: number; font: number; members: Candidate[] }> = [];
    for (const candidate of integers) {
      const b = candidate.item.bbox;
      const cross = horizontal ? (b.y + b.height / 2) * page.height : (b.x + b.width / 2) * page.width;
      const font = candidate.item.fontSize ?? Math.min(b.width * page.width, b.height * page.height);
      const group = groups.find((g) => Math.abs(g.cross - cross) <= Math.max(1, font * .55) && Math.abs(g.font - font) <= Math.max(.2, font * .15));
      if (group) group.members.push(candidate); else groups.push({ cross, font, members: [candidate] });
    }
    for (const group of groups) {
      if (group.members.length < 4) continue;
      const along = (c: Candidate) => horizontal ? (c.item.bbox.x + c.item.bbox.width / 2) * page.width : (c.item.bbox.y + c.item.bbox.height / 2) * page.height;
      const ordered = group.members.sort((a, b) => along(a) - along(b));
      let start = 0;
      while (start < ordered.length - 3) {
        const direction = ordered[start + 1].value - ordered[start].value;
        if (Math.abs(direction) !== 1) { start++; continue; }
        let end = start + 2;
        while (end < ordered.length && ordered[end].value - ordered[end - 1].value === direction) end++;
        const run = ordered.slice(start, end);
        if (run.length >= 4) {
          const gaps = run.slice(1).map((c, i) => along(c) - along(run[i])).sort((a, b) => a - b);
          const typicalGap = gaps[Math.floor(gaps.length / 2)];
          const regular = typicalGap > group.font && gaps.every((gap) => gap <= typicalGap * 2.5);
          const larger = dimensionFont != null && group.font >= dimensionFont * 1.3;
          const contradictory = scale != null && run.every((c) => !c.associations.some((a) => a.line.length >= group.font * .5
            && ["mm", "cm", "m"].some((u) => scaleAgreement(a.line.length, c.value, u as Exclude<LengthUnit, "unknown">, scale) >= .55)));
          const measuredRun = scale != null && ["mm", "cm", "m"].some((u) => {
            const rails = new Set<string>();
            return run.every((candidate) => {
              const actual = candidate.associations.find((a) => a.centered >= .7 && a.line.length >= group.font * .5
                && scaleAgreement(a.line.length, candidate.value, u as Exclude<LengthUnit, "unknown">, scale) >= .8
                && endpointSupport(a.line, page) === 2 && !rails.has(a.line.sourceLineIds?.[0] ?? a.line.source.id));
              if (!actual) return false;
              rails.add(actual.line.sourceLineIds?.[0] ?? actual.line.source.id); return true;
            });
          });
          if (regular && !measuredRun && (larger || contradictory)) for (const candidate of run) result.add(candidate);
        }
        start = end - 1;
      }
    }
  }
  return result;
}

function assignChains(candidates: Candidate[], page: PdfPageData, unit: LengthUnit, supportCache: Map<string, number>, localUnits: (candidate: Candidate) => Exclude<LengthUnit, "unknown">[]) {
  const supported = candidates.flatMap((candidate) => {
    const selected = selectAssociation(candidate, page, candidate.explicitUnit ?? unit, supportCache, localUnits(candidate));
    if (!selected || (selected.agreement < 0.55 && !(selected.association.endpointSupport === 2 && selected.association.centered > 0.55))) return [];
    return [{ candidate, line: selected.association.line }];
  }).sort((a, b) => a.line.axis.localeCompare(b.line.axis) || a.line.cross - b.line.cross || a.line.from - b.line.from);
  const groups: typeof supported[] = [];
  for (const member of supported) {
    const group = groups.find((g) => {
      const first = g[0].line;
      if (first.axis !== member.line.axis || Math.abs(first.cross - member.line.cross) > 0.65) return false;
      return g.some(({ line }) => Math.abs(line.to - member.line.from) < 1.5 || Math.abs(member.line.to - line.from) < 1.5);
    });
    if (group) group.push(member); else groups.push([member]);
  }
  groups.forEach((group, index) => {
    if (group.length < 2) return;
    for (const { candidate } of group) { candidate.chainSupport = Math.min(1, 0.6 + group.length * 0.08); candidate.chainId = `chain-${page.pageNumber}-${index + 1}`; }
  });
}

function selectAssociation(candidate: Candidate, page: PdfPageData, unit: LengthUnit, supportCache: Map<string, number>, localUnits: Exclude<LengthUnit, "unknown">[]): { association: LineAssociation; agreement: number; unit: LengthUnit } | null {
  const scale = drawingScale(page);
  const font = candidate.item.fontSize ?? Math.min(candidate.item.bbox.width * page.width, candidate.item.bbox.height * page.height);
  const ranked = candidate.associations.filter((association) => {
    // Letter strokes can have two nearby crossings just like a dimension rail.
    // A sub-glyph span is insufficient geometric evidence by itself. Genuine
    // short wall dimensions remain eligible when independent scale/unit data
    // proves their physical length (for example 6 cm on a 1:100 drawing).
    if (association.line.length >= Math.max(1, font * .5)) return true;
    return !!scale && (unit !== "unknown" ? scaleAgreement(association.line.length, candidate.value, unit, scale) >= .65
      : localUnits.some((u) => scaleAgreement(association.line.length, candidate.value, u, scale) >= .65));
  }).map((a) => {
    const alternatives = unit === "unknown" ? localUnits : [unit];
    const agreements = scale ? alternatives.map((u) => ({ unit: u, agreement: scaleAgreement(a.line.length, candidate.value, u, scale) })).sort((x, y) => y.agreement - x.agreement) : [];
    const agreement = agreements[0]?.agreement ?? 0;
    const selectedUnit: LengthUnit = unit !== "unknown" ? unit : agreement >= .65 ? agreements[0].unit : "unknown";
    const support = supportCache.get(a.line.source.id) ?? endpointSupport(a.line, page);
    supportCache.set(a.line.source.id, support);
    return { association: { ...a, endpointSupport: support }, agreement, unit: selectedUnit,
      score: agreement * 1.8 + a.score * 0.55 + support * 0.2 };
  }).sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

export function analyzeMeasurements(page: PdfPageData): Measurement[] {
  const candidates = classifyCandidates(page);
  const inferredUnit = inferDrawingUnit(page, candidates);
  const declaration = drawingUnitDeclaration(page);
  // A mixed-notation sheet can use decimal metres and integer centimetres.
  // Otherwise a tiny device stroke can appear to prove "4,00 cm" merely
  // because unrelated integer wall dimensions established centimetres.
  const notationUnits = (decimal: boolean) => declaration?.unit === "unknown" ? []
    : supportedScaleUnits(page, candidates.filter((candidate) => /[.,]/.test(candidate.item.text) === decimal))
      .filter((item) => item.count >= 3).map((item) => item.unit);
  const decimalUnits = notationUnits(true), integerUnits = notationUnits(false);
  const localUnits = (candidate: Candidate) => /[.,]/.test(candidate.item.text) ? decimalUnits : integerUnits;
  const result: Measurement[] = [];
  const supportCache = new Map<string, number>();
  assignChains(candidates, page, inferredUnit.unit, supportCache, localUnits);
  for (const candidate of candidates) {
    let unit = candidate.explicitUnit ?? inferredUnit.unit;
    let selected = selectAssociation(candidate, page, unit, supportCache, localUnits(candidate));
    const geometryConflict = !!selected && drawingScale(page) != null && unit !== "unknown" && selected.agreement < .2;
    // Resized drawings can retain their printed dimension unit. Preserve the
    // native text only if a declared unit and a real dimension's end markers
    // establish its class; omit the contradictory line from provenance.
    const declaredDimension = geometryConflict && declaration != null && declaration.unit !== "unknown"
      && selected!.association.endpointSupport === 2 && selected!.association.centered > .55;
    // A known scale/unit is independent evidence. Incidental wall or glyph
    // crossings cannot make a contradictory native segment the measured span.
    if (geometryConflict) selected = null;
    if (selected) unit = selected.unit;
    const a = selected?.association, agreement = selected?.agreement ?? 0;
    const localInference = unit !== "unknown" && !candidate.explicitUnit && inferredUnit.unit === "unknown" && agreement >= .65
      ? { unit, confidence: Math.min(.97, .88 + agreement * .09), evidence: `Maßstab 1:${drawingScale(page)} und diese native Vektorstrecke belegen ${unit}; mehrere unabhängige Maße bestätigen diese Schreibweise.` } : inferredUnit;
    const strongGeometry = !!a && a.endpointSupport === 2 && a.centered > 0.55;
    const structural = !!a && (agreement >= 0.55 || strongGeometry || (a.endpointSupport >= 1 && candidate.chainSupport >= 0.6 && a.centered >= 0.65));
    if (!candidate.explicitUnit && !structural && !declaredDimension) continue;
    // An unsigned small decimal without positive geometric agreement is usually an elevation.
    if (!candidate.explicitUnit && candidate.value < 1 && agreement < 0.6) continue;
    const confidence = candidate.explicitUnit ? (structural ? 0.99 : 0.93) : declaredDimension ? .82
      : Math.min(0.99, 0.6 + agreement * 0.23 + (a?.endpointSupport ?? 0) * 0.035 + candidate.chainSupport * 0.065 + (unit !== "unknown" ? localInference.confidence * 0.025 : 0));
    const source = structural ? "geometry" : "pdf-text";
    const evidence = [`PDF-Text „${candidate.item.text}“`,
      ...(a ? [`${axisOf(candidate.item) === "horizontal" ? "Horizontale" : "Vertikale"} Vektorstrecke ${a.line.length.toFixed(2)} pt; ${a.endpointSupport}/2 Endbegrenzungen`] : []),
      ...(a?.line.sourceLineIds ? [`Maßlinie aus ${a.line.sourceLineIds.length} unmittelbar verbundenen PDF-Vektorsegmenten`] : []),
      ...(agreement > 0.55 ? ["Wert und Vektorstrecke stimmen im Zeichnungsmaßstab überein"] : []),
      ...(candidate.chainId ? ["Teil einer geometrisch zusammenhängenden Maßkette"] : []),
      ...(declaredDimension ? ["PDF-Maßtext mit expliziter Zeichnungseinheit erhalten; widersprüchliche Vektorzuordnung verworfen"] : []),
      ...(candidate.explicitUnit ? ["Einheit direkt am Maßtext"] : [localInference.evidence])].join(". ");
    result.push({ id: `pdf-${page.pageNumber}-${candidate.item.id ?? result.length}`, key: `dimension_${page.pageNumber}_${result.length + 1}`, label: "Planmaß", value: candidate.value, unit,
      source, kind: "plan-length", status: confidence >= 0.9 && unit !== "unknown" ? "confirmed" : "unconfirmed", confidence,
      pageNumber: page.pageNumber, bbox: candidate.item.bbox, textObjectId: candidate.item.id?.replace(/-split-\d+$/, ""), orientation: axisOf(candidate.item), evidence,
      sources: ["pdf-text", ...(candidate.inlineUnit ? ["unit-text"] : []), ...(candidate.item.id?.includes("-split-") ? ["text-layout"] : []), ...(a ? ["geometry"] : []), ...(candidate.chainId ? ["dimension-chain"] : [])],
      ...(a ? { dimensionLine: { start: a.line.source.start, end: a.line.source.end }, startReference: a.line.source.start, endReference: a.line.source.end } : {}),
      chainId: candidate.chainId, unitInference: candidate.explicitUnit ? { unit, confidence: 1, evidence: "Einheit am Maßtext." } : localInference,
      signals: { textExtraction: 1, geometryAssociation: a?.score ?? 0, endpointSupport: (a?.endpointSupport ?? 0) / 2, dimensionChain: candidate.chainSupport, scaleAgreement: agreement, unitInference: candidate.explicitUnit ? 1 : localInference.confidence,
        ...(a?.line.sourceLineIds ? { nativeRailAssembly: 1 } : {}), finalConfidence: confidence } });
  }
  const openings = detectOpeningAnnotations(candidates.map((c) => c.item), page, inferredUnit.unit, drawingScale(page));
  for (const opening of openings) {
    const widthId = `pdf-${page.pageNumber}-${opening.widthItem.id}`, heightId = `pdf-${page.pageNumber}-${opening.heightItem.id}`;
    const alreadyWidth = result.find((m) => m.textObjectId === opening.widthItem.id);
    const alreadyHeight = result.find((m) => m.textObjectId === opening.heightItem.id);
    // Adjacent ordinary dimension chains can share this typography; retain both if already geometrically measured.
    if (alreadyWidth && alreadyHeight) continue;
    for (const [item, kind, id, pairedMeasurementId] of [
      [opening.widthItem, "opening-width", widthId, heightId],
      [opening.heightItem, "opening-height", heightId, widthId],
    ] as const) {
      const existing = result.find((m) => m.textObjectId === item.id);
      if (existing) { existing.kind = kind; existing.pairedMeasurementId = pairedMeasurementId; continue; }
      const confidence = kind === "opening-width" ? 0.84 + opening.geometryAgreement * 0.04 : 0.82;
      result.push({ id, key: `dimension_${page.pageNumber}_${result.length + 1}`, label: kind === "opening-width" ? "Öffnungsbreite" : "Öffnungshöhe", kind,
        pairedMeasurementId, value: Number(item.text.replace(",", ".")), unit: inferredUnit.unit,
        source: "pdf-text", status: "unconfirmed", confidence, pageNumber: page.pageNumber, bbox: item.bbox, textObjectId: item.id,
        orientation: opening.axis, ...(kind === "opening-width" ? { startReference: opening.startReference, endReference: opening.endReference } : {}),
        sources: ["pdf-text", "opening-annotation", ...(kind === "opening-width" ? [opening.isGap ? "geometry-gap" : "geometry"] : [])],
        evidence: `Gepaarte Öffnungsangabe ${opening.widthItem.text}/${opening.heightItem.text}; ${kind === "opening-width" ? "Breite geometrisch durch Öffnungsstrecke gestützt" : "Höhe aus Beschriftung; keine Länge in der Grundrissebene"}. ${inferredUnit.evidence}`,
        unitInference: inferredUnit, signals: { textExtraction: 1, openingPair: 1, geometryAssociation: kind === "opening-width" ? opening.geometryAgreement : 0, unitInference: inferredUnit.confidence, finalConfidence: confidence } });
    }
  }
  associateChainTotals(result, page);
  return result;
}

function associateChainTotals(measurements: Measurement[], page: PdfPageData) {
  const chains = new Map<string, Measurement[]>();
  for (const m of measurements.filter((m) => m.chainId && m.dimensionLine && m.kind === "plan-length")) {
    const group = chains.get(m.chainId!) ?? []; group.push(m); chains.set(m.chainId!, group);
  }
  for (const members of chains.values()) {
    if (members.length < 2 || members.some((m) => m.unit !== members[0].unit)) continue;
    const axis = members[0].orientation;
    const along = (p: { x: number; y: number }) => axis === "horizontal" ? p.x * page.width : p.y * page.height;
    const cross = (p: { x: number; y: number }) => axis === "horizontal" ? p.y * page.height : p.x * page.width;
    const from = Math.min(...members.flatMap((m) => [along(m.dimensionLine!.start), along(m.dimensionLine!.end)]));
    const to = Math.max(...members.flatMap((m) => [along(m.dimensionLine!.start), along(m.dimensionLine!.end)]));
    const total = members.reduce((sum, m) => sum + m.value, 0);
    const matching = measurements.filter((m) => {
      if (m.chainId === members[0].chainId || !m.dimensionLine || m.orientation !== axis || m.unit !== members[0].unit || m.kind !== "plan-length") return false;
      const line = m.dimensionLine, a = Math.min(along(line.start), along(line.end)), b = Math.max(along(line.start), along(line.end));
      return Math.abs(m.value - total) < Math.max(0.01, total * 0.001) && Math.abs(from - a) < 1.5 && Math.abs(to - b) < 1.5 && Math.abs(cross(line.start) - cross(members[0].dimensionLine!.start)) < 80;
    });
    // Several identical total labels can be printed; require a unique nearest rail.
    matching.sort((a, b) => Math.abs(cross(a.dimensionLine!.start) - cross(members[0].dimensionLine!.start)) - Math.abs(cross(b.dimensionLine!.start) - cross(members[0].dimensionLine!.start)));
    if (!matching.length) continue;
    const parent = matching[0];
    for (const member of members) {
      member.parentMeasurementId = parent.id;
      member.signals = { ...member.signals, dimensionChainSum: 1 };
      member.evidence += `. Teilmaße summieren sich zu ${parent.value} ${parent.unit}; gemeinsame Start-/Endreferenzen mit Gesamtmaß.`;
    }
    parent.signals = { ...parent.signals, dimensionChainSum: 1 };
    parent.evidence += `. Gesamtmaß stimmt mit ${members.length} geometrisch verbundenen Teilmaßen überein.`;
  }
}
