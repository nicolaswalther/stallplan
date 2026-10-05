import assert from "node:assert/strict";
import { test } from "node:test";
import { assessAreaBoundary, refineAreaBoundaries } from "../lib/geometry/area-boundaries";
import { areaReviewReason, canAcceptAreaTogether } from "../lib/plan/area-review";
import { applyAreaGeometryCorrection } from "../lib/plan/review";
import type { DetectedArea, PdfPageData } from "../lib/types";

const room: DetectedArea = { id: "room", kind: "calving", label: "Abkalbebucht", confidence: .97,
  source: "ai", status: "unconfirmed", pageNumber: 1, hasBbox: true,
  bbox: { x: .2, y: .2, width: .5, height: .4 }, evidence: [] };
const page: PdfPageData = { pageNumber: 1, width: 1000, height: 1000, imageDataUrl: "", text: "", textItems: [], documentKind: "vector",
  lines: [[.2,.2,.7,.2],[.2,.6,.7,.6],[.2,.2,.2,.6],[.7,.2,.7,.6]].map(([x,y,x2,y2],i) => ({id:`line-${i}`,start:{x,y},end:{x:x2,y:y2},strokeWidth:.6})) };

test("exact unchanged rectangle gets independent support, not just changed/snap sides", () => {
  assert.equal(refineAreaBoundaries(room, [page]), room);
  const boundaryAssessment = assessAreaBoundary(room, [page]);
  assert.equal(boundaryAssessment?.supportedSides.length, 4);
  assert.equal(canAcceptAreaTogether({ ...room, boundaryAssessment }), true);
});

test("high semantic confidence cannot bulk accept an unsupported or partial rectangle", () => {
  assert.equal(canAcceptAreaTogether(room), false);
  const boundaryAssessment = assessAreaBoundary(room, [{ ...page, lines: page.lines!.slice(0, 3) }]);
  assert.equal(boundaryAssessment?.supportedSides.length, 3);
  assert.equal(canAcceptAreaTogether({ ...room, boundaryAssessment }), false);
  assert.equal(assessAreaBoundary(room, [{ ...page, documentKind: "raster" }]), undefined);
  // A shifted box cannot reuse the assessment of its original geometry.
  assert.equal(assessAreaBoundary({ ...room, bbox: { ...room.bbox, y: .3 } }, [page])?.supportedSides.length, 0);
});

test("a supported rectangle still cannot prove a complete alley or its usage", () => {
  const supported = { ...room, boundaryAssessment: assessAreaBoundary(room, [page]) };
  assert.match(areaReviewReason({ ...supported, kind: "alley" })!, /gesamten Gangs/);
  assert.equal(canAcceptAreaTogether({ ...supported, confidence: .7 }), false);
  assert.equal(canAcceptAreaTogether({ ...supported, kind: "unknown" }), false);
  assert.equal(canAcceptAreaTogether({ ...supported, status: "rejected" }), false);
});

test("human corrections discard stale side support without losing the geometry audit", () => {
  const supported = { ...room, boundaryAssessment: assessAreaBoundary(room, [page]) };
  const corrected = applyAreaGeometryCorrection(supported, { ...room.bbox, x: .21 });
  assert.equal(corrected.boundaryAssessment, undefined);
  assert.equal(corrected.geometryCorrections?.length, 1);
  assert.equal(canAcceptAreaTogether(corrected), true);
  assert.equal(canAcceptAreaTogether({ ...corrected, kind: "unknown" }), false);
});
