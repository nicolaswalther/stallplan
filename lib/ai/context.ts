import type { PdfPageData } from "../types";
import { detectRoomNumberAnchors } from "../geometry/semantic-regions";
import { MAX_AREA_DETAIL_IMAGES } from "../pdf/analysis-tiles";

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

export function roomNumberContext(pages: PdfPageData[]) {
  return pages.flatMap((page) => {
    const anchors = detectRoomNumberAnchors(page).slice(0, 100);
    return anchors.length ? [`Seite ${page.pageNumber}: DIREKTE PDF-Raumkennzeichen mit Punkt (keine Maße, Nummer niemals schätzen): ${JSON.stringify(anchors.map(({ number, bbox, textItemId }) => ({ number, bbox, textItemId })))}`] : [];
  }).join("\n");
}

export function withPageImages(prompt: string, pages: PdfPageData[]): InputPart[] {
  const content: InputPart[] = [{ type: "input_text", text: prompt }];
  for (const page of imagePages(pages)) {
    content.push({ type: "input_text", text: `Seitenbild ${page.pageNumber} (Seitenkoordinaten 0..1, links oben):` });
    content.push({ type: "input_image", image_url: page.imageDataUrl, detail: "high" });
  }
  return content;
}

/** Detail images are semantic evidence only; measurements keep their own input. */
export function withAreaImages(prompt: string, pages: PdfPageData[]): InputPart[] {
  const content = withPageImages(prompt, pages.map((page) => ({ ...page, imageDataUrl: page.semanticAreaImage?.imageDataUrl ?? page.imageDataUrl })));
  for (const page of imagePages(pages)) if (page.semanticAreaImage) {
    content.push({ type: "input_text", text: `Seite ${page.pageNumber}: Nur ausdrücklich benannte Schraffurlayer wurden im Bereichsbild ausgeblendet. Wände, Einrichtungen, Maßlinien und native Textkoordinaten bleiben erhalten. Dieses vereinfachte Bild dient der Bereichsklassifikation; fehlende Bodenschraffuren belegen keinen Bodenbelag.` });
  }
  let details = 0;
  for (const page of imagePages(pages)) for (const crop of (page.areaDetailImages ?? []).slice(0, MAX_AREA_DETAIL_IMAGES)) {
    if (details >= MAX_AREA_DETAIL_IMAGES) break;
    details++;
    content.push({ type: "input_text", text: `Bereichsdetail ${details} auf Seite ${page.pageNumber}: direkt aus dem ursprünglichen PDF gerenderter überlappender Ausschnitt (${crop.pixelWidth}×${crop.pixelHeight} Pixel). Globale Seitenbox=${JSON.stringify(crop.bbox)}. Der Ausschnitt ist KEIN eigener Stallbereich und KEINE zusätzliche Seite. Ergebnisboxen bleiben immer in den globalen Koordinaten der vollständigen Seite: x_global=box.x+x_lokal*box.width, y_global=box.y+y_lokal*box.height, Breite_global=Breite_lokal*box.width, Höhe_global=Höhe_lokal*box.height. Überlappende Ausschnitte zeigen dieselben Objekte; Bereiche nicht doppelt zählen. Bereits vorhandene PDF-Texte, Textkoordinaten, Maßwerte, Einheiten und Vektorgeometrien nicht aus Bildpixeln schätzen oder ersetzen. Diese Bilder ergänzen ausschließlich die semantische Bereichsanalyse.` });
    content.push({ type: "input_image", image_url: crop.imageDataUrl, detail: "high" });
  }
  for (const page of imagePages(pages)) for (const crop of (page.semanticDetails ?? []).slice(0, 2)) {
    if (details >= MAX_AREA_DETAIL_IMAGES) break;
    details++;
    content.push({ type: "input_text", text: `Hochauflösender Beschriftungsausschnitt auf Seite ${page.pageNumber}, automatisch anhand kurzer PDF-Vektorzüge gefunden. Ursprüngliche Seitenbox=${JSON.stringify(crop.bbox)}. Dies ist KEINE Stallfläche. Alle Ergebnisboxen bleiben globale Koordinaten der vollständigen Seite.` });
    content.push({ type: "input_image", image_url: crop.imageDataUrl, detail: "high" });
  }
  return content;
}
