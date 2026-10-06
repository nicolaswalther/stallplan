import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaDetailRenderGeometry, MAX_AREA_DETAIL_EDGE, MAX_AREA_DETAIL_IMAGES, MAX_AREA_DETAIL_PIXELS, planAreaDetailTiles,
} from "../lib/pdf/analysis-tiles";
import { withAreaImages, withPageImages } from "../lib/ai/context";
import type { PdfAreaDetailImage, PdfPageData } from "../lib/types";

test("only very wide pages receive bounded overlapping coverage, independent of document content", () => {
  for (const [width, height] of [[1843, 1191], [2384, 1684], [841.92, 1190.52], [2400, 1000]]) {
    assert.deepEqual(planAreaDetailTiles(width, height), []);
  }
  for (const [width, height, count] of [[5952.76, 1683.78, 3], [7653.54, 1683.78, 4], [100_000, 1000, 4]]) {
    const tiles = planAreaDetailTiles(width, height);
    assert.equal(tiles.length, count);
    assert.equal(tiles[0].x, 0);
    assert.equal(tiles.at(-1)!.x + tiles.at(-1)!.width, 1);
    for (let i = 0; i < tiles.length; i++) {
      assert.equal(tiles[i].y, 0); assert.equal(tiles[i].height, 1);
      assert.ok(tiles[i].x >= 0 && tiles[i].x + tiles[i].width <= 1);
      if (i) assert.ok(tiles[i].x < tiles[i - 1].x + tiles[i - 1].width, "overlap prevents a blind boundary gap");
    }
    assert.deepEqual(planAreaDetailTiles(width, height), tiles);
  }
});

test("tile budget and invalid dimensions never create an incomplete single detail or unbounded allocation", () => {
  for (const budget of [0, 1, -1, .5, Number.NaN]) assert.deepEqual(planAreaDetailTiles(6000, 1600, budget), []);
  assert.equal(planAreaDetailTiles(6000, 1600, 2).length, 2);
  assert.equal(planAreaDetailTiles(100_000, 1600, 100).length, MAX_AREA_DETAIL_IMAGES);
  for (const [width, height] of [[0, 1000], [1000, 0], [Number.NaN, 1000], [Infinity, 1000], [-1, 1000]]) {
    assert.deepEqual(planAreaDetailTiles(width, height), []);
  }
});

test("native render scales obey physical pixel limits and preserve exact global pixel mapping", () => {
  for (const [width, height] of [[5952.76, 1683.78], [7653.54, 1683.78], [1_000_000, 10_000]]) {
    for (const box of planAreaDetailTiles(width, height)) {
      const r = areaDetailRenderGeometry(width, height, box)!;
      assert.ok(r.scale > 0 && r.scale <= 6);
      assert.ok(r.pixelWidth <= MAX_AREA_DETAIL_EDGE && r.pixelHeight <= MAX_AREA_DETAIL_EDGE);
      assert.ok(r.pixelWidth * r.pixelHeight <= MAX_AREA_DETAIL_PIXELS);
      assert.equal(r.transform[4], -box.x * width * r.scale);
      assert.equal(r.transform[5], -box.y * height * r.scale);
      assert.ok(Math.abs(r.bbox.width * width * r.scale - r.pixelWidth) < 1e-7);
      assert.ok(Math.abs(r.bbox.height * height * r.scale - r.pixelHeight) < 1e-7);
      assert.ok(r.bbox.x + r.bbox.width <= 1 + 1e-12);
    }
  }
  assert.equal(areaDetailRenderGeometry(1000, 800, { x: .9, y: 0, width: .2, height: 1 }), null);
  assert.equal(areaDetailRenderGeometry(0, 800, { x: 0, y: 0, width: 1, height: 1 }), null);
});

function tile(index: number): PdfAreaDetailImage {
  return { bbox: { x: index / 5, y: 0, width: .25, height: .999 },
    imageDataUrl: `data:image/jpeg;base64,dGlsZQ${index}=`, pixelWidth: 1500, pixelHeight: 1200 };
}
function page(number: number, tiles: PdfAreaDetailImage[]): PdfPageData {
  return { pageNumber: number, width: 7653, height: 1684, text: "Futtertisch", textItems: [],
    imageDataUrl: `data:image/jpeg;base64,cGFnZQ${number}=`, areaDetailImages: tiles };
}

test("area details retain supplied global mapping and share a four-image context budget", () => {
  const pages = [page(1, [tile(0), tile(1), tile(2)]), page(2, [tile(0), tile(1), tile(2)])];
  pages[0].semanticDetails = [{ kind: "outline-text", bbox: { x: .1, y: .1, width: .1, height: .1 },
    imageDataUrl: "data:image/png;base64,c2NoZWR1bGU=", sourceLineIds: ["glyph"], sourceLineCount: 12, rowCount: 4 }];
  const snapshot = JSON.stringify(pages), input = withAreaImages("Bereiche", pages);
  const images = input.filter((part) => part.type === "input_image");
  assert.equal(images.length, 2 + MAX_AREA_DETAIL_IMAGES);
  assert.equal(images[2].image_url, pages[0].areaDetailImages![0].imageDataUrl);
  assert.equal(images[5].image_url, pages[1].areaDetailImages![0].imageDataUrl);
  const descriptions = input.filter((part) => part.type === "input_text").map((part) => part.text).join("\n");
  assert.ok(descriptions.includes(JSON.stringify(pages[0].areaDetailImages![0].bbox)));
  assert.ok(descriptions.includes("x_global=box.x+x_lokal*box.width"));
  assert.ok(descriptions.includes("Bereiche nicht doppelt zählen"));
  assert.ok(descriptions.includes("Vektorgeometrien nicht aus Bildpixeln schätzen oder ersetzen"));
  assert.equal(JSON.stringify(pages), snapshot);
});

test("measurements keep original whole pages, with no area tile or semantic detail input", () => {
  const p = page(1, [tile(0), tile(1), tile(2), tile(3)]);
  p.semanticAreaImage = { imageDataUrl: "data:image/jpeg;base64,c2VtYW50aWM=", hiddenLayers: ["hatching"] };
  const input = withPageImages("Maße", [p]);
  assert.deepEqual(input.filter((part) => part.type === "input_image").map((part) => part.image_url), [p.imageDataUrl]);
  assert.ok(input.every((part) => part.type !== "input_text" || !part.text.includes("Bereichsdetail")));
});
