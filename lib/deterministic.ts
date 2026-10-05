import type { Measurement, PdfPageData } from "./types";

const measurementPattern = /(?<!\d)(\d{1,4}(?:[.,]\d{1,3})?)\s*(mm|cm|m)\b/gi;

export function extractDeterministicMeasurements(pages: PdfPageData[]): Measurement[] {
  const seen = new Set<string>();
  const measurements: Measurement[] = [];

  for (const page of pages) {
    for (const match of page.text.matchAll(measurementPattern)) {
      const rawValue = match[1]?.replace(",", ".");
      const unit = match[2]?.toLowerCase() as "m" | "cm" | "mm";
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;

      const normalized = `${value}-${unit}-p${page.pageNumber}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const start = Math.max(0, (match.index ?? 0) - 36);
      const end = Math.min(page.text.length, (match.index ?? 0) + match[0].length + 36);
      const context = page.text.slice(start, end).replace(/\s+/g, " ").trim();

      measurements.push({
        id: `pdf-${page.pageNumber}-${measurements.length + 1}`,
        key: `dimension_${measurements.length + 1}`,
        label: "Maß aus PDF-Text",
        value,
        unit,
        source: "pdf-text",
        status: "unconfirmed",
        confidence: 1,
        pageNumber: page.pageNumber,
        evidence: context || match[0],
      });
    }
  }

  return measurements.slice(0, 40);
}

export function findPlanTerms(pages: PdfPageData[]) {
  const terms = [
    "futtertisch",
    "fressplatz",
    "liegebox",
    "laufgang",
    "abkalb",
    "tor",
    "durchgang",
    "melk",
    "kälber",
  ];

  return pages.flatMap((page) => {
    const text = page.text.toLowerCase();
    return terms
      .filter((term) => text.includes(term))
      .map((term) => ({ term, pageNumber: page.pageNumber }));
  });
}
