import type { AreaType, DetectedArea, NormalizedBox, PdfLine, PdfPageData, PdfTextItem } from "../types";
import { AREA_RULES } from "../rules";
import { detectCubiclePatterns } from "../geometry/cubicle-patterns";

const LABELS: Array<{ kind: AreaType; pattern: RegExp }> = [
  { kind: "feeding_area", pattern: /\b(futtertisch|fressbereich|fressachse|futtergang|korytarz paszowy|stol paszowy|etetout)\b/ },
  { kind: "cubicles", pattern: /\b(liegebox(?:en)?|liegeboxenreihe|legowisk[ao]?|piheno box(?:ok)?)\b/ },
  { kind: "alley", pattern: /\b(laufgang|treibgang|komunikacja|korytarz spacerowy|korytarz gnojowy|ganek gnojowy|ganek spacerowy|tragyaut|felhajtout|atjaro|athajto)\b/ },
  { kind: "calving", pattern: /\b(abkalbe(?:bereich|bucht|buchten|box|boxen)?|porodowka|calving pen|elleto box(?:ok)?)\b/ },
  { kind: "isolation", pattern: /\b(kranken(?:bucht|buchten|box|boxen|bereich)|separations(?:bucht|bereich)|isolation(?:sbereich|sbucht)?|izolatka|isolatka|separatka|separatki|izolacja|kwarantanna|hospital pen|sick pen)\b/ },
  { kind: "pens", pattern: /\b(rinder(?:bucht|buchten|box|boxen)|jungvieh(?:bucht|buchten|box|boxen|bereich|stall)|kalber(?:bucht|buchten|box|boxen|bereich|stall)|tier(?:bucht|buchten)|gruppen(?:bucht|buchten)|mast(?:bucht|buchten)|jalownik|cieletnik|cattle pen|youngstock pen|calf pen|borjunevelo box(?:ok)?)\b/ },
  { kind: "gate", pattern: /\b(tor|tore|tur|turen|door|gate|drzwi|stalltor|toranlage|tierdurchgang|maschinendurchfahrt|personendurchgang|brama|furtka)\b/ },
  { kind: "drinker", pattern: /\b(tranke(?:n|becken|trog)?|poidlo|poidla|poidelko|drinker|waterer|drinking trough|itato)\b/ },
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

interface Edge { axis: number; from: number; to: number; id: string }
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
    // PDF point spacing depends on the plotted scale. A regular floor hatch
    // just above the absolute 12-point threshold must not create room cells.
    // Require many identical, closely spaced, elongated parallel strokes;
    // widely spaced pen walls and short cubicle dividers remain structural.
    const positions = [...new Set(family.map((edge) => edge.axis * axisSize))];
    if (positions.length < 12) continue;
    const steps = positions.slice(1).map((position, index) => position - positions[index]).sort((a, b) => a - b);
    const spacing = steps[Math.floor(steps.length / 2)];
    const span = (family[0].to - family[0].from) * spanSize;
    if (spacing < .5 || span / spacing < 5) continue;
    const runs: number[][] = [];
    for (const position of positions) {
      const previous = runs.at(-1);
      if (previous && position - previous.at(-1)! <= spacing * 1.6) previous.push(position);
      else runs.push([position]);
    }
    for (const periodic of runs) {
      const localSteps = periodic.slice(1).map((position, index) => position - periodic[index]);
      if (periodic.length < 12 || localSteps.filter((step) => Math.abs(step - spacing) <= Math.max(.25, spacing * .08)).length / localSteps.length < .85) continue;
      const members = new Set(periodic);
      for (const edge of family) if (members.has(edge.axis * axisSize)) suppressed.add(edge);
    }
  }
  return edges.filter((edge) => !suppressed.has(edge)).sort((a, b) => a.axis - b.axis);
}

/** Two short diagonal slashes crossing a rail's endpoints establish a CAD
 * dimension line. They are independent of whether its digits are PDF text or
 * outlined paths. Wall corners and one accidental crossing do not qualify. */
function dimensionRailFilter(lines: PdfLine[], width: number, height: number) {
  const ticks = new Map<string, Array<{ x: number; y: number; dx: number; dy: number; length: number; index: number }>>();
  for (const [index, line] of lines.entries()) {
    const x = line.start.x * width, y = line.start.y * height;
    const dx = (line.end.x - line.start.x) * width, dy = (line.end.y - line.start.y) * height;
    const length = Math.hypot(dx, dy);
    if (length < 1 || length > 6 || Math.abs(dx) < .5 || Math.abs(dy) < .5 || Math.abs(dx / dy) < .5 || Math.abs(dx / dy) > 2) continue;
    const key = `${Math.floor((x + dx / 2) / 4)}:${Math.floor((y + dy / 2) / 4)}`;
    const bucket = ticks.get(key) ?? []; bucket.push({ x, y, dx, dy, length, index }); ticks.set(key, bucket);
  }
  const hasTick = (point: PdfLine["start"], index: number) => {
    const x = point.x * width, y = point.y * height;
    const cellX = Math.floor(x / 4), cellY = Math.floor(y / 4);
    for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) {
      for (const tick of ticks.get(`${cellX + ix}:${cellY + iy}`) ?? []) {
        // An overlaid dimension can share a genuine wall endpoint. Require
        // the rail and its cap primitives to be emitted together, rather
        // than deleting a much earlier wall just because their ink coincides.
        if (Math.abs(tick.index - index) > 12) continue;
        const t = ((x - tick.x) * tick.dx + (y - tick.y) * tick.dy) / tick.length ** 2;
        if (t > .2 && t < .8 && Math.hypot(x - tick.x - t * tick.dx, y - tick.y - t * tick.dy) <= .45) return true;
      }
    }
    return false;
  };
  return (line: PdfLine, index: number) => !(hasTick(line.start, index) && hasTick(line.end, index));
}

function axisEdges(lines: PdfLine[], width: number, height: number, excludeDimensionRails = true) {
  const horizontal: Edge[] = [];
  const vertical: Edge[] = [];
  const structuralRail = excludeDimensionRails ? dimensionRailFilter(lines, width, height) : null;
  for (const [index, line] of lines.entries()) {
    const dx = Math.abs(line.end.x - line.start.x);
    const dy = Math.abs(line.end.y - line.start.y);
    const isHorizontal = dy * height <= 1.5 && dx * width >= 24;
    const isVertical = dx * width <= 1.5 && dy * height >= 24;
    if (!isHorizontal && !isVertical) continue;
    // PDF outlines, dimension rails and short symbol strokes are not room boundaries.
    if (structuralRail && !structuralRail(line, index)) continue;
    if (isHorizontal) horizontal.push({ id: line.id, axis: (line.start.y + line.end.y) / 2, from: Math.min(line.start.x, line.end.x), to: Math.max(line.start.x, line.end.x) });
    if (isVertical) vertical.push({ id: line.id, axis: (line.start.x + line.end.x) / 2, from: Math.min(line.start.y, line.end.y), to: Math.max(line.start.y, line.end.y) });
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

function repeatedStripLabels(page: PdfPageData, label: PdfTextItem, otherLabels: PdfTextItem[], edges: EdgeIndex): PdfTextItem[] {
  const kind = classifyAreaLabel(label.text);
  if (kind !== "feeding_area" && kind !== "alley") return [label];
  const cy = label.bbox.y + label.bbox.height / 2;
  const sameRow = otherLabels.filter((other) => normalizedLabel(other.text) === normalizedLabel(label.text)
    && Math.abs((other.orientation ?? 0) - (label.orientation ?? 0)) <= 5
    && Math.abs(other.bbox.y + other.bbox.height / 2 - cy) * page.height <= Math.max(8, label.bbox.height * page.height * 1.5));
  const cx = label.bbox.x + label.bbox.width / 2;
  const connected = sameRow.filter((other) => {
    const ox = other.bbox.x + other.bbox.width / 2;
    const halfSpan = Math.max(30 / page.height, Math.max(label.bbox.height, other.bbox.height) * 2);
    // Identical labels on opposite sides of a long native partition describe
    // separate strips. Repetition alone cannot fill a crossing circulation lane.
    return !edges.vertical.some((edge) => edge.axis > Math.min(cx, ox) && edge.axis < Math.max(cx, ox)
      && edge.from <= cy - halfSpan && edge.to >= cy + halfSpan);
  });
  if (!connected.some((other) => other !== label && Math.abs(other.bbox.x - label.bbox.x) * page.width >= Math.max(60, label.bbox.width * page.width * 1.5))) return [label];
  return connected;
}

function enclosingBox(page: PdfPageData, label: PdfTextItem, otherLabels: PdfTextItem[], edges: EdgeIndex): NormalizedBox | null {
  const { horizontal, vertical } = edges;
  const repeated = repeatedStripLabels(page, label, otherLabels, edges);
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

/** A manure lane can end in an open crossing, without a fourth enclosing wall.
 * Recover its full band only from repeated literal labels, two continuously
 * painted horizontal rails and an independently proven adjacent cubicle row.
 * Larger gaps qualify only at a crossing between two proven furniture blocks. */
function patternAdjacentStrip(page: PdfPageData, label: PdfTextItem, labels: PdfTextItem[], edges: EdgeIndex, patterns: DetectedArea[]) {
  if (classifyAreaLabel(label.text) !== "alley" || !patterns.length) return null;
  const repeated = repeatedStripLabels(page, label, labels, edges);
  if (repeated.length < 2) return null;
  const peers = new Set(repeated), tolerance = 2.5 / page.height;
  const firstX = Math.min(...repeated.map((item) => item.bbox.x));
  const lastX = Math.max(...repeated.map((item) => item.bbox.x + item.bbox.width));
  const firstY = Math.min(...repeated.map((item) => item.bbox.y));
  const lastY = Math.max(...repeated.map((item) => item.bbox.y + item.bbox.height));
  const nearbyAxes = (before: boolean) => [...new Set(edges.horizontal.filter((edge) => edge.from <= firstX && edge.to >= firstX
    && (before ? edge.axis < firstY : edge.axis > lastY)).map((edge) => edge.axis))]
    .sort((a, b) => Math.abs(a - firstY) - Math.abs(b - firstY)).filter((position, index, positions) =>
      !positions.slice(0, index).some((other) => Math.abs(position - other) <= tolerance)).slice(0, 5);
  const spansAt = (axis: number, adjacent: DetectedArea[]) => {
    const segments = edges.horizontal.filter((edge) => Math.abs(edge.axis - axis) <= tolerance).sort((a, b) => a.from - b.from);
    const spans: Array<{ from: number; to: number; ids: string[] }> = [];
    for (const edge of segments) {
      const previous = spans.at(-1);
      const crossing = previous && adjacent.some((left) => adjacent.some((right) => left !== right
        && Math.abs(left.bbox.x + left.bbox.width - previous.to) * page.width <= 4
        && Math.abs(right.bbox.x - edge.from) * page.width <= 4
        && edge.from > previous.to && edge.from - previous.to <= Math.max(left.bbox.height, right.bbox.height) * page.height / page.width * 1.5));
      if (previous && (edge.from - previous.to <= 4 / page.width || crossing)) {
        previous.to = Math.max(previous.to, edge.to); previous.ids.push(edge.id);
      } else spans.push({ from: edge.from, to: edge.to, ids: [edge.id] });
    }
    return spans;
  };
  const candidates: Array<{ bbox: NormalizedBox; ids: string[] }> = [];
  for (const top of nearbyAxes(true)) for (const bottom of nearbyAxes(false)) {
    const height = bottom - top;
    if (height * page.height < 30 || height < label.bbox.height * 3) continue;
    const adjacent = patterns.filter((pattern) => pattern.patternProvenance
      && (Math.abs(pattern.bbox.y - bottom) <= tolerance || Math.abs(pattern.bbox.y + pattern.bbox.height - top) <= tolerance)
      && pattern.bbox.x < lastX && pattern.bbox.x + pattern.bbox.width > firstX);
    if (!adjacent.length || height > Math.max(...adjacent.map((pattern) => pattern.bbox.height)) * 1.8) continue;
    const patternStart = Math.min(...adjacent.map((pattern) => pattern.bbox.x));
    for (const upper of spansAt(top, adjacent)) for (const lower of spansAt(bottom, adjacent)) {
      const x = Math.max(upper.from, lower.from, patternStart), right = Math.min(upper.to, lower.to);
      const width = right - x;
      if (x < 0 || top < 0 || right > 1 || bottom > 1) continue;
      if (x > firstX || right < lastX || width * page.width < height * page.height * 3 || width < (lastX - firstX) * 1.15) continue;
      const bbox = { x, y: top, width, height };
      if (patterns.some((pattern) => boxOverlap(bbox, pattern.bbox).intersection / (pattern.bbox.width * pattern.bbox.height) > .05)) continue;
      if (labels.some((item) => !peers.has(item) && item.bbox.x >= x && item.bbox.x + item.bbox.width <= right
        && item.bbox.y >= top && item.bbox.y + item.bbox.height <= bottom)) continue;
      if (coverage(edges.horizontal, top, x, right, tolerance) < .9 || coverage(edges.horizontal, bottom, x, right, tolerance) < .9) continue;
      // The open end is anchored by the native furniture envelope. The other
      // end must have a painted wall or coincident rail endpoints.
      const rightSupported = coverage(edges.vertical, right, top, bottom, 2.5 / page.width) >= .85
        || Math.abs(upper.to - lower.to) * page.width <= 2.5;
      if (!rightSupported) continue;
      candidates.push({ bbox, ids: [...new Set([...upper.ids, ...lower.ids, ...adjacent.flatMap((pattern) => pattern.patternProvenance!.sourceLineIds)])] });
    }
  }
  return candidates.sort((a, b) => a.bbox.height - b.bbox.height || b.bbox.width - a.bbox.width)[0] ?? null;
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
    let crossingEdges: EdgeIndex | undefined;
    const specialRoomLabels = labels.filter((item) => ["isolation", "calving", "pens"].includes(classifyAreaLabel(item.text)!));
    const patterns = detectCubiclePatterns(page, specialRoomLabels);
    for (const item of labels) {
      const kind = classifyAreaLabel(item.text)!;
      const strip = patternAdjacentStrip(page, item, labels, edges, patterns);
      // Short cross-passages often terminate precisely at dimensioned door
      // edges. Slashes there can belong to a coincident opening dimension;
      // do not widen that crossing into the neighboring furniture rectangle.
      const crossing = kind === "alley" && /\b(?:atjaro|athajto|quergang|querdurchgang)\b/.test(normalizedLabel(item.text));
      if (crossing && !crossingEdges) crossingEdges = axisEdges(page.lines ?? [], page.width, page.height, false);
      const itemEdges = crossing ? crossingEdges! : edges;
      const bbox = strip?.bbox ?? enclosingBox(page, item, labels, itemEdges);
      if (!bbox) continue;
      if (result.some((area) => area.pageNumber === page.pageNumber && Math.abs(area.bbox.x - bbox.x) < 0.003 && Math.abs(area.bbox.y - bbox.y) < 0.003)) continue;
      const repeated = repeatedStripLabels(page, item, labels, edges);
      const labelDominated = bbox.width < item.bbox.width * 2.5 && bbox.height < item.bbox.height * 8;
      result.push({
        id: `structure-area-${page.pageNumber}-${item.id ?? result.length + 1}`,
        kind, label: AREA_RULES[kind].title, originalLabel: item.text, confidence: strip ? .89 : labelDominated ? 0.82 : 0.91,
        source: "geometry", status: "unconfirmed", pageNumber: page.pageNumber, bbox, hasBbox: true,
        evidence: ["Bereichsart aus eindeutiger PDF-Beschriftung erkannt.", strip
          ? "Vollständiges Gangband aus beidseitigen PDF-Grenzen, belegten Querpassagen und angrenzender nativer Liegeboxenreihe erkannt; offenes Gangende bleibt geometrisch abgeleitet."
          : "Vier umschließende Vektorkanten mit mindestens 90 % Linienabdeckung.",
          ...(repeated.length > 1 ? [`${repeated.length} identische PDF-Beschriftungen entlang desselben Bereichsstreifens.`] : []),
          ...(labelDominated ? ["Kleine Umgrenzung nahe der Beschriftung; vollständigen Bereich prüfen."] : [])],
        originalEvidence: [`PDF-Beschriftung: ${item.text}`],
        ...(strip ? { boundaryAssessment: { method: "vector-side-support" as const, supportedSides: ["top", "bottom"] as Array<"top" | "bottom">,
          sourceLineIds: strip.ids }, stripProvenance: { method: "labelled-cubicle-adjacent-band" as const,
          sourceLineIds: strip.ids, textItemIds: repeated.flatMap((label) => label.id ? [label.id] : []) } } : {}),
      });
    }
    for (const pattern of patterns) {
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
      const supportedStrip = supports.some((support) => support.stripProvenance?.method === "labelled-cubicle-adjacent-band"
        && support.source === "geometry" && !support.geometryCorrections?.length && support.status !== "rejected" && !support.removedAt);
      const verticalOverlap = Math.max(0, Math.min(base.bbox.y + base.bbox.height, area.bbox.y + area.bbox.height) - Math.max(base.bbox.y, area.bbox.y));
      // Native rails and independently proven furniture already describe the
      // full strip. A same-label model fragment or overhang must not shorten it
      // again, create a duplicate or replace its exact supporting coordinates.
      if (supportedStrip && sameLabel && area.source === "ai" && area.status === "unconfirmed"
        && area.bbox.height / base.bbox.height >= .5 && area.bbox.height / base.bbox.height <= 2
        && verticalOverlap / Math.min(base.bbox.height, area.bbox.height) >= .8
        && overlap.intersection / Math.min(overlap.first, overlap.second) >= .85) { handled = true; break; }
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
  // A regular cubicle row and a text-proven manure/feeding lane are exclusive
  // primary functions. Never discard reviewed or customer-shaped geometry.
  // This never discards gates, equipment, customer areas or crossing zones.
  return merged.filter((area) => !(area.source === "ai" && area.status === "unconfirmed" && !area.removedAt
    && !area.geometryCorrections?.length && !area.footprint && !area.contourProvenance
    && area.kind === "cubicles" && merged.some((other) => {
    if (other === area || !["alley", "feeding_area"].includes(other.kind) || other.pageNumber !== area.pageNumber || !other.hasBbox) return false;
    const supported = (nativeSupport.get(other) ?? []).some((support) => {
      if (support.status === "rejected" || support.removedAt || support.geometryCorrections?.length) return false;
      const labelKind = classifyUnambiguousAreaLabel(support.originalLabel ?? "");
      return other.kind === "feeding_area"
        ? (support.confidence ?? 0) >= .9 && labelKind === "feeding_area"
        : labelKind === "alley" && /\b(?:ganek gnojowy|korytarz gnojowy|tragyaut)\b/.test(normalizedLabel(support.originalLabel ?? ""));
    });
    if (!supported) return false;
    const overlap = boxOverlap(area.bbox, other.bbox);
    return overlap.first > 0 && overlap.intersection / overlap.first >= 0.8;
  })));
}
