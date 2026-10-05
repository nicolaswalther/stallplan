import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { extractTextObjects } from "../lib/pdf/text-extraction";
import { classifyDocument, extractVectorLines } from "../lib/pdf/vector-extraction";
import { extractDeterministicMeasurements } from "../lib/deterministic";
import { evaluateMeasurements, type ReferenceMeasurement } from "../lib/evaluation/measurements";
import { evaluateStructure } from "../lib/evaluation/structure";
import type { PdfPageData } from "../lib/types";

async function main() {
  const [pdfPath, referencePath = "tests/fixtures/obora-reference.json", outputPath] = process.argv.slice(2);
  if (!pdfPath) throw new Error("Usage: npm run evaluate -- <PDF> [reference.json] [output.json]");
  const data = await readFile(pdfPath);
  const reference = JSON.parse(await readFile(referencePath, "utf8"));
  const hash = createHash("sha256").update(data).digest("hex");
  if (reference.document.sha256 !== hash) throw new Error("PDF hash does not match the independently reviewed reference.");
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useWasm: false });
  const pages: PdfPageData[] = [];
  const started = performance.now();
  try {
    const pdf = await task.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const [text, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
        const textItems = extractTextObjects(text.items, text.styles, viewport, pageNumber);
        const geometry = extractVectorLines(operators, pdfjs.OPS, viewport, pageNumber);
        pages.push({ pageNumber, width: viewport.width, height: viewport.height,
          textItems, text: textItems.map((item) => item.text).join(" "),
          lines: geometry.lines, imageCount: geometry.imageCount, extractionWarnings: geometry.warnings,
          documentKind: classifyDocument(textItems.length, geometry.lines.length, geometry.imageCount), imageDataUrl: "" });
      } finally { page.cleanup(); }
    }
  } finally { await task.destroy(); }
  const measurements = extractDeterministicMeasurements(pages);
  const expected: ReferenceMeasurement[] = reference.measurements.map((item: {
    id: string; value: number; unit: ReferenceMeasurement["unit"]; page: number; bbox: number[]; chainId?: string;
  }) => ({ id: item.id, value: item.value, unit: item.unit, pageNumber: item.page,
    bbox: { x: item.bbox[0], y: item.bbox[1], width: item.bbox[2], height: item.bbox[3] }, chainId: item.chainId }));
  const metrics = evaluateMeasurements(measurements, expected);
  const structureMetrics = evaluateStructure(measurements, reference, metrics.matches);
  const output = { documentHash: hash, durationMs: Math.round(performance.now() - started),
    pages: pages.map((page) => ({ pageNumber: page.pageNumber, kind: page.documentKind,
      textObjectCount: page.textItems.length, lineCount: page.lines?.length, warnings: page.extractionWarnings })),
    metrics, structureMetrics, measurements };
  if (outputPath) await writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...output, measurements: undefined, metrics: { ...metrics, matches: undefined,
    missing: metrics.missing.map((item) => ({ id: item.id, value: item.value, page: item.pageNumber })),
    falsePositives: metrics.falsePositives.map((item) => ({ id: item.id, value: item.value, unit: item.unit, evidence: item.evidence })),
  } }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Evaluation failed"); process.exitCode = 1; });
