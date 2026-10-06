import type { NormalizedBox } from "../types";

/** Only wide drawing sheets need this extra semantic view. Normal plans keep
 * their established rendering and image inputs. */
export const AREA_DETAIL_ASPECT_THRESHOLD = 2.4;
export const MAX_AREA_DETAIL_IMAGES = 4;
export const MAX_AREA_DETAIL_EDGE = 1800;
export const MAX_AREA_DETAIL_PIXELS = 2_000_000;
export const MAX_AREA_DETAIL_IMAGE_LENGTH = 3_000_000;
const PREFERRED_TILE_ASPECT = 1.5;
const OVERLAP_FRACTION = 0.1;

/** Deterministic full-height tiles, independent of filename, text, detected
 * areas or model output. Ten percent overlap preserves boundary context. */
export function planAreaDetailTiles(width: number, height: number, budget = MAX_AREA_DETAIL_IMAGES): NormalizedBox[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
    !Number.isInteger(budget) || budget < 2 || width / height <= AREA_DETAIL_ASPECT_THRESHOLD) return [];
  const ideal = Math.ceil((width / height / PREFERRED_TILE_ASPECT - OVERLAP_FRACTION) / (1 - OVERLAP_FRACTION));
  const count = Math.min(MAX_AREA_DETAIL_IMAGES, budget, Math.max(2, ideal));
  const tileWidth = 1 / (count - (count - 1) * OVERLAP_FRACTION);
  return Array.from({ length: count }, (_, index) => ({
    x: index === count - 1 ? 1 - tileWidth : index * tileWidth * (1 - OVERLAP_FRACTION),
    y: 0, width: tileWidth, height: 1,
  }));
}

/** Native PDF scale, never enlarged from the overview JPEG. Bounds control the
 * physical canvas allocation even for a very large technical drawing. The
 * returned box describes exactly the pixels rendered after integer rounding. */
export function areaDetailRenderGeometry(width: number, height: number, box: NormalizedBox) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
    !Object.values(box).every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
    box.x + box.width > 1 + 1e-12 || box.y + box.height > 1 + 1e-12) return null;
  const cropWidth = box.width * width, cropHeight = box.height * height;
  const scale = Math.min(6, MAX_AREA_DETAIL_EDGE / Math.max(cropWidth, cropHeight),
    Math.sqrt(MAX_AREA_DETAIL_PIXELS / (cropWidth * cropHeight)));
  const pixelWidth = Math.max(1, Math.floor(cropWidth * scale));
  const pixelHeight = Math.max(1, Math.floor(cropHeight * scale));
  return {
    scale, pixelWidth, pixelHeight,
    bbox: { x: box.x, y: box.y, width: Math.min(box.width, pixelWidth / (width * scale)),
      height: Math.min(box.height, pixelHeight / (height * scale)) },
    transform: [1, 0, 0, 1, -box.x * width * scale, -box.y * height * scale] as [number, number, number, number, number, number],
  };
}
