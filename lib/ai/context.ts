import type { PdfPageData } from "../types";

export type InputPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" };

export function positionedTextContext(pages: PdfPageData[], maxChars = 32_000) {
  let used = 0;
  const lines: string[] = [];
  for (const page of pages) {
    lines.push(`Seite ${page.pageNumber}, ${page.documentKind ?? "Dokumenttyp unbekannt"}, ${page.width.toFixed(1)}×${page.height.toFixed(1)} PDF-Punkte.`);
    for (const item of page.textItems) {
      const line = `x=${item.bbox.x.toFixed(4)} y=${item.bbox.y.toFixed(4)} w=${item.bbox.width.toFixed(4)} h=${item.bbox.height.toFixed(4)}: ${item.text.replace(/\s+/g, " ").slice(0, 160)}`;
      if (used + line.length > maxChars) return lines.join("\n");
      lines.push(line);
      used += line.length;
    }
  }
  return lines.join("\n");
}

export function imagePages(pages: PdfPageData[]) {
  return pages.filter((page) => page.imageDataUrl).slice(0, 4);
}

export function areaTextContext(pages: PdfPageData[]) {
  // Dense dimension chains are already handled structurally. Semantic analysis
  // needs labels and room indices, including outlined-label plans like Obora.
  return positionedTextContext(pages.map((page) => ({
    ...page,
    textItems: page.textItems.filter((item) => /[\p{L}]/u.test(item.text) || /^\d{1,2}\.$/.test(item.text.trim())),
  })), 14_000);
}

export function withPageImages(prompt: string, pages: PdfPageData[]): InputPart[] {
  const content: InputPart[] = [{ type: "input_text", text: prompt }];
  for (const page of imagePages(pages)) {
    content.push({ type: "input_text", text: `Seitenbild ${page.pageNumber} (Seitenkoordinaten 0..1, links oben):` });
    content.push({ type: "input_image", image_url: page.imageDataUrl, detail: "high" });
  }
  return content;
}
