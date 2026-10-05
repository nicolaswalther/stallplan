import type { PdfPageData } from "./types";
import { extractTextObjects } from "./pdf/text-extraction";
import { classifyDocument, extractVectorLines } from "./pdf/vector-extraction";

export async function parsePdf(file: File): Promise<PdfPageData[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data, useWasm: false });
  const pages: PdfPageData[] = [];
  try {
    const pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const rawViewport = page.getViewport({ scale: 1 });
        const [textRead, geometryRead] = await Promise.allSettled([page.getTextContent(), page.getOperatorList()]);
        const warnings: string[] = [];
        const textItems = textRead.status === "fulfilled"
          ? extractTextObjects(textRead.value.items, textRead.value.styles, rawViewport, pageNumber) : [];
        if (textRead.status === "rejected") warnings.push("PDF-Text konnte nicht gelesen werden; die Planansicht bleibt verfügbar.");
        // Rendering consumes the typed path buffers, so extract geometry first.
        const geometry = geometryRead.status === "fulfilled"
          ? extractVectorLines(geometryRead.value, pdfjs.OPS, rawViewport, pageNumber)
          : { lines: [], imageCount: 0, warnings: ["PDF-Geometrie konnte nicht gelesen werden; Textmaße bleiben verfügbar."] };
        const targetWidth = Math.min(2200, Math.max(1400, rawViewport.width * 1.8));
        const viewport = page.getViewport({ scale: targetWidth / rawViewport.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        pages.push({ pageNumber, width: rawViewport.width, height: rawViewport.height,
          text: textItems.map((item) => item.text).join(" "), textItems,
          lines: geometry.lines, imageCount: geometry.imageCount,
          documentKind: classifyDocument(textItems.length, geometry.lines.length, geometry.imageCount),
          extractionWarnings: [...warnings, ...geometry.warnings], imageDataUrl: canvas.toDataURL("image/jpeg", 0.88) });
      } finally { page.cleanup(); }
    }
    return pages;
  } finally { await loadingTask.destroy(); }
}
