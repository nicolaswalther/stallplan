import type { AreaType, DetectedArea, NormalizedBox, PdfLine, PdfPageData, PdfTextItem } from "../types";
import { AREA_RULES } from "../rules";
import { detectCubiclePatterns } from "../geometry/cubicle-patterns";

const LABELS: Array<{ kind: AreaType; pattern: RegExp }> = [
  { kind: "feeding_area", pattern: /\b(futtertisch|fressbereich|fressachse|futtergang|korytarz paszowy|stol paszowy)\b/ },
  { kind: "cubicles", pattern: /\b(liegebox(?:en)?|liegeboxenreihe|legowisk[ao]?)\b/ },
  { kind: "alley", pattern: /\b(laufgang|treibgang|komunikacja|korytarz spacerowy|korytarz gnojowy|ganek gnojowy|ganek spacerowy)\b/ },
  { kind: "calving", pattern: /\b(abkalbe(?:bereich|bucht|buchten|box|boxen)?|porodowka|calving pen)\b/ },
  { kind: "isolation", pattern: /\b(kranken(?:bucht|buchten|box|boxen|bereich)|separations(?:bucht|bereich)|isolation(?:sbereich|sbucht)?|izolatka|isolatka|separatka|separatki|izolacja|kwarantanna|hospital pen|sick pen)\b/ },
  { kind: "pens", pattern: /\b(rinder(?:bucht|buchten|box|boxen)|jungvieh(?:bucht|buchten|box|boxen|bereich|stall)|kalber(?:bucht|buchten|box|boxen|bereich|stall)|tier(?:bucht|buchten)|gruppen(?:bucht|buchten)|mast(?:bucht|buchten)|jalownik|cieletnik|cattle pen|youngstock pen|calf pen)\b/ },
  { kind: "gate", pattern: /\b(tor|tore|tur|turen|door|gate|drzwi|stalltor|toranlage|tierdurchgang|maschinendurchfahrt|personendurchgang|brama|furtka)\b/ },
  { kind: "drinker", pattern: /\b(tranke(?:n|becken|trog)?|poidlo|poidla|poidelko|drinker|waterer|drinking trough)\b/ },
  { kind: "brush", pattern: /\b(kuhburste|viehburste|scheuerburste|burste|szczotka|szczotki|cow brush|cattle brush)\b/ },
];

function normalizedLabel(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/\s+/g, " ").trim();
}

/** A compound label can mention adjacent functions; never choose the first match. */
export function classifyUnambiguousAreaLabel(text: string): AreaType | null {
  const normalized = normalizedLabel(text);
  const kinds = new Set(LABELS.filter((entry) => entry.pattern.test(normalized)).map((entry) => entry.kind));
  if (kinds.size === 1) return [...kinds][0];
  // A counted furnishing is subordinate to an explicit special room function:
  // "SEPARATKA - 10 LEGOWISK" names isolation, not another cubicle row.
  // This narrowly bounded heading/count form does not resolve adjacent rooms,
  // equipment or two separately named functions by an arbitrary priority.
  if (kinds.size === 2 && kinds.has("cubicles")) {
    for (const primary of ["isolation", "calving"] as const) {
      if (!kinds.has(primary)) continue;
      const pattern = LABELS.find((entry) => entry.kind === primary)!.pattern;
      const roomLabel = normalized.replace(/^(?:(?:raum|room|nr\.?|pomieszczenie)\s*)?\d{1,3}\s*[.):–—-]\s*/, "");
      const heading = pattern.exec(roomLabel);
      if (heading?.index !== 0) continue;
      const suffix = roomLabel.slice(heading[0].length);
      if (/^\s*(?:(?:[-–—:,]\s*)|(?:mit\s+))?\d+\s*(?:legowisk[ao]?|liegebox(?:en)?|cubicles)\s*[.;]?\s*$/.test(suffix)) return primary;
    }
  }
  return null;
}

export function classifyAreaLabel(text: string): AreaType | null {
  return classifyUnambiguousAreaLabel(text);
}

interface Edge { axis: number; from: number; to: number }
interface EdgeIndex { horizontal: Edge[]; vertical: Edge[] }

/** Repeated floor hatching cannot supply the sides of a word-sized room. */
function withoutDensePatterns(edges: Edge[], axisSize: number, spanSize: number): Edge[] {
  const families = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = `${Math.round(edge.from * spanSize / 2)}:${Math.round(edge.to * spanSize / 2)}`;
    const family = families.get(key) ?? []; family.push(edge); families.set(key, family);
  }
  const suppressed = new Set<Edge>();
  for (const family of families.values()) {
    family.sort((a, b) => a.axis - b.axis);
    let run: Edge[] = [], distinct = 0, preceding = -Infinity;
    const finish = () => { if (distinct >= 6) for (const edge of run) suppressed.add(edge); };
    for (const edge of family) {
      const position = edge.axis * axisSize;
      if (position - preceding > 12) { finish(); run = []; distinct = 0; }
      if (!run.length || position - preceding >= 0.5) distinct++;
      run.push(edge); preceding = position;
    }
    finish();
  }
  return edges.filter((edge) => !suppressed.has(edge)).sort((a, b) => a.axis - b.axis);
}

function axisEdges(lines: PdfLine[], width: number, height: number) {
  const horizontal: Edge[] = [];
  const vertical: Edge[] = [];
  for (const line of lines) {
    const dx = Math.abs(line.end.x - line.start.x);
    const dy = Math.abs(line.end.y - line.start.y);
    // PDF outlines and short symbol strokes are not room boundaries.
    if (dy * height <= 1.5 && dx * width >= 24) horizontal.push({ axis: (line.start.y + line.end.y) / 2, from: Math.min(line.start.x, line.end.x), to: Math.max(line.start.x, line.end.x) });
    if (dx * width <= 1.5 && dy * height >= 24) vertical.push({ axis: (line.start.x + line.end.x) / 2, from: Math.min(line.start.y, line.end.y), to: Math.max(line.start.y, line.end.y) });
  }
  return { horizontal: withoutDensePatterns(horizontal, height, width), vertical: withoutDensePatterns(vertical, width, height) };
}

function coverage(edges: Edge[], axis: number, from: number, to: number, tolerance: number) {
  // The axis-sorted index is constructed once per page. Only local collinear
  // edges enter each union, instead of rescanning an entire CAD drawing.
  let low = 0, high = edges.length;
  while (low < high) { const middle = (low + high) >>> 1; if (edges[middle].axis < axis - tolerance) low = middle + 1; else high = middle; }
  const spans: number[][] = [];
  for (let index = low; index < edges.length && edges[index].axis <= axis + tolerance; index++) {
    const edge = edges[index];
    if (edge.to > from && edge.from < to) spans.push([Math.max(from, edge.from), Math.min(to, edge.to)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = from;
  for (const [start, stop] of spans) {
    covered += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return covered / (to - from);
}

function repeatedStripLabels(page: PdfPageData, label: PdfTextItem, otherLabels: PdfTextItem[]): PdfTextItem[] {
  const kind = classifyAreaLabel(label.text);
  if (kind !== "feeding_area" && kind !== "alley") return [label];
  const cy = label.bbox.y + label.bbox.height / 2;
  const sameRow = otherLabels.filter((other) => normalizedLabel(other.text) === normalizedLabel(label.text)
    && Math.abs((other.orientation ?? 0) - (label.orientation ?? 0)) <= 5
    && Math.abs(other.bbox.y + other.bbox.height / 2 - cy) * page.height <= Math.max(8, label.bbox.height * page.height * 1.5));
  if (!sameRow.some((other) => other !== label && Math.abs(other.bbox.x - label.bbox.x) * page.width >= Math.max(60, label.bbox.width * page.width * 1.5))) return [label];
  return sameRow;
}

function enclosingBox(page: PdfPageData, label: PdfTextItem, otherLabels: PdfTextItem[], edges: EdgeIndex): NormalizedBox | null {
  const { horizontal, vertical } = edges;
  const repeated = repeatedStripLabels(page, label, otherLabels);
  const peers = new Set(repeated);
  const cx = label.bbox.x + label.bbox.width / 2;
  const cy = label.bbox.y + label.bbox.height / 2;
  const tx = 2.5 / page.width;
  const ty = 2.5 / page.height;
  const horizontalAtLabel = horizontal.filter((edge) => edge.from <= cx && edge.to >= cx);
  const verticalAtLabel = vertical.filter((edge) => edge.from <= cy && edge.to >= cy);
  const nearest = (edges: Edge[], before: boolean, center: number, tolerance: number) => {
    const selected: number[] = [];
    for (const position of [...new Set(edges.filter((edge) => before ? edge.axis < center : edge.axis > center).map((edge) => edge.axis))].sort((a, b) => Math.abs(a - center) - Math.abs(b - center))) {
      if (selected.every((existing) => Math.abs(existing - position) > tolerance)) selected.push(position);
      if (selected.length === 5) break;
    }
    return selected;
  };
  const tops = nearest(horizontalAtLabel, true, Math.min(...repeated.map((item) => item.bbox.y)), ty);
  const bottoms = nearest(horizontalAtLabel, false, Math.max(...repeated.map((item) => item.bbox.y + item.bbox.height)), ty);
  const lefts = nearest(verticalAtLabel, true, Math.min(...repeated.map((item) => item.bbox.x)), tx);
  const rights = nearest(verticalAtLabel, false, Math.max(...repeated.map((item) => item.bbox.x + item.bbox.width)), tx);
  const candidates: NormalizedBox[] = [];
  for (const y of tops) for (const bottom of bottoms) for (const x of lefts) for (const right of rights) {
    const width = right - x;
    const height = bottom - y;
    if (x < 0 || y < 0 || right > 1 || bottom > 1) continue;
    if (width < Math.max(label.bbox.width * 1.5, 30 / page.width) || height < Math.max(label.bbox.height * 4, 30 / page.height) || width * height < 0.002) continue;
    if (coverage(horizontal, y, x, right, ty) < 0.9 || coverage(horizontal, bottom, x, right, ty) < 0.9 || coverage(vertical, x, y, bottom, tx) < 0.9 || coverage(vertical, right, y, bottom, tx) < 0.9) continue;
    // A room schedule or building-wide outline cannot stand in for an individual room.
    if (repeated.some((item) => item.bbox.x < x || item.bbox.x + item.bbox.width > right || item.bbox.y < y || item.bbox.y + item.bbox.height > bottom)) continue;
    if (otherLabels.some((item) => !peers.has(item) && item.bbox.x >= x && item.bbox.x + item.bbox.width <= right && item.bbox.y >= y && item.bbox.y + item.bbox.height <= bottom)) continue;
    candidates.push({ x, y, width, height });
  }
  return candidates.sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null;
}

/** Only classify a real enclosure anchored by extracted text; never fabricate a box around a word. */
export function detectStructuralAreas(pages: PdfPageData[]): DetectedArea[] {
  const result: DetectedArea[] = [];
  for (const page of pages) {
    // Small equipment and door openings need their own symbol/opening geometry.
    // A room enclosure around their labels would invent a device-sized location.
    const labels = page.textItems.filter((item) => {
      const kind = classifyAreaLabel(item.text);
      return kind !== null && kind !== "drinker" && kind !== "brush" && kind !== "gate";
    });
    const edges = axisEdges(page.lines ?? [], page.width, page.height);
    for (const item of labels) {
      const kind = classifyAreaLabel(item.text)!;
      const bbox = enclosingBox(page, item, labels, edges);
      if (!bbox) continue;
      if (result.some((area) => area.pageNumber === page.pageNumber && Math.abs(area.bbox.x - bbox.x) < 0.003 && Math.abs(area.bbox.y - bbox.y) < 0.003)) continue;
      const repeated = repeatedStripLabels(page, item, labels);
      const labelDominated = bbox.width < item.bbox.width * 2.5 && bbox.height < item.bbox.height * 8;
      result.push({
        id: `structure-area-${page.pageNumber}-${item.id ?? result.length + 1}`,
        kind, label: AREA_RULES[kind].title, originalLabel: item.text, confidence: labelDominated ? 0.82 : 0.91,
        source: "geometry", status: "unconfirmed", pageNumber: page.pageNumber, bbox, hasBbox: true,
        evidence: ["Bereichsart aus eindeutiger PDF-Beschriftung erkannt.", "Vier umschließende Vektorkanten mit mindestens 90 % Linienabdeckung.",
          ...(repeated.length > 1 ? [`${repeated.length} identische PDF-Beschriftungen entlang desselben Bereichsstreifens.`] : []),
          ...(labelDominated ? ["Kleine Umgrenzung nahe der Beschriftung; vollständigen Bereich prüfen."] : [])],
        originalEvidence: [`PDF-Beschriftung: ${item.text}`],
      });
    }
    const specialRoomLabels = labels.filter((item) => ["isolation", "calving", "pens"].includes(classifyAreaLabel(item.text)!));
    for (const pattern of detectCubiclePatterns(page, specialRoomLabels)) {
      if (!result.some((area) => area.pageNumber === page.pageNumber && area.kind === "cubicles" && boxOverlap(area.bbox, pattern.bbox).iou >= .45)) result.push(pattern);
    }
  }
  return result;
}

function boxOverlap(a: NormalizedBox, b: NormalizedBox) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const first = a.width * a.height, second = b.width * b.height;
  return { intersection, first, second, iou: first + second - intersection > 0 ? intersection / (first + second - intersection) : 0 };
}

function sameDocumentLabel(a: DetectedArea, b: DetectedArea) {
  return Boolean(a.originalLabel?.trim() && b.originalLabel?.trim()
    && normalizedLabel(a.originalLabel) === normalizedLabel(b.originalLabel));
}

/**
 * Keep text/geometry fallback without turning its smallest closed rectangle
 * into an authoritative whole room. A larger semantic envelope can replace a
 * contained native fragment only when both refer to the exact original label.
 */
export function mergeDetectedAreas(structural: DetectedArea[], semantic: DetectedArea[]): DetectedArea[] {
  const merged = [...structural];
  const nativeSupport = new Map<DetectedArea, DetectedArea[]>(structural.map((area) => [area, area.source === "geometry" ? [area] : []]));
  for (const area of semantic) {
    if (!area.hasBbox || area.source === "manual" || area.geometryCorrections?.length) { merged.push(area); continue; }
    // A model envelope spanning independently proven furniture components
    // cannot fill their intervening passage. Keep the exact native blocks.
    if (area.source === "ai" && area.kind === "cubicles" && !area.footprint && structural.filter((native) => {
      if (!native.patternProvenance || native.pageNumber !== area.pageNumber || native.kind !== "cubicles") return false;
      const overlap = boxOverlap(native.bbox, area.bbox);
      return overlap.first > 0 && overlap.intersection / overlap.first >= .85;
    }).length >= 2) continue;
    let handled = false;
    for (let index = 0; index < merged.length; index++) {
      const base = merged[index];
      if (base.pageNumber !== area.pageNumber || base.kind !== area.kind || !base.hasBbox) continue;
      const overlap = boxOverlap(base.bbox, area.bbox);
      const supports = nativeSupport.get(base) ?? [];
      const sameLabel = supports.some((support) => sameDocumentLabel(support, area));
      // Explicit label identity avoids merging separate same-type areas merely
      // because a broad rectangle happens to contain their smaller outlines.
      const containedNativeFragment = sameLabel && supports.length > 0 && overlap.first > 0 && overlap.second > overlap.first * 1.05
        && overlap.second < overlap.first * 8 && overlap.intersection / overlap.first >= 0.85;
      if (containedNativeFragment) {
        const confidence = Math.min(area.confidence ?? 0.85, ...supports.map((support) => support.confidence ?? 0.85));
        const combined: DetectedArea = { ...area, id: base.id, source: "ai", confidence,
          originalConfidence: area.originalConfidence ?? area.confidence,
          evidence: [...area.evidence, "Eindeutige PDF-Beschriftung bestätigt denselben Bereich; vollständigere Markierung übernommen."],
          originalEvidence: [...(area.originalEvidence ?? []), ...supports.flatMap((support) => support.originalEvidence ?? [])] };
        merged[index] = combined; nativeSupport.set(combined, supports); handled = true; break;
      }
      if (overlap.iou >= 0.45) { handled = true; break; }
    }
    if (!handled) merged.push(area);
  }
  // A regular cubicle row and a text-proven manure alley are exclusive primary
  // functions. Do not keep a second, coincident furnishing row on that lane.
  // This never discards gates, equipment, customer areas or crossing zones.
  return merged.filter((area) => !(area.source === "ai" && !area.geometryCorrections?.length && area.kind === "cubicles" && merged.some((other) => {
    if (other === area || other.kind !== "alley" || other.pageNumber !== area.pageNumber || !other.hasBbox) return false;
    const supported = (nativeSupport.get(other) ?? []).some((support) => /\b(?:ganek gnojowy|korytarz gnojowy)\b/.test(normalizedLabel(support.originalLabel ?? "")));
    if (!supported) return false;
    const overlap = boxOverlap(area.bbox, other.bbox);
    return overlap.first > 0 && overlap.intersection / overlap.first >= 0.8;
  })));
}
