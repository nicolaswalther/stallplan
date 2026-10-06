import assert from "node:assert/strict";
import test from "node:test";
import { reconcileAreaConsistency } from "../lib/analysis/area-consistency";
import { mergeDetectedAreas } from "../lib/analysis/areas";
import type { DetectedArea, PdfPageData } from "../lib/types";

const label = "GANEK GNOJOWY - GRUPA 106 KRÓW";
function fixture() {
  const structural: DetectedArea[] = [.3, .45, .6].map((y, index) => ({
    id: `native-lane-${index}`, kind: "alley", label: "Laufgänge", originalLabel: label,
    pageNumber: 1, bbox: { x: .3, y, width: .4, height: .04 }, hasBbox: true,
    source: "geometry", confidence: .91, status: "unconfirmed", evidence: ["PDF-Beschriftung und Vektorkanten"],
  }));
  const page: PdfPageData = {
    pageNumber: 1, width: 1000, height: 700, text: label, imageDataUrl: "",
    textItems: structural.map((area) => ({ text: label, orientation: 0,
      bbox: { x: .4, y: area.bbox.y + .012, width: .16, height: .012 } })),
  };
  const cube: DetectedArea = {
    id: "model-cubicles", kind: "cubicles", label: "Liegeboxen", originalLabel: "Liegeboxenreihen",
    pageNumber: 1, bbox: { x: .2, y: .2, width: .6, height: .44 }, hasBbox: true,
    source: "ai", confidence: .9, status: "unconfirmed", evidence: ["Regelmäßige Liegeboxensymbole"],
    boundaryRefinement: { method: "vector-rails", originalBbox: { x: .21, y: .2, width: .59, height: .44 }, snappedSides: ["left"], sourceLineIds: ["outside-wall"], confidence: .9 },
  };
  return { structural, page, cube };
}

test("a floor-wide cubicle rectangle excludes independently PDF-labelled manure lanes", () => {
  const { structural, page, cube } = fixture();
  const rows = reconcileAreaConsistency([cube], structural, [page]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((area) => [area.bbox.y, area.bbox.y + area.bbox.height]), [[.2, .3], [.33999999999999997, .45], [.49, .6]]);
  for (const row of rows) {
    assert.equal(row.bbox.x, cube.bbox.x);
    assert.equal(row.bbox.width, cube.bbox.width);
    assert.equal(row.source, "ai");
    assert.ok(row.confidence! < cube.confidence!);
    assert.deepEqual(row.originalBbox, cube.bbox);
    assert.equal(row.originalConfidence, cube.confidence);
    assert.equal(row.boundaryRefinement, undefined);
    assert.ok(row.originalEvidence?.some((item) => item.includes("native-lane-0")));
    assert.ok(row.evidence.some((item) => item.includes("Seitliche Ausdehnung")));
  }
  assert.equal(cube.bbox.height, .44);
  assert.ok(cube.boundaryRefinement);
});

test("an alley collection retains separated lane geometry and stable native IDs through merging", () => {
  const { structural, page, cube } = fixture();
  const mega: DetectedArea = { ...cube, id: "model-all-lanes", kind: "alley", label: "Laufgänge", originalLabel: label };
  const separated = reconcileAreaConsistency([mega], structural, [page]);
  assert.deepEqual(separated.map((area) => area.id), structural.map((area) => area.id));
  assert.deepEqual(separated.map((area) => area.bbox.y), structural.map((area) => area.bbox.y));
  for (const area of separated) assert.ok(Math.abs(area.bbox.height - .04) < 1e-10);
  const merged = mergeDetectedAreas(structural, separated);
  assert.equal(merged.length, 3);
  for (const area of merged) {
    assert.equal(area.source, "ai");
    assert.equal(area.bbox.width, mega.bbox.width);
    assert.ok(area.id.startsWith("native-lane-"));
  }
});

test("a single crossing, generic corridor or unanchored model label cannot split a room", () => {
  const { structural, page, cube } = fixture();
  assert.equal(reconcileAreaConsistency([cube], structural.slice(0, 1), [page])[0], cube);
  assert.equal(reconcileAreaConsistency([cube], structural, [{ ...page, textItems: [] }])[0], cube);
  assert.equal(reconcileAreaConsistency([cube], structural.map((area) => ({ ...area, originalLabel: "KOMUNIKACJA" })),
    [{ ...page, textItems: page.textItems.map((item) => ({ ...item, text: "KOMUNIKACJA" })) }])[0], cube);
  assert.equal(reconcileAreaConsistency([cube], structural.map((area) => ({ ...area, source: "ai" })), [page])[0], cube);
  assert.equal(reconcileAreaConsistency([cube], structural.map((area) => ({ ...area, confidence: .6 })), [page])[0], cube);
  const differentlyNamed: DetectedArea = { ...cube, kind: "alley", originalLabel: "KOMUNIKACJA" };
  assert.equal(reconcileAreaConsistency([differentlyNamed], structural, [page])[0], differentlyNamed);
});

test("genuine polygons, user changes and correctly separated rows preserve their exact geometry", () => {
  const { structural, page, cube } = fixture();
  const variants: DetectedArea[] = [
    { ...cube, footprint: { parts: [{ outer: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .64 }, { x: .2, y: .64 }],
      holes: [[{ x: .2, y: .3 }, { x: .8, y: .3 }, { x: .8, y: .34 }, { x: .2, y: .34 }]] }] } },
    { ...cube, source: "manual" }, { ...cube, status: "confirmed" }, { ...cube, status: "rejected" },
    { ...cube, geometryCorrections: [{ at: "2026-10-06T00:00:00Z", bbox: cube.bbox, source: "customer" }] },
    { ...cube, bbox: { ...cube.bbox, y: .34, height: .11 } },
    { ...cube, pageNumber: 2 }, { ...cube, bbox: { ...cube.bbox, x: .75, width: .2 } },
  ];
  for (const original of variants) assert.equal(reconcileAreaConsistency([original], structural, [page])[0], original);
});

test("duplicate labels on the same native strip are not independent row evidence", () => {
  const { structural, page, cube } = fixture();
  const repeated = [structural[0], { ...structural[0], id: "native-copy" }];
  assert.equal(reconcileAreaConsistency([cube], repeated, [page])[0], cube);
});

test("Hungarian manure lanes split collection boxes only with independent native and unambiguous label proof", () => {
  const { structural, page, cube } = fixture();
  const labels = ["Trágyaút", "Trágyaút (vízöblítés nélkül)"];
  const native = structural.slice(0, 2).map((area, index) => ({ ...area, originalLabel: labels[index] }));
  const plan = { ...page, textItems: page.textItems.slice(0, 2).map((item, index) => ({ ...item, text: labels[index] })) };
  const rows = reconcileAreaConsistency([cube], native, [plan]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.source === "ai" && row.confidence! <= .82));
  for (const row of rows) for (const band of native) {
    const intersection = Math.max(0, Math.min(row.bbox.y + row.bbox.height, band.bbox.y + band.bbox.height)
      - Math.max(row.bbox.y, band.bbox.y));
    assert.ok(intersection < 1e-10, "model rows must not fill the independently labelled manure lanes");
  }
  for (const originalLabel of ["Felhajtóút", "átjáró", "Trágyaút / Etetőút", "Trágyaút + Ellető boxok"]) {
    const combined = native.map((area) => ({ ...area, originalLabel }));
    const combinedPlan = { ...plan, textItems: plan.textItems.map((item) => ({ ...item, text: originalLabel })) };
    assert.equal(reconcileAreaConsistency([cube], combined, [combinedPlan])[0], cube, originalLabel);
  }
  assert.equal(reconcileAreaConsistency([cube], native.slice(0, 1), [plan])[0], cube);
  assert.equal(reconcileAreaConsistency([cube], native, [{ ...plan, textItems: [] }])[0], cube);
});

test("an exact native plan label rejects a spatially conflicting AI box without relocating it", () => {
  const { structural, page, cube } = fixture();
  const misplaced: DetectedArea = { ...cube, id: "shifted-lane", kind: "alley", originalLabel: "ganek gnojowy - grupa 106 krow",
    bbox: { x: .2, y: .35, width: .6, height: .05 } };
  assert.deepEqual(reconcileAreaConsistency([misplaced], structural, [page]), []);
  assert.equal(misplaced.bbox.y, .35);
  const correctlyLocated = { ...misplaced, bbox: { ...misplaced.bbox, y: .3 } };
  assert.equal(reconcileAreaConsistency([correctlyLocated], structural, [page])[0], correctlyLocated);
  // Nearby label ink at the boundary remains valid within a small font margin.
  const labelCenter = page.textItems[0].bbox.y + page.textItems[0].bbox.height / 2;
  const nearBoundary = { ...misplaced, bbox: { ...misplaced.bbox, y: labelCenter + 1 / page.height } };
  assert.equal(reconcileAreaConsistency([nearBoundary], structural, [page])[0], nearBoundary);
});

test("exact feeding labels are checked while inferred labels, equipment and customer shapes stay protected", () => {
  const { structural, page, cube } = fixture();
  const native = { ...structural[0], kind: "feeding_area" as const, originalLabel: "STÓŁ PASZOWY" };
  const plan = { ...page, textItems: [{ ...page.textItems[0], text: "STÓŁ PASZOWY" }] };
  const shifted: DetectedArea = { ...cube, kind: "feeding_area", originalLabel: "STÓŁ PASZOWY", bbox: { x: .2, y: .4, width: .6, height: .03 } };
  assert.deepEqual(reconcileAreaConsistency([shifted], [native], [plan]), []);
  for (const preserved of [
    { ...shifted, originalLabel: "Fressbereich an der Außenwand" }, { ...shifted, originalLabel: undefined },
    { ...shifted, source: "manual" as const }, { ...shifted, status: "confirmed" as const },
    { ...shifted, kind: "drinker" as const }, { ...shifted, kind: "gate" as const },
    { ...shifted, geometryCorrections: [{ at: "2026-10-06T00:00:00Z", bbox: shifted.bbox, source: "customer" as const }] },
    { ...shifted, footprint: { parts: [{ outer: [{ x: .2, y: .4 }, { x: .8, y: .4 }, { x: .8, y: .43 }, { x: .2, y: .43 }] }] } },
  ]) assert.equal(reconcileAreaConsistency([preserved], [native], [plan])[0], preserved);
  // Missing structural corroboration does not turn a quoted label into a guard.
  assert.equal(reconcileAreaConsistency([shifted], [], [plan])[0], shifted);
  assert.equal(reconcileAreaConsistency([shifted], [{ ...native, confidence: .82 }], [plan])[0], shifted);
});

test("a second identically named room needs its own native text, not a fabricated native enclosure", () => {
  const { structural, page, cube } = fixture();
  const native = { ...structural[0], kind: "calving" as const, originalLabel: "PORODÓWKA" };
  const secondLabel = { text: "PORODÓWKA", bbox: { x: .4, y: .7, width: .16, height: .012 } };
  const plan = { ...page, textItems: [{ ...page.textItems[0], text: "PORODÓWKA" }, secondLabel] };
  const secondRoom: DetectedArea = { ...cube, kind: "calving", originalLabel: "PORODÓWKA", bbox: { x: .3, y: .68, width: .4, height: .08 } };
  assert.equal(reconcileAreaConsistency([secondRoom], [native], [plan])[0], secondRoom);
});

test("a mostly contained smaller AI fragment cannot duplicate a strongly labelled native feeding strip", () => {
  const { structural, page, cube } = fixture();
  const native: DetectedArea = { ...structural[0], kind: "feeding_area", originalLabel: "STÓŁ PASZOWY",
    bbox: { x: .24, y: .3, width: .52, height: .09 } };
  const plan = { ...page, textItems: [{ text: "STÓŁ PASZOWY", bbox: { x: .4, y: .31, width: .16, height: .012 } }] };
  const fragment: DetectedArea = { ...cube, kind: "feeding_area", originalLabel: "STÓŁ PASZOWY", bbox: { x: .2, y: .3, width: .6, height: .04 } };
  // Native/AI IoU is below .45 despite >80% fragment containment.
  assert.deepEqual(reconcileAreaConsistency([fragment], [native], [plan]), []);
  for (const [modelArea, nativeArea] of [
    [fragment, { ...native, confidence: .82 }],
    [{ ...fragment, originalLabel: "Fressbereich" }, native],
    [{ ...fragment, bbox: { ...fragment.bbox, width: .8 } }, native],
    [{ ...fragment, source: "manual" as const }, native],
    [{ ...fragment, geometryCorrections: [{ at: "2026-10-06T00:00:00Z", source: "customer" as const, bbox: fragment.bbox }] }, native],
  ] as Array<[DetectedArea, DetectedArea]>) assert.equal(reconcileAreaConsistency([modelArea], [nativeArea], [plan])[0], modelArea);
  const full = { ...fragment, bbox: { ...fragment.bbox, height: .095 } };
  assert.equal(reconcileAreaConsistency([full], [native], [plan])[0], full);
});

test("a same-labelled feeding collection cannot reconnect two independently enclosed strips across their gap", () => {
  const { structural, page, cube } = fixture();
  const native: DetectedArea[] = [.1, .55].map((x, index) => ({ ...structural[index],
    kind: "feeding_area", originalLabel: "Etetőút", bbox: { x, y: .4, width: .35, height: .1 } }));
  const plan: PdfPageData = { ...page, textItems: [.2, .65].map((x) => ({ text: "Etetőút", orientation: 0,
    bbox: { x, y: .43, width: .07, height: .01 } })) };
  const collection: DetectedArea = { ...cube, kind: "feeding_area", originalLabel: "Etetőút",
    bbox: { x: .08, y: .42, width: .84, height: .06 } };
  assert.deepEqual(reconcileAreaConsistency([collection], native, [plan]), []);
  assert.equal(native.length, 2);
  assert.equal(native[0].bbox.width, .35, "native geometry remains untouched instead of fabricating new split boxes");
  const cases: Array<[DetectedArea, DetectedArea[], PdfPageData]> = [
    [collection, native.slice(0, 1), plan],
    [collection, native.map((area) => ({ ...area, source: "ai" })), plan],
    [collection, native.map((area) => ({ ...area, confidence: .89 })), plan],
    [collection, native, { ...plan, textItems: [] }],
    [{ ...collection, originalLabel: "Futtergang" }, native, plan],
    [{ ...collection, source: "manual" }, native, plan],
    [{ ...collection, status: "confirmed" }, native, plan],
    [{ ...collection, geometryCorrections: [{ at: "2026-10-06", bbox: collection.bbox, source: "customer" }] }, native, plan],
    [{ ...collection, bbox: { ...collection.bbox, width: .49 } }, native, plan],
    [collection, [native[0], { ...native[1], bbox: { ...native[1].bbox, x: .45 } }], plan],
  ];
  for (const [candidate, supports, document] of cases) {
    assert.equal(reconcileAreaConsistency([candidate], supports, [document])[0], candidate);
  }
});
