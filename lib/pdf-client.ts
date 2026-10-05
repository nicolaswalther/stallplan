import type { PdfPageData } from "./types";

export async function parsePdf(file: File): Promise<PdfPageData[]> {
  // Use PDF.js' legacy browser build for broader browser compatibility.
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
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .filter(Boolean)
          .join(" ");

        const rawViewport = page.getViewport({ scale: 1 });
        const targetWidth = Math.min(1500, Math.max(900, rawViewport.width * 1.4));
        const renderScale = targetWidth / rawViewport.width;
        const viewport = page.getViewport({ scale: renderScale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        await page.render({
          canvas,
          viewport,
        }).promise;

        pages.push({
          pageNumber,
          width: rawViewport.width,
          height: rawViewport.height,
          text,
          imageDataUrl: canvas.toDataURL("image/jpeg", 0.78),
        });
      } finally {
        page.cleanup();
      }
    }

    return pages;
  } finally {
    // In PDF.js 6 the documented lifecycle owner is PDFDocumentLoadingTask.
    // Destroying it releases the worker and document resources safely.
    await loadingTask.destroy();
  }
}
