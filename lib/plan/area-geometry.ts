import type { NormalizedBox, PlanPoint } from "@/lib/types";

/** Page-normalized rings; holes belong only to their own outer ring. */
export interface AreaFootprint {
  parts: Array<{ outer: PlanPoint[]; holes?: PlanPoint[][] }>;
}

function validBox(box: NormalizedBox) {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.width > 0 && box.height > 0;
}

function validRing(ring: PlanPoint[]) {
  if (ring.length < 3 || !ring.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const twiceArea = ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(twiceArea) > 1e-12;
}

/** Invalid geometry must never hide an otherwise editable rectangular area. */
export function isValidAreaFootprint(footprint: AreaFootprint | undefined): footprint is AreaFootprint {
  return !!footprint?.parts.length && footprint.parts.every((part) => validRing(part.outer)
    && (!part.holes || part.holes.every(validRing)));
}

/** Move/resize the entire geometry together, preserving parts and excluded islands. */
export function transformAreaFootprint(footprint: AreaFootprint, from: NormalizedBox, to: NormalizedBox): AreaFootprint {
  if (!isValidAreaFootprint(footprint) || !validBox(from) || !validBox(to)) return footprint;
  if (from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height) return footprint;
  const transformRing = (ring: PlanPoint[]) => ring.map((point) => ({
    x: to.x + (point.x - from.x) * to.width / from.width,
    y: to.y + (point.y - from.y) * to.height / from.height,
  }));
  return { parts: footprint.parts.map((part) => ({
    outer: transformRing(part.outer),
    ...(part.holes ? { holes: part.holes.map(transformRing) } : {}),
  })) };
}

/** Unit-box SVG path for both clipping and outlines; evenodd excludes every hole. */
export function footprintPathInBox(footprint: AreaFootprint, box: NormalizedBox): string {
  if (!isValidAreaFootprint(footprint) || !validBox(box)) return "";
  const number = (value: number) => String(Math.round(value * 1e9) / 1e9);
  const ringPath = (ring: PlanPoint[]) => ring.map((point, index) => `${index ? "L" : "M"}${number((point.x - box.x) / box.width)},${number((point.y - box.y) / box.height)}`).join(" ") + " Z";
  return footprint.parts.flatMap((part) => [ringPath(part.outer), ...(part.holes ?? []).map(ringPath)]).join(" ");
}

/** Page-point paths keep fills and SVG patterns in the same native coordinate frame. */
export function footprintPathOnPage(footprint: AreaFootprint, width: number, height: number): string {
  if (!isValidAreaFootprint(footprint) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
  const number = (value: number) => String(Math.round(value * 10_000) / 10_000);
  const ringPath = (ring: PlanPoint[]) => ring.map((point, index) => `${index ? "L" : "M"}${number(point.x * width)},${number(point.y * height)}`).join(" ") + " Z";
  return footprint.parts.flatMap((part) => [ringPath(part.outer), ...(part.holes ?? []).map(ringPath)]).join(" ");
}
