import type { Measurement, PdfPageData } from "./types";
import { analyzeMeasurements } from "./analysis/measurements";

export function extractDeterministicMeasurements(pages: PdfPageData[]): Measurement[] {
  return pages.flatMap(analyzeMeasurements);
}

export function findPlanTerms(pages: PdfPageData[]) {
  const terms = ["futtertisch", "fressplatz", "liegebox", "laufgang", "abkalb", "tor", "durchgang", "melk", "kälber"];
  return pages.flatMap((page) => terms.filter((term) => page.text.toLowerCase().includes(term)).map((term) => ({ term, pageNumber: page.pageNumber })));
}
