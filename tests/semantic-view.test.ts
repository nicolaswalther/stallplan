import assert from "node:assert/strict";
import { test } from "node:test";
import { hideNamedHatching } from "../lib/pdf/semantic-view";
import { withAreaImages, withPageImages } from "../lib/ai/context";
import { parseAnalysisRequest } from "../lib/plan/request";
import type { PdfPageData } from "../lib/types";

test("CAD simplification preserves mixed-purpose, hidden and structural layers", () => {
  const layers = new Map([
    ["a", { name: "A-Detl-Patt", visible: true }],
    ["b", { name: "GEA_Kreskowanie_ruszta", visible: true }],
    ["c", { name: "GEA_Kreskowanie_sloma", visible: true }],
    ["d", { name: "Floor_Hatching", visible: false }],
    ["e", { name: "Hatchery", visible: true }],
    ["f", { name: "Dimension_Hatch", visible: true }],
    ["g", { name: "A-Wall", visible: true }],
    ["h", { name: "GEA_Opisy", visible: true }],
  ]);
  const config = { [Symbol.iterator]: () => layers[Symbol.iterator](), setVisibility: (id: string, visible: boolean) => { layers.get(id)!.visible = visible; } };
  assert.deepEqual(hideNamedHatching(config), ["A-Detl-Patt", "GEA_Kreskowanie_ruszta", "GEA_Kreskowanie_sloma"]);
  assert.ok(["e", "f", "g", "h"].every((id) => layers.get(id)!.visible));
  assert.equal(layers.get("d")!.visible, false);
});

test("only area interpretation uses the simplified CAD view; measurements retain original patterns", () => {
  const page: PdfPageData = { pageNumber: 1, width: 2384, height: 1684, text: "STÓŁ PASZOWY", textItems: [],
    imageDataUrl: "data:image/jpeg;base64,b3JpZ2luYWw=", semanticAreaImage: { imageDataUrl: "data:image/jpeg;base64,c2VtYW50aWM=", hiddenLayers: ["A-Detl-Patt"] } };
  const nativeSnapshot = JSON.stringify(page);
  const parsed = parseAnalysisRequest({ fileName: "CAD.pdf", pages: [page] });
  assert.deepEqual(parsed.pages[0].semanticAreaImage, page.semanticAreaImage);
  assert.equal(withAreaImages("Bereiche", parsed.pages).find((part) => part.type === "input_image")?.image_url, page.semanticAreaImage!.imageDataUrl);
  assert.equal(withPageImages("Maße", parsed.pages).find((part) => part.type === "input_image")?.image_url, page.imageDataUrl);
  assert.equal(JSON.stringify(page), nativeSnapshot);
  assert.ok(withAreaImages("Bereiche", [page]).some((part) => part.type === "input_text" && part.text.includes("belegen keinen Bodenbelag")));
});

test("semantic views require bounded inline images and an explicit layer audit", () => {
  const page = { pageNumber: 1, width: 1000, height: 800, text: "", textItems: [] };
  for (const semanticAreaImage of [
    { imageDataUrl: "https://example.com/view.jpg", hiddenLayers: ["hatching"] },
    { imageDataUrl: "data:image/jpeg;base64,a", hiddenLayers: [] },
    { imageDataUrl: `data:image/jpeg;base64,${"a".repeat(3_000_000)}`, hiddenLayers: ["hatching"] },
  ]) assert.throws(() => parseAnalysisRequest({ fileName: "CAD.pdf", pages: [{ ...page, semanticAreaImage }] }));
});
