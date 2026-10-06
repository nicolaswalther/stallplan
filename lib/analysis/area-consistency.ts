import type { DetectedArea, NormalizedBox, PdfPageData } from "../types";
import { classifyUnambiguousAreaLabel } from "./areas";

interface NativeBand { area: DetectedArea; page: PdfPageData; label: string }

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/\s+/g, " ").trim();
const endY = (box: NormalizedBox) => box.y + box.height;
const overlap = (start: number, end: number, otherStart: number, otherEnd: number) => Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
const validBox = (box: NormalizedBox) => [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;

/** An exact quoted plan label is a spatial claim, unlike an inferred German
 * description. Only strong native room/strip labels enforce this check;
 * a small uncertain enclosure cannot locate every same-named room, whose
 * other caption may be outlined vector text rather than extractable text. */
function hasNativeLabelAnchor(area: DetectedArea, structural: DetectedArea[], pages: PdfPageData[]) {
  if (["gate", "drinker", "brush", "unknown"].includes(area.kind)) return true;
  const label = normalize(area.originalLabel ?? "");
  if (!label || !structural.some((native) => native.pageNumber === area.pageNumber && native.kind === area.kind
    && native.source === "geometry" && native.hasBbox && native.status !== "rejected" && !native.removedAt
    && (native.confidence ?? 0) >= .9
    && normalize(native.originalLabel ?? "") === label)) return true;
  const page = pages.find((candidate) => candidate.pageNumber === area.pageNumber);
  if (!page || page.width <= 0 || page.height <= 0) return true;
  const anchors = page.textItems.filter((item) => normalize(item.text) === label);
  if (!anchors.length) return true;
  return anchors.some((item) => {
    const font = Number.isFinite(item.fontSize) && item.fontSize! > 0 ? item.fontSize! : item.bbox.height * page.height;
    const tolerance = Math.max(.75, Math.min(4, font * .25));
    const x = item.bbox.x + item.bbox.width / 2, y = item.bbox.y + item.bbox.height / 2;
    return x >= area.bbox.x - tolerance / page.width && x <= area.bbox.x + area.bbox.width + tolerance / page.width
      && y >= area.bbox.y - tolerance / page.height && y <= endY(area.bbox) + tolerance / page.height;
  });
}

/** A smaller, mostly contained model fragment of the exact same labelled
 * native area adds a duplicate, not a second functional region. Never merge
 * their rectangles or apply this to uncertain/native polygon boundaries. */
function isNativeLabelFragment(area: DetectedArea, structural: DetectedArea[]) {
  const label = normalize(area.originalLabel ?? "");
  if (!label) return false;
  const size = area.bbox.width * area.bbox.height;
  return structural.some((native) => {
    if (native.pageNumber !== area.pageNumber || native.kind !== area.kind || native.source !== "geometry"
      || native.status === "rejected" || native.removedAt || native.geometryCorrections?.length
      || native.footprint || native.contourProvenance || !native.hasBbox || !validBox(native.bbox)
      || (native.confidence ?? 0) < .9 || normalize(native.originalLabel ?? "") !== label
      || native.bbox.width * native.bbox.height <= size) return false;
    const intersection = overlap(area.bbox.x, area.bbox.x + area.bbox.width, native.bbox.x, native.bbox.x + native.bbox.width)
      * overlap(area.bbox.y, endY(area.bbox), native.bbox.y, endY(native.bbox));
    return intersection / size >= .8;
  });
}

/** A collection rectangle cannot reconnect two equally named feeding strips
 * whose independently enclosed native geometry leaves a passage between them.
 * Keep those exact native proposals; do not manufacture a replacement split. */
function isSeparatedFeedingCollection(area: DetectedArea, structural: DetectedArea[], pages: PdfPageData[]) {
  if (area.kind !== "feeding_area") return false;
  const label = normalize(area.originalLabel ?? "");
  const page = pages.find((candidate) => candidate.pageNumber === area.pageNumber);
  if (!label || !page || page.width <= 0 || page.height <= 0) return false;
  const native = structural.filter((candidate) => {
    if (candidate.pageNumber !== area.pageNumber || candidate.kind !== "feeding_area" || candidate.source !== "geometry"
      || candidate.status !== "unconfirmed" || candidate.removedAt || candidate.geometryCorrections?.length
      || candidate.footprint || candidate.contourProvenance || !candidate.hasBbox || !validBox(candidate.bbox)
      || (candidate.confidence ?? 0) < .9 || normalize(candidate.originalLabel ?? "") !== label
      || classifyUnambiguousAreaLabel(candidate.originalLabel ?? "") !== "feeding_area"
      || candidate.bbox.width * page.width < 4 * candidate.bbox.height * page.height) return false;
    const box = candidate.bbox;
    if (overlap(area.bbox.x, area.bbox.x + area.bbox.width, box.x, box.x + box.width) < .9 * box.width
      || overlap(area.bbox.y, endY(area.bbox), box.y, endY(box)) < .8 * Math.min(area.bbox.height, box.height)) return false;
    return page.textItems.some((item) => normalize(item.text) === label && Math.abs(item.orientation ?? 0) <= 5
      && item.bbox.x >= box.x && item.bbox.x + item.bbox.width <= box.x + box.width
      && item.bbox.y >= box.y && item.bbox.y + item.bbox.height <= endY(box)
      && item.bbox.x >= area.bbox.x && item.bbox.x + item.bbox.width <= area.bbox.x + area.bbox.width
      && item.bbox.y >= area.bbox.y && item.bbox.y + item.bbox.height <= endY(area.bbox));
  });
  return native.some((first, index) => native.slice(index + 1).some((second) => {
    const left = first.bbox.x <= second.bbox.x ? first.bbox : second.bbox;
    const right = first.bbox.x <= second.bbox.x ? second.bbox : first.bbox;
    return right.x - left.x - left.width >= 4 / page.width
      && overlap(left.y, endY(left), right.y, endY(right)) >= .85 * Math.min(left.height, right.height);
  }));
}

/** Only native, horizontally labelled manure lanes provide exclusion bands.
 * Generic corridors, model-generated labels and small label enclosures cannot
 * partition a larger room. Geometry and its actual PDF text must agree. */
function nativeBands(structural: DetectedArea[], pages: PdfPageData[]): NativeBand[] {
  const result: NativeBand[] = [];
  for (const area of structural) {
    const page = pages.find((candidate) => candidate.pageNumber === area.pageNumber);
    const label = normalize(area.originalLabel ?? "");
    if (!page || page.width <= 0 || page.height <= 0 || area.kind !== "alley" || area.source !== "geometry"
      || area.status !== "unconfirmed" || area.removedAt || area.geometryCorrections?.length
      || !area.hasBbox || !validBox(area.bbox) || (area.confidence ?? 0) < .8
      || !/\b(?:ganek gnojowy|korytarz gnojowy|tragyaut)\b/.test(label)
      || classifyUnambiguousAreaLabel(area.originalLabel ?? "") !== "alley"
      || area.bbox.width * page.width <= 4 * area.bbox.height * page.height) continue;
    const anchored = page.textItems.some((item) => normalize(item.text) === label
      && Math.abs(item.orientation ?? 0) <= 5
      && item.bbox.x >= area.bbox.x - 2.5 / page.width
      && item.bbox.x + item.bbox.width <= area.bbox.x + area.bbox.width + 2.5 / page.width
      && item.bbox.y >= area.bbox.y - 2.5 / page.height
      && item.bbox.y + item.bbox.height <= endY(area.bbox) + 2.5 / page.height);
    if (anchored) result.push({ area, page, label });
  }
  return result.sort((a, b) => a.area.pageNumber - b.area.pageNumber || a.area.bbox.y - b.area.bbox.y);
}

function coveredBands(area: DetectedArea, bands: NativeBand[]): NativeBand[] {
  const selected: NativeBand[] = [];
  for (const band of bands) {
    const box = band.area.bbox;
    if (band.area.pageNumber !== area.pageNumber
      || overlap(area.bbox.x, area.bbox.x + area.bbox.width, box.x, box.x + box.width) < .85 * box.width
      || overlap(area.bbox.y, endY(area.bbox), box.y, endY(box)) < .8 * box.height) continue;
    // Repeated words or overlapping alternative enclosures are one signal,
    // never evidence for two independent lanes.
    if (selected.some((previous) => overlap(previous.area.bbox.y, endY(previous.area.bbox), box.y, endY(box)) > .5 * Math.min(previous.area.bbox.height, box.height))) continue;
    selected.push(band);
  }
  return selected;
}

function revised(area: DetectedArea, bbox: NormalizedBox, id: string, bands: NativeBand[], message: string): DetectedArea {
  return {
    ...area, id, bbox, source: "ai", status: "unconfirmed",
    confidence: area.confidence === null ? null : Math.min(.82, area.confidence * .95),
    originalBbox: area.originalBbox ?? area.bbox,
    originalSource: area.originalSource ?? area.source,
    originalConfidence: area.originalConfidence ?? area.confidence,
    // Rails supporting the old collection envelope do not support new strips.
    boundaryAssessment: undefined, boundaryRefinement: undefined,
    evidence: [...area.evidence, message, "Seitliche Ausdehnung stammt aus der KI-Markierung; prüfen."],
    originalEvidence: [...(area.originalEvidence ?? []), ...bands.map((band) =>
      `Native Trennung ${band.area.id}: ${band.area.originalLabel}; y=${band.area.bbox.y}..${endY(band.area.bbox)}`)],
  };
}

/** A semantic collection envelope must not fill several independent manure
 * lanes with cubicles, or join those lanes through the intervening cubicles.
 * This narrow consistency guard preserves real polygons, reviewed geometry
 * and all other area functions. It never infers an unlabelled exclusion. */
export function reconcileAreaConsistency(semantic: DetectedArea[], structural: DetectedArea[], pages: PdfPageData[]): DetectedArea[] {
  const bands = nativeBands(structural, pages);
  return semantic.flatMap((area) => {
    if (area.source !== "ai" || area.status !== "unconfirmed" || area.removedAt || area.geometryCorrections?.length
      || area.footprint || area.contourProvenance || !area.hasBbox || !validBox(area.bbox)) return [area];
    if (!hasNativeLabelAnchor(area, structural, pages)) return [];
    if (isNativeLabelFragment(area, structural)) return [];
    if (isSeparatedFeedingCollection(area, structural, pages)) return [];
    if (area.kind !== "cubicles" && area.kind !== "alley") return [area];
    const covered = coveredBands(area, bands);
    const independent = covered.filter((band, index) => index === 0
      || band.area.bbox.y - endY(covered[index - 1].area.bbox) >= 4 / band.page.height);
    if (independent.length < 2) return [area];
    if (area.kind === "alley") {
      const matching = independent.filter((band) => normalize(area.originalLabel ?? "") === band.label);
      if (matching.length < 2) return [area];
      return matching.map((band) => {
        const top = Math.max(area.bbox.y, band.area.bbox.y);
        const bottom = Math.min(endY(area.bbox), endY(band.area.bbox));
        const result = revised(area, { ...area.bbox, y: top, height: bottom - top }, band.area.id, [band],
          "Sammelmarkierung auf den zugehörigen PDF-beschrifteten Mistgangstreifen begrenzt.");
        return { ...result, originalLabel: band.area.originalLabel };
      });
    }
    const segments: Array<{ top: number; bottom: number }> = [];
    let top = area.bbox.y;
    for (const band of independent) {
      const bottom = Math.max(area.bbox.y, band.area.bbox.y);
      if (bottom > top) segments.push({ top, bottom });
      top = Math.max(top, Math.min(endY(area.bbox), endY(band.area.bbox)));
    }
    if (top < endY(area.bbox)) segments.push({ top, bottom: endY(area.bbox) });
    const minimumHeight = Math.max(6 / independent[0].page.height,
      Math.min(...independent.map((band) => band.area.bbox.height)) * .3);
    const rows = segments.filter((segment) => segment.bottom - segment.top >= minimumHeight);
    if (rows.length < 2) return [area];
    return rows.map((segment, index) => revised(area,
      { ...area.bbox, y: segment.top, height: segment.bottom - segment.top }, `${area.id}-row-${index + 1}`, independent,
      `Sammelmarkierung anhand von ${independent.length} PDF-beschrifteten Mistgangstreifen in getrennte Liegeboxenreihen aufgeteilt.`));
  });
}
