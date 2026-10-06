// Keep dense CAD geometry intact while fitting common function request limits.
export const MAX_COMPRESSED_ANALYSIS_BYTES = 4 * 1024 * 1024;
export const MAX_DECODED_ANALYSIS_BYTES = 64 * 1024 * 1024;

export class AnalysisBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AnalysisBodyError";
  }
}

export async function encodeAnalysisBody(payload: unknown): Promise<{ body: Blob; headers: Record<string, string> }> {
  const json = new Blob([JSON.stringify(payload)], { type: "application/json" });
  if (json.size > MAX_DECODED_ANALYSIS_BYTES) {
    throw new AnalysisBodyError("Der Plan enthält zu viele Zeichnungsdaten. Bitte einzelne Seiten hochladen.", 413);
  }
  if (json.size < 256 * 1024 || typeof CompressionStream === "undefined") {
    if (json.size > MAX_COMPRESSED_ANALYSIS_BYTES) {
      throw new AnalysisBodyError("Bitte den Plan mit einem aktuellen Browser hochladen.", 413);
    }
    return { body: json, headers: { "Content-Type": "application/json" } };
  }
  const body = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  if (body.size > MAX_COMPRESSED_ANALYSIS_BYTES) {
    throw new AnalysisBodyError("Der Plan enthält zu viele Zeichnungsdaten. Bitte einzelne Seiten hochladen.", 413);
  }
  return { body, headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" } };
}
