import { AREA_RULES, HERD_OVERRIDE_QUESTIONS, PROJECT_FACT_QUESTIONS } from "../rules";
import type { AnswerMap, DomainQuestion, PlanningHandoff } from "../types";
import { footprintPathInBox, isValidAreaFootprint } from "./area-geometry";

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function answerText(value: string | number | boolean) {
  return typeof value === "boolean" ? (value ? "Ja" : "Nein") : typeof value === "number" ? value.toLocaleString("de-DE") : value;
}

function answerRows(answers: AnswerMap, questions: DomainQuestion[]) {
  return questions.filter((question) => answers[question.id] !== undefined && answers[question.id] !== "")
    .map((question) => `<tr><th>${escapeHtml(question.label)}</th><td>${escapeHtml(answerText(answers[question.id]))}</td></tr>`).join("");
}

/** Portable, printable farmer/planner brief. No scripts, remote assets or product selection. */
export function buildPlanningSummaryHtml(
  handoff: PlanningHandoff,
  previews: Array<{ pageNumber: number; imageDataUrl: string }> = [],
): string {
  const areas = handoff.areas;
  const groups = handoff.planningGroups ?? [];
  const projectRows = answerRows(handoff.project.answers ?? {}, PROJECT_FACT_QUESTIONS);
  const groupSections = groups.map((group) => {
    const rule = AREA_RULES[group.kind];
    const sharedAnswers = Object.fromEntries(Object.entries(group.answers)
      .filter(([id]) => group.answerProvenance[id]?.scope === "group"));
    const members = group.areaIds.map((id) => {
      const index = areas.findIndex((area) => area.id === id);
      return index < 0 ? "" : `Bereich ${index + 1} · Seite ${areas[index].pageNumber}`;
    }).filter(Boolean);
    const rows = answerRows(sharedAnswers, [...rule.questions, ...HERD_OVERRIDE_QUESTIONS]);
    const overrides = group.areaIds.map((id) => {
      const index = areas.findIndex((area) => area.id === id);
      if (index < 0) return "";
      const area = areas[index];
      const answers = Object.fromEntries(Object.entries(area.answers)
        .filter(([key]) => area.answerProvenance?.[key]?.scope === "area"));
      const rows = answerRows(answers, [...rule.questions, ...HERD_OVERRIDE_QUESTIONS.map((question) => question.id === "animalCount"
        ? { ...question, label: "Tieranzahl dieses Bereichs" } : question)]);
      return rows ? `<div class="exception"><h3>Abweichung: Bereich ${index + 1} · ${escapeHtml(area.label)}</h3><table>${rows}</table></div>` : "";
    }).join("");
    const scope = group.additional && !members.length ? "Ergänzungswunsch · Position noch festzulegen" : members.join(" / ");
    return `<section><h2>${escapeHtml(group.title)}</h2><p class="muted">${escapeHtml(scope)}</p>${rows ? `<table>${rows}</table>` : "<p class=\"muted\">Noch keine gemeinsamen Vorgaben.</p>"}${overrides}</section>`;
  }).join("");

  const previewSections = previews.filter((page) => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(page.imageDataUrl))
    .map((page) => {
      const numbered = areas.map((area, index) => ({ area, index })).filter(({ area }) => area.pageNumber === page.pageNumber && area.bbox);
      const overlays = numbered.map(({ area, index }) => {
        const box = area.bbox!;
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1.00001 || box.y + box.height > 1.00001) return "";
        if (isValidAreaFootprint(area.footprint)) {
          const path = footprintPathInBox(area.footprint, box);
          return `<div class="area polygon" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%"><svg aria-label="Bereich ${index + 1}" viewBox="0 0 1 1" preserveAspectRatio="none"><path d="${escapeHtml(path)}" fill="#17633a" fill-opacity="0.05" fill-rule="evenodd" stroke="#17633a" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><span>${index + 1}</span></div>`;
        }
        return `<div class="area" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%"><span>${index + 1}</span></div>`;
      }).join("");
      const legend = numbered.map(({ area, index }) => `<li><strong>${index + 1}</strong> ${escapeHtml(area.label)}</li>`).join("");
      return `<section class="plan-section"><h2>Plan · Seite ${page.pageNumber}</h2><div class="plan"><img alt="Planseite ${page.pageNumber}" src="${escapeHtml(page.imageDataUrl)}">${overlays}</div>${legend ? `<ul class="legend">${legend}</ul>` : ""}</section>`;
    }).join("");

  const review = handoff.review;
  const openPoints: string[] = [];
  if (review?.pendingAnalysis) openPoints.push("Die automatische Analyse war beim Export noch nicht abgeschlossen.");
  if (review?.openAreaCount) openPoints.push(`${review.openAreaCount} Bereichsvorschläge noch prüfen.`);
  if (review?.missingAnswerCount) openPoints.push(`${review.missingAnswerCount} Angaben noch offen; in der Fachplanung klären.`);
  if (review?.unresolvedMeasurementCount) openPoints.push(`${review.unresolvedMeasurementCount} technische Maßangaben noch prüfen.`);
  if (!areas.length) openPoints.push("Es sind noch keine Planbereiche übernommen.");
  const wishesComplete = !review?.pendingAnalysis && !review?.openAreaCount && !review?.missingAnswerCount && areas.length > 0;
  const notices = openPoints.length ? `<ul>${openPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : "<p>Keine offenen Angaben erfasst.</p>";
  const warnings = handoff.analysis.warnings.length ? `<details><summary>Hinweise aus der Analyse</summary><ul>${handoff.analysis.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></details>` : "";
  const created = new Date(handoff.createdAt);
  const date = Number.isNaN(created.getTime()) ? handoff.createdAt : created.toLocaleString("de-DE", { timeZone: "UTC" });
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PATURA · ${escapeHtml(handoff.project.fileName)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f7f5;color:#242724;font:14px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:980px;margin:auto;padding:40px 32px;background:#fff}header{border-bottom:1px solid #dde3dd;padding-bottom:24px}.brand{font-weight:750;letter-spacing:.07em;color:#17633a}h1{font-size:28px;letter-spacing:-.03em;margin:12px 0 4px}h2{font-size:19px;margin:0 0 6px}h3{font-size:14px;margin:0 0 8px}.muted{color:#68736c;margin:0 0 14px}.status{font-size:12px;color:#17633a}section{margin:28px 0;padding-bottom:22px;border-bottom:1px solid #e5e9e5}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 0;vertical-align:top}th{width:45%;font-weight:500;color:#667168}td{font-weight:550}.exception{margin-top:18px;border-left:2px solid #9eafa2;padding-left:14px}.plan{position:relative;line-height:0}.plan img{width:100%;height:auto}.area{position:absolute;border:1px solid #17633a;background:#17633a08;line-height:1}.area span{display:inline-block;padding:3px 4px;background:#17633a;color:white;font-size:10px;min-width:17px;text-align:center}.legend{display:flex;flex-wrap:wrap;gap:8px 20px;list-style:none;padding:0;font-size:12px}.legend strong{color:#17633a}details{font-size:12px;color:#68736c}footer{font-size:12px;color:#68736c}li{margin:5px 0}@media(max-width:600px){main{padding:24px 18px}th{width:50%}h1{font-size:23px}}@media print{body{background:#fff}main{max-width:none;padding:0}section,.exception{break-inside:avoid}.plan-section{break-before:page}footer{margin-top:16px}details{display:none}@page{size:A4;margin:15mm}}
.area.polygon{border:0;background:none}.area.polygon svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.area.polygon span{position:relative}
</style></head><body><main>
<header><div class="brand">PATURA</div><h1>Vorgaben für die Stallplanung</h1><p class="muted">${escapeHtml(handoff.project.fileName)} · ${handoff.project.pageCount} ${handoff.project.pageCount === 1 ? "Seite" : "Seiten"} · ${escapeHtml(date)} UTC</p><div class="status">${wishesComplete ? "Wünsche erfasst" : "Entwurf · offene Angaben enthalten"}</div></header>
<section><h2>Projekt</h2>${projectRows ? `<table>${projectRows}</table>` : "<p class=\"muted\">Projektangaben noch offen.</p>"}</section>
${groupSections}
<section><h2>Für die Fachplanung</h2>${notices}${warnings}<p class="muted">${areas.length} übernommene Bereiche · ${handoff.measurements.filter((measurement) => measurement.status !== "rejected").length} technische Maßangaben im strukturierten Datensatz.</p></section>
${previewSections}
<footer>Gemeinsame Vorgaben gelten für die aufgeführten Bereiche. Abweichungen sind gesondert ausgewiesen. Ergänzungswünsche sind keine aus dem Plan erkannten Objekte. Die Fachplanung legt Systeme, Ausführung und technische Eignung fest. Diese Übersicht kann im Browser gedruckt oder als PDF gespeichert werden. Regelstand: ${escapeHtml(handoff.audit.rulesVersion ?? "unbekannt")}.</footer>
</main></body></html>`;
}
