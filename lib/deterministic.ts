import type { Measurement, NormalizedBox, PdfPageData, PdfTextItem } from "./types";

const measurementPattern = /(?<![\d.,])((?:\d{1,5})(?:[.,]\d{1,3})?)\s*(mm|cm|m)\b/gi;

function unionBoxes(boxes: NormalizedBox[]): NormalizedBox {
  const x1 = Math.min(...boxes.map((box) => box.x));
  const y1 = Math.min(...boxes.map((box) => box.y));
  const x2 = Math.max(...boxes.map((box) => box.x + box.width));
  const y2 = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: Math.max(0, x1),
    y: Math.max(0, y1),
    width: Math.min(1 - x1, x2 - x1),
    height: Math.min(1 - y1, y2 - y1),
  };
}

function parseValue(raw: string, unit: "m" | "cm" | "mm") {
  const normalized = raw.replace(/\s/g, "");

  if (normalized.includes(",")) {
    return Number(normalized.replace(/\./g, "").replace(",", "."));
  }

  // German technical drawings commonly write e.g. "1.250 mm".
  if (unit === "mm" && /^\d{1,2}\.\d{3}$/.test(normalized)) {
    return Number(normalized.replace(".", ""));
  }

  return Number(normalized);
}

function nearbyContext(items: PdfTextItem[], box: NormalizedBox) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  return items
    .filter((item) => {
      const x = item.bbox.x + item.bbox.width / 2;
      const y = item.bbox.y + item.bbox.height / 2;
      return Math.abs(x - centerX) < 0.16 && Math.abs(y - centerY) < 0.055;
    })
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function candidateWindows(items: PdfTextItem[]) {
  const sorted = [...items].sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > 0.008) return dy;
    return a.bbox.x - b.bbox.x;
  });

  const windows: Array<{ text: string; bbox: NormalizedBox }> = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const first = sorted[index];
    windows.push({ text: first.text, bbox: first.bbox });

    let text = first.text;
    const boxes = [first.bbox];
    let right = first.bbox.x + first.bbox.width;

    for (let offset = 1; offset <= 2; offset += 1) {
      const next = sorted[index + offset];
      if (!next) break;

      const sameLine = Math.abs(next.bbox.y - first.bbox.y) < Math.max(0.012, first.bbox.height * 1.2);
      const close = next.bbox.x - right < 0.035 && next.bbox.x >= first.bbox.x - 0.01;
      if (!sameLine || !close) break;

      text += ` ${next.text}`;
      boxes.push(next.bbox);
      right = Math.max(right, next.bbox.x + next.bbox.width);
      windows.push({ text, bbox: unionBoxes(boxes) });
    }
  }

  return windows;
}

export function extractDeterministicMeasurements(pages: PdfPageData[]): Measurement[] {
  const measurements: Measurement[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const candidate of candidateWindows(page.textItems)) {
      for (const match of candidate.text.matchAll(measurementPattern)) {
        const unit = match[2].toLowerCase() as "m" | "cm" | "mm";
        const value = parseValue(match[1], unit);
        if (!Number.isFinite(value) || value <= 0) continue;

        const spatialKey = [
          page.pageNumber,
          value,
          unit,
          Math.round(candidate.bbox.x * 50),
          Math.round(candidate.bbox.y * 50),
        ].join(":");

        if (seen.has(spatialKey)) continue;
        seen.add(spatialKey);

        const context = nearbyContext(page.textItems, candidate.bbox);

        measurements.push({
          id: `pdf-${page.pageNumber}-${measurements.length + 1}`,
          key: `dimension_${measurements.length + 1}`,
          label: "Planmaß",
          value,
          unit,
          source: "pdf-text",
          status: "unconfirmed",
          confidence: 1,
          pageNumber: page.pageNumber,
          bbox: candidate.bbox,
          evidence: context || match[0],
        });
      }
    }
  }

  return measurements.slice(0, 120);
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
