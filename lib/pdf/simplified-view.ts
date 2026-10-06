import type { PdfLine, PdfPageData } from "../types";

export type SimplifiedPathKind = "structure" | "detail";
export type HiddenVectorReason = "named-hatching" | "named-annotation";

export interface SimplifiedVectorPath {
  kind: SimplifiedPathKind;
  /** Actual PDF-point coordinates, for viewBox="0 0 width height". */
  d: string;
  /** Every source segment, including coincident segments drawn once. */
  sourceLineIds: string[];
}

export interface SimplifiedPlan {
  available: boolean;
  width: number;
  height: number;
  paths: SimplifiedVectorPath[];
  hidden: Array<{ reason: HiddenVectorReason; sourceLineIds: string[] }>;
  stats: {
    nativeLines: number;
    structuralLines: number;
    detailLines: number;
    hiddenHatchingLines: number;
    hiddenAnnotationLines: number;
    invalidLines: number;
    renderedSegments: number;
  };
}

export interface SimplifiedPlanOptions {
  /** Optional layer names read from the PDF, never inferred from geometry. */
  lineLayerNames?: Readonly<Record<string, string>>;
}

const MAX_SEGMENTS_PER_PATH = 8_000;
const FINE_DETAIL_LENGTH_POINTS = 8;
const STRUCTURAL_LAYER = /(?:^|[^a-z])(?:wall|walls|door|doors|gate|gates|bramki|equipment|ausstattung|wyposażenie|cubicles?)(?:$|[^a-z])/i;
const HATCHING_LAYER = /(?:^|[^a-z])(?:hatch(?:ing)?|schraff(?:ur|uren|ierung|ierungen)?|kreskowanie|patt)(?:$|[^a-z])/i;
const ANNOTATION_LAYER = /(?:^|[^a-z])(?:titleblock(?:text)?|grid(?:[-_ ]iden)?|dimensions?|dim|annotations?|labels?|opisy)(?:$|[^a-z])/i;
const MIXED_HATCHING_LAYER = /(?:^|[^a-z])(?:text|label|dimension|dim|wall|door|gate|equipment|symbol|opis)(?:$|[^a-z])/i;

/** Only explicit, single-purpose CAD layer names justify hiding whole layers. */
export function hiddenVectorLayerReason(name: string | undefined): HiddenVectorReason | null {
  if (!name || STRUCTURAL_LAYER.test(name)) return null;
  if (HATCHING_LAYER.test(name) && !MIXED_HATCHING_LAYER.test(name)) return "named-hatching";
  if (ANNOTATION_LAYER.test(name) && !HATCHING_LAYER.test(name)) return "named-annotation";
  return null;
}

function validLine(line: PdfLine) {
  return [line.start.x, line.start.y, line.end.x, line.end.y].every((value) => Number.isFinite(value) && value >= -.01 && value <= 1.01)
    && (line.start.x !== line.end.x || line.start.y !== line.end.y);
}

function point(value: number) {
  // Rounding affects this display string only. All original geometry stays intact.
  return String(Math.round(value * 10_000) / 10_000);
}

/**
 * A reversible drawing aid, not a reconstructed floor plan or wall detector.
 * Every valid native segment remains either in a bundled path or an audited
 * hidden layer. Short unknown strokes are merely subdued as detail: length
 * cannot distinguish a glyph, a hatch or small equipment reliably. In
 * particular regular cubicle dividers are never classified as hatching.
 * Rendering is O(n), with a bounded number of SVG elements instead of one
 * element per PDF segment. Raster images and Bezier ink cannot be recreated
 * from PdfLine and are deliberately not invented here.
 */
export function buildSimplifiedPlan(page: PdfPageData, options: SimplifiedPlanOptions = {}): SimplifiedPlan {
  const stats: SimplifiedPlan["stats"] = { nativeLines: page.lines?.length ?? 0, structuralLines: 0, detailLines: 0,
    hiddenHatchingLines: 0, hiddenAnnotationLines: 0, invalidLines: 0, renderedSegments: 0 };
  const result: SimplifiedPlan = { available: false, width: page.width, height: page.height, paths: [], hidden: [], stats };
  if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) return result;
  // Native axes or a title border do not make a scanned floor plan available
  // as vectors. Keep the original when important raster content would vanish;
  // small, completely mapped equipment symbols can still use the vector view.
  if (page.documentKind === "raster"
    || (page.imageCount && page.rasterGeometryComplete === false)
    || page.rasterImages?.some((box) => Number.isFinite(box.width) && Number.isFinite(box.height)
      && box.width > 0 && box.height > 0 && box.width * box.height >= .25)) return result;
  const hidden = new Map<HiddenVectorReason, string[]>();
  const groups = new Map<SimplifiedPathKind, { chunks: string[]; sourceLineIds: string[]; drawn: Map<string, string[]> }>();
  const flush = (kind: SimplifiedPathKind) => {
    const group = groups.get(kind);
    if (!group?.chunks.length) return;
    result.paths.push({ kind, d: group.chunks.join(""), sourceLineIds: group.sourceLineIds });
    group.chunks = []; group.sourceLineIds = [];
  };
  for (const line of page.lines ?? []) {
    if (!validLine(line)) { stats.invalidLines++; continue; }
    const layerName = options.lineLayerNames?.[line.id] ?? line.layerName;
    const reason = hiddenVectorLayerReason(layerName);
    if (reason) {
      const ids = hidden.get(reason) ?? [];
      ids.push(line.id); hidden.set(reason, ids);
      if (reason === "named-hatching") stats.hiddenHatchingLines++; else stats.hiddenAnnotationLines++;
      continue;
    }
    const length = Math.hypot((line.end.x - line.start.x) * page.width, (line.end.y - line.start.y) * page.height);
    const kind: SimplifiedPathKind = length >= FINE_DETAIL_LENGTH_POINTS || Boolean(layerName && STRUCTURAL_LAYER.test(layerName)) ? "structure" : "detail";
    if (kind === "structure") stats.structuralLines++; else stats.detailLines++;
    let group = groups.get(kind);
    if (!group) { group = { chunks: [], sourceLineIds: [], drawn: new Map() }; groups.set(kind, group); }
    // Coincident strokes share one display segment while retaining each ID.
    const first = `${line.start.x},${line.start.y}`, last = `${line.end.x},${line.end.y}`;
    const key = first < last ? `${first};${last}` : `${last};${first}`;
    const coincidentSources = group.drawn.get(key);
    if (coincidentSources) { coincidentSources.push(line.id); continue; }
    group.sourceLineIds.push(line.id);
    group.drawn.set(key, group.sourceLineIds);
    group.chunks.push(`M${point(line.start.x * page.width)} ${point(line.start.y * page.height)}L${point(line.end.x * page.width)} ${point(line.end.y * page.height)}`);
    stats.renderedSegments++;
    if (group.chunks.length >= MAX_SEGMENTS_PER_PATH) flush(kind);
  }
  for (const kind of groups.keys()) flush(kind);
  result.hidden = [...hidden].map(([reason, sourceLineIds]) => ({ reason, sourceLineIds }));
  result.available = result.paths.some((path) => path.kind === "structure");
  return result;
}
