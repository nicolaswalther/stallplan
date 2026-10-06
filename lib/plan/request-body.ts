import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { AnalysisBodyError, MAX_COMPRESSED_ANALYSIS_BYTES, MAX_DECODED_ANALYSIS_BYTES } from "./transport";

const decompress = promisify(gunzip);

/** Streaming bounds also apply when Content-Length is absent or inaccurate. */
export async function readAnalysisBody(request: Request, limits = {
  compressed: MAX_COMPRESSED_ANALYSIS_BYTES, decoded: MAX_DECODED_ANALYSIS_BYTES,
}): Promise<unknown> {
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase() ?? "identity";
  if (encoding !== "gzip" && encoding !== "identity") {
    throw new AnalysisBodyError("Nicht unterstützte Analyse-Daten.", 415);
  }
  const maxBytes = encoding === "gzip" ? limits.compressed : limits.decoded;
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Empty analysis body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AnalysisBodyError("Der Plan enthält zu viele Zeichnungsdaten. Bitte einzelne Seiten hochladen.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let bytes: Uint8Array = Buffer.concat(chunks, size);
  if (encoding === "gzip") {
    try {
      bytes = await decompress(bytes, { maxOutputLength: limits.decoded });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        throw new AnalysisBodyError("Der Plan enthält zu viele Zeichnungsdaten. Bitte einzelne Seiten hochladen.", 413);
      }
      throw new AnalysisBodyError("Ungültige komprimierte Analyse-Daten.", 400);
    }
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SyntaxError("Invalid analysis JSON");
  }
}
