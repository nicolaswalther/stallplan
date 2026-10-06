"use client";

import { useId, type MouseEventHandler, type PointerEventHandler } from "react";
import { AREA_RULES } from "@/lib/rules";
import type { DetectedArea, NormalizedBox } from "@/lib/types";
import { footprintPathInBox, isValidAreaFootprint, transformAreaFootprint } from "@/lib/plan/area-geometry";
import { AREA_PALETTE } from "./simplified-plan";

export interface AreaOutlineProps {
  area: DetectedArea;
  /** Current drag box; the saved footprint stays immutable until the gesture commits. */
  bbox: NormalizedBox;
  selected: boolean;
  grouped: boolean;
  editable: boolean;
  disabled: boolean;
  simplified?: boolean;
  onSelect: MouseEventHandler<HTMLButtonElement>;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onPointerMove: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onLostPointerCapture: PointerEventHandler<HTMLButtonElement>;
}

function cn(...classes: Array<string | false>) { return classes.filter(Boolean).join(" "); }

/** A real button keeps keyboard semantics, while clipping prevents holes catching clicks. */
export function AreaOutline({ area, bbox, selected, grouped, editable, disabled, simplified = false, onSelect, ...events }: AreaOutlineProps) {
  const clipId = `area-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // Preview exactly the transform that will be committed at pointer release,
  // without mutating the original geometry while a gesture can still be canceled.
  const footprint = isValidAreaFootprint(area.footprint) ? area.footprint : undefined;
  const path = footprint ? footprintPathInBox(transformAreaFootprint(footprint, area.bbox, bbox), bbox) : "";
  const polygon = !!path;
  const stroke = selected ? "#17633a" : grouped ? "#17633ab3" : AREA_PALETTE[area.kind].line;
  return <>
    <button type="button" disabled={disabled} onClick={onSelect} {...events}
      aria-label={`${AREA_RULES[area.kind].title}, ${area.status === "confirmed" ? "übernommen" : "prüfen"}`}
      aria-pressed={selected} data-testid={`area-overlay-${area.id}`} data-area-shape={polygon ? "polygon" : "rectangle"}
      style={polygon ? { clipPath: `url(#${clipId})` } : { borderColor: stroke }}
      className={cn("peer absolute inset-0 h-full w-full", disabled ? "pointer-events-none" : "pointer-events-auto", editable && "cursor-move touch-none",
        polygon ? "border-0" : selected ? "border-2 border-[#17633a]" : grouped ? "border border-[#17633a]/70" : area.status === "confirmed" ? "border border-[#51966a]/60" : "border border-dashed border-[#ad812e]/80",
        selected ? "bg-[#17633a]/14" : grouped ? "bg-[#17633a]/7" : simplified ? "bg-transparent hover:bg-white/15" : area.status === "confirmed" ? "bg-[#51966a]/4 hover:bg-[#51966a]/10" : "bg-[#d9ad55]/6",
        polygon && "focus-visible:bg-[#17633a]/20")} />
    {polygon && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible peer-focus-visible:[&>path]:stroke-[#17633a] peer-focus-visible:[&>path]:[stroke-width:3]"
      viewBox="0 0 1 1" preserveAspectRatio="none">
      <defs><clipPath id={clipId} clipPathUnits="objectBoundingBox">
        <path d={path} clipRule="evenodd" fillRule="evenodd" />
      </clipPath></defs>
      <path d={path} fill="none" stroke={stroke} strokeWidth={selected ? 2 : 1}
        strokeDasharray={!selected && !grouped && area.status !== "confirmed" ? "4 3" : undefined}
        vectorEffect="non-scaling-stroke" />
    </svg>}
  </>;
}
