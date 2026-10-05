/** Wheel deltas are normalized across mouse wheels and trackpads. */
export function wheelZoom(current: number, delta: number, mode = 0, viewportHeight = 800): number {
  if (!Number.isFinite(delta)) return current;
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? viewportHeight : 1);
  return Math.min(4, Math.max(0.5, current * Math.exp(-Math.max(-160, Math.min(160, pixels)) * 0.0025)));
}

/** Keep the document coordinate under the cursor after the canvas has resized. */
export function anchoredScroll(normalized: number, canvasSize: number, canvasOffset: number, cursorOffset: number): number {
  return Math.max(0, canvasOffset + normalized * canvasSize - cursorOffset);
}
