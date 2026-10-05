import type { PdfPageData, PdfTextItem } from "./types";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

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
        const textContent = await page.getTextContent();

        const textItems: PdfTextItem[] = textContent.items.flatMap((item) => {
          if (!("str" in item) || !item.str.trim()) return [];

          const transformed = pdfjs.Util.transform(rawViewport.transform, item.transform);
          const fontHeight = Math.max(1, Math.hypot(transformed[2], transformed[3]));
          const width = Math.max(1, item.width);

          return [
            {
              text: item.str.trim(),
              bbox: {
                x: clamp01(transformed[4] / rawViewport.width),
                y: clamp01((transformed[5] - fontHeight) / rawViewport.height),
                width: clamp01(width / rawViewport.width),
                height: clamp01(fontHeight / rawViewport.height),
              },
            },
          ];
        });

        const text = textItems.map((item) => item.text).join(" ");

        // A slightly denser render keeps small dimensions legible for Vision
        // without sending huge multi-megabyte pages to the API.
        const targetWidth = Math.min(2000, Math.max(1400, rawViewport.width * 1.8));
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
          textItems,
          imageDataUrl: canvas.toDataURL("image/jpeg", 0.88),
        });
      } finally {
        page.cleanup();
      }
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
