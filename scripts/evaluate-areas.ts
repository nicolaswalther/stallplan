import { readFile, writeFile } from "node:fs/promises";
import {
  evaluateAreaRuns, type AreaEvaluationRun, type AreaFootprint, type EvaluationArea, type ReferenceArea,
} from "../lib/evaluation/areas";
import type { NormalizedBox } from "../lib/types";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;

function areas(value: unknown): EvaluationArea[] {
  if (!Array.isArray(value)) throw new Error("Each run requires an areas array.");
  return value.filter((item) => object(item)?.status !== "rejected").map((item) => {
    const area = object(item);
    if (!area || typeof area.id !== "string" || typeof area.kind !== "string") throw new Error("Area IDs and kinds must be strings.");
    const bbox = object(area.bbox);
    return {
      id: area.id, kind: area.kind, pageNumber: Number(area.pageNumber),
      bbox: area.hasBbox === false || !bbox ? { x: Number.NaN, y: Number.NaN, width: 0, height: 0 } :
        { x: Number(bbox.x), y: Number(bbox.y), width: Number(bbox.width), height: Number(bbox.height) } as NormalizedBox,
      confidence: typeof area.confidence === "number" ? area.confidence : null,
      // Explicit interchange format only; never guess units or a model schema.
      footprint: area.footprint ? area.footprint as AreaFootprint : undefined,
    };
  });
}

function runs(value: unknown): AreaEvaluationRun[] {
  const payload = object(value);
  const array = Array.isArray(payload?.runs) ? payload.runs : [value];
  return array.map((item, index) => {
    const run = object(item);
    if (!run) throw new Error("Analysis must be an object or a {runs:[...]} manifest.");
    const metadata = { ...(object(run.metadata) ?? {}), ...Object.fromEntries(
      ["variant", "requestedModel", "run", "sourceHash", "inputHash"].flatMap((key) => run[key] === undefined ? [] : [[key, run[key]]]),
    ) };
    return {
      id: typeof run.id === "string" ? run.id : `run-${index + 1}`,
      model: typeof run.model === "string" ? run.model : typeof run.actualModel === "string" ? run.actualModel : undefined,
      areas: areas(run.areas),
      durationMs: typeof run.durationMs === "number" ? run.durationMs : typeof run.latencyMs === "number" ? run.latencyMs : undefined,
      usage: run.usage, metadata,
    };
  });
}

async function main() {
  const [analysisPath, referencePath = "tests/fixtures/obora-areas-reference.json", outputPath] = process.argv.slice(2);
  if (!analysisPath) throw new Error("Usage: npx tsx scripts/evaluate-areas.ts <analysis.json|runs.json> [reference.json] [output.json]");
  const [analysis, reference] = await Promise.all([readFile(analysisPath, "utf8"), readFile(referencePath, "utf8")]);
  const fixture = JSON.parse(reference) as { schemaVersion: string; document: { sha256: string }; review: unknown; areas: ReferenceArea[]; excludedAreas?: ReferenceArea[]; unscoredKinds?: string[] };
  if (fixture.schemaVersion !== "area-reference/1.0" || !Array.isArray(fixture.areas)) throw new Error("Unsupported area reference schema.");
  const payload = JSON.parse(analysis);
  const claimedHash = object(payload)?.documentSha256 ?? object(payload)?.documentHash;
  if (claimedHash && claimedHash !== fixture.document.sha256) throw new Error("Run document hash does not match the reviewed reference.");
  const output = {
    documentSha256: fixture.document.sha256, referenceReview: fixture.review,
    claimedDocumentHashMatchesReference: Boolean(claimedHash),
    ...evaluateAreaRuns(runs(payload), fixture.areas, { excludedReferences: fixture.excludedAreas, unscoredKinds: fixture.unscoredKinds }),
  };
  if (outputPath) await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Area evaluation failed."); process.exitCode = 1; });
