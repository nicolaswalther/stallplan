"use client";

import { useId } from "react";
import type { DetectedArea, AreaType, NormalizedBox } from "@/lib/types";
import type { SimplifiedPlan } from "@/lib/pdf/simplified-view";
import { footprintPathOnPage, isValidAreaFootprint, transformAreaFootprint } from "@/lib/plan/area-geometry";

export const AREA_PALETTE: Record<AreaType, { fill: string; line: string }> = {
  feeding_area: { fill: "#f3e0bb", line: "#96681f" },
  cubicles: { fill: "#d6eae4", line: "#39796a" },
  alley: { fill: "#dce6f1", line: "#536e95" },
  calving: { fill: "#ecdeeb", line: "#8b6186" },
  pens: { fill: "#ece2d9", line: "#8c6d52" },
  isolation: { fill: "#f0dadd", line: "#a45360" },
  gate: { fill: "#dde5f7", line: "#536eb5" },
  drinker: { fill: "#cceaf2", line: "#277f9b" },
  brush: { fill: "#f3ddbf", line: "#a57435" },
  unknown: { fill: "#e7e7e4", line: "#73766d" },
};

/** Presentation only: native coordinates and reviewed footprints share one frame. */
export function SimplifiedPlanView({ plan, areas, draft }: {
  plan: SimplifiedPlan; areas: DetectedArea[]; draft: { id: string; bbox: NormalizedBox } | null;
}) {
  const patternId = `cubicle-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return <svg data-testid="simplified-plan" aria-label="Vereinfachte Planansicht" role="img"
    className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${plan.width} ${plan.height}`}>
    <title>PDF-Linien und erkannte Nutzungsflächen</title>
    <desc>Schraffuren und Beschriftungslayer sind reduziert. Gestrichelte Flächen sind noch zu prüfen. Das Original bleibt verfügbar.</desc>
    <defs><pattern id={patternId} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="14" height="14" fill={AREA_PALETTE.cubicles.fill} />
      <path d="M0 0V14" stroke={AREA_PALETTE.cubicles.line} strokeOpacity=".12" strokeWidth="2" />
    </pattern></defs>
    {areas.map((area) => {
      const bbox = draft?.id === area.id ? draft.bbox : area.bbox;
      const path = isValidAreaFootprint(area.footprint)
        ? footprintPathOnPage(transformAreaFootprint(area.footprint, area.bbox, bbox), plan.width, plan.height) : "";
      const fill = area.kind === "cubicles" ? `url(#${patternId})` : AREA_PALETTE[area.kind].fill;
      const boundary = { stroke: AREA_PALETTE[area.kind].line, strokeWidth: .8, strokeOpacity: .7,
        strokeDasharray: area.status === "unconfirmed" ? "4 3" : undefined, vectorEffect: "non-scaling-stroke" as const };
      return path ? <path key={area.id} data-area-fill={area.id} d={path} fill={fill} fillRule="evenodd"
        {...boundary} />
        : <rect key={area.id} data-area-fill={area.id} x={bbox.x * plan.width} y={bbox.y * plan.height}
          width={bbox.width * plan.width} height={bbox.height * plan.height} fill={fill} {...boundary} />;
    })}
    {plan.paths.map((path, index) => <path key={index} data-vector-kind={path.kind} d={path.d} fill="none"
      stroke={path.kind === "structure" ? "#59645e" : "#8c968e"} strokeOpacity={path.kind === "structure" ? .65 : .18}
      strokeWidth={path.kind === "structure" ? .8 : .5} vectorEffect="non-scaling-stroke" />)}
  </svg>;
}
