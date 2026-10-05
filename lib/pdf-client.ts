import type { PdfPageData } from "./types";

export async function parsePdf(file: File): Promise<PdfPageData[]> {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, useWasm: false }).promise;
  const pages: PdfPageData[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
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
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas-Kontext konnte nicht erstellt werden.");

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    pages.push({
      pageNumber,
      width: rawViewport.width,
      height: rawViewport.height,
      text,
      imageDataUrl: canvas.toDataURL("image/jpeg", 0.78),
    });

    page.cleanup();
  }

  await pdf.destroy();
  return pages;
}
