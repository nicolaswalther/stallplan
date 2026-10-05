import type { AreaType, DetectedArea, PdfPageData, PdfTextItem, ProjectFact, ProjectFacts } from "../types";

function normalize(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
}

const SPECIES: Array<{ value: string; pattern: RegExp }> = [
  { value: "Rind", pattern: /\b(?:rind(?:er|ern)?|milchkuh(?:e)?|kuh(?:e)?|kuhen|k[uü]he|kalb(?:er)?|kalber|jungvieh|mast(?:rind(?:er)?|bullen)|mutterkuh(?:e)?|trockensteher|cattle|cow(?:s)?|calf|calves|heifer(?:s)?|youngstock|bull(?:s)?|steer(?:s)?|bydlo|krow(?:a|y|om|ami)?|krow|krowek|ciele(?:ta|tnik)?|cielat|jalow(?:ka|ki|ek|nik)|bovin(?:s)?|vache(?:s)?|genisse(?:s)?|veaux|vaca(?:s)?|ternero(?:s)?|koeien|runderen|kalveren)\b/ },
  { value: "Pferd", pattern: /\b(?:pferd(?:e|en)?|horse(?:s)?|equine|kon(?:ie|i)?|cheva(?:l|ux)|caballo(?:s)?|paard(?:en)?)\b/ },
  { value: "Schaf / Ziege", pattern: /\b(?:schaf(?:e|en)?|ziege(?:n)?|sheep|goat(?:s)?|owc(?:a|e|y)|koz(?:a|y)|mouton(?:s)?|chevre(?:s)?|oveja(?:s)?|cabra(?:s)?|schapen|geiten)\b/ },
  { value: "Schwein", pattern: /\b(?:schwein(?:e|en)?|sau(?:en)?|ferkel|pig(?:s)?|sow(?:s)?|swini(?:a|e)|prosiak(?:i)?|porc(?:s)?|cochon(?:s)?|cerdo(?:s)?|varkens)\b/ },
];

const GROUPS: Array<{ value: string; pattern: RegExp }> = [
  { value: "Milchkühe", pattern: /\b(?:milchkuh(?:e)?|milchkuhen|dairy cows?|lactating cows?|krow(?:y|a) mleczn(?:e|a)|vaches? laitieres?|melkkoeien)\b/ },
  { value: "Mutterkühe", pattern: /\b(?:mutterkuh(?:e)?|mutterkuhen|suckler cows?|beef cows?|krowy mamki|vaches? allaitantes?|zoogkoeien)\b/ },
  { value: "Trockensteher", pattern: /\b(?:trockensteher|trockenstehende kuh(?:e)?|dry cows?|krowy zasuszone|vaches? taries?|droge koeien)\b/ },
  { value: "Jungvieh", pattern: /\b(?:jungvieh(?:bucht|buchten|bereich|stall)?|jungrind(?:er)?|far(?:se|sen)|heifers?|youngstock|young cattle|jalow(?:ka|ki|ek|nik)|genisses?|jongvee)\b/ },
  { value: "Kälber", pattern: /\b(?:kalb(?:er)?|kalber(?:bucht|buchten|box(?:en)?|bereich|stall)?|calf|calves|ciele(?:ta|tnik)?|cielat|veaux|terneros?|kalveren)\b/ },
  { value: "Mastrinder", pattern: /\b(?:mastrind(?:er)?|mastbullen|fattening cattle|fattening bulls?|beef steers?|bydlo opasowe|opasy)\b/ },
];

interface TextObservation { text: string; pageNumber: number; anchor: string; source: "pdf-text" | "ai"; groupKind?: AreaType }

/** Join only adjacent items on one text baseline, never unrelated PDF reading-order lines. */
function nativeObservations(page: PdfPageData): TextObservation[] {
  if (!page.textItems.length) return page.text.split(/\r?\n/).filter((text) => text.trim()).map((text, i) => ({ text, pageNumber: page.pageNumber, anchor: `line-${i}`, source: "pdf-text" }));
  const rows: PdfTextItem[][] = [];
  for (const item of [...page.textItems].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
    // Rotated labels are inspected individually; horizontal grouping cannot connect them reliably.
    const row = (item.orientation ?? 0) % 180 === 0 ? rows.find((items) => (items[0].orientation ?? 0) % 180 === 0
      && Math.abs(items[0].bbox.y + items[0].bbox.height / 2 - item.bbox.y - item.bbox.height / 2) <= Math.min(items[0].bbox.height, item.bbox.height) * 0.35) : undefined;
    if (row) row.push(item); else rows.push([item]);
  }
  const observations: TextObservation[] = [];
  for (const row of rows) {
    const sorted = row.sort((a, b) => a.bbox.x - b.bbox.x);
    let run: PdfTextItem[] = [];
    const flush = () => {
      if (!run.length) return;
      observations.push({ text: run.map((item) => item.text).join(" "), pageNumber: page.pageNumber, anchor: `${run[0].bbox.x.toFixed(5)}-${run[0].bbox.y.toFixed(5)}`, source: "pdf-text" });
      run = [];
    };
    for (const item of sorted) {
      const previous = run.at(-1);
      if (previous && item.bbox.x - previous.bbox.x - previous.bbox.width > Math.max(0.012, previous.bbox.height * page.height / page.width * 2)) flush();
      run.push(item);
    }
    flush();
  }
  return observations;
}

function observedSpecies(text: string) {
  const normalized = normalize(text);
  const species = SPECIES.filter((item) => item.pattern.test(normalized)).map((item) => item.value);
  if (GROUPS.some((item) => item.pattern.test(normalized)) && !species.includes("Rind")) species.push("Rind");
  return species;
}

function observedGroups(text: string) {
  const normalized = normalize(text);
  return GROUPS.filter((item) => item.pattern.test(normalized)).map((item) => item.value);
}

/** Model classifications are not herd evidence; only explicitly cited original labels are. */
function semanticObservations(areas: DetectedArea[]): TextObservation[] {
  return areas.filter((area) => area.status !== "rejected").flatMap((area) => {
    const quoted = (area.originalEvidence ?? area.evidence).flatMap((evidence) => {
      if (!/beschrift|\blabel\b|legende|\btext\b|raumaufstellung|\bopis\b/i.test(evidence)) return [];
      const quotes = [...evidence.matchAll(/[„“"«]([^„“"»]+)[“"»]/g)].map((match) => match[1]);
      // Structural evidence has the literal source after this exact prefix.
      const direct = evidence.match(/^PDF-Beschriftung:\s*(.+)$/i)?.[1];
      return direct ? [direct] : quotes;
    });
    return quoted.map((text, index) => ({ text, pageNumber: area.pageNumber, anchor: `area-${area.id}-${index}`, source: area.source === "ai" ? "ai" as const : "pdf-text" as const, groupKind: area.kind }));
  });
}

interface Headcount { value: number; total: boolean }

/** A literal animal noun must be adjacent to the integer; capacities and DJP never qualify. */
function headcounts(text: string): Headcount[] {
  const normalized = normalize(text);
  if (/\b(?:djp|gve|gv|lu|livestock units?|vieheinheiten?|grossvieheinheiten?|plätze|platze|liegeplatze|boxen|cubicles?|stalls?|capacity|kapazitat|stanowisk(?:a|o)?|miejsc(?:a)?|datum|date|zeichnungsnummer|drawing|projekt[- ]?id)\b/.test(normalized)) return [];
  const noun = "(?:milchkuhe|milchkuhen|mutterkuhe|mutterkuhen|trockensteher|rinder|kuhe|kuhen|kalber|jungvieh|mastrinder|mastbullen|tiere|dairy cows?|dry cows?|suckler cows?|cattle|cows?|calves|heifers?|bulls?|steers?|animals?|krowy|krow|bydlo|cielat|cieleta|jalowki|jalowek|sztuk|szt\\.?|vaches|bovins|veaux|vacas|terneros|koeien|runderen|kalveren)";
  const patterns = [
    new RegExp(`(?:^|[^\\d.,])([1-9]\\d{0,4})\\s+(?:(?:head(?:s)?(?: of)?|szt\\.?)\\s+)?${noun}\\b`, "g"),
    new RegExp(`\\b${noun}\\s*(?:(?:insgesamt|gesamt|total|razem|ogolem)\\s*)?[:=]?\\s*([1-9]\\d{0,4})(?!\\d|[.,]\\d)`, "g"),
    /\b(?:tieranzahl|tierbestand|animal count|headcount|liczba zwierzat|liczba krow)\s*(?:insgesamt|gesamt|total|razem|ogolem)?\s*[:=]?\s*([1-9]\d{0,4})(?!\d|[.,]\d)/g,
  ];
  const found = patterns.flatMap((pattern) => [...normalized.matchAll(pattern)].flatMap((match) => {
    const suffix = normalized.slice(match.index! + match[0].length);
    if (/^\s*(?:m(?:m|2|3|²|³)?|cm|kg|l|djp|gve)(?=\s|[.,;)]|$)/.test(suffix)) return [];
    const value = Number(match[1]);
    // A total marker in the previous clause must not turn "davon 20 Kälber"
    // into a second project total on the same text line.
    const prefix = normalized.slice(0, match.index!);
    const clauseStart = Math.max(prefix.lastIndexOf(","), prefix.lastIndexOf(";"), prefix.lastIndexOf("\n")) + 1;
    const followingBoundary = suffix.search(/[,;\n]/);
    const clause = normalized.slice(clauseStart, followingBoundary < 0 ? undefined : match.index! + match[0].length + followingBoundary);
    return value <= 50_000 ? [{ value, total: /\b(?:insgesamt|gesamt(?:bestand)?|total|razem|ogolem|tieranzahl|tierbestand|animal count|headcount|liczba zwierzat)\b/.test(clause) }] : [];
  }));
  return [...new Map(found.map((item) => [item.value, item])).values()];
}

function fact(value: string | number, observations: TextObservation[], scope: "project" | "group" = "project", groupKind?: AreaType): ProjectFact {
  const source = observations.some((item) => item.source === "pdf-text") ? "pdf-text" : "ai";
  return {
    value, source, confidence: source === "pdf-text" ? 0.97 : 0.9,
    scope, ...(groupKind ? { groupKind } : {}), pageNumber: observations[0].pageNumber,
    evidence: [...new Set(observations.map((item) => `Explizite ${item.source === "pdf-text" ? "PDF-Beschriftung" : "Planbeschriftung"}, Seite ${item.pageNumber}: „${item.text}“`))],
  };
}

/** Prefill only explicit, non-conflicting herd facts; never add room counts into a guessed total. */
export function detectProjectFacts(pages: PdfPageData[], areas: DetectedArea[] = []): ProjectFacts {
  const observations = [...pages.flatMap(nativeObservations), ...semanticObservations(areas)];
  const result: ProjectFacts = {};
  const species = [...new Set(observations.flatMap((item) => observedSpecies(item.text)))];
  if (species.length === 1) result.animalSpecies = fact(species[0], observations.filter((item) => observedSpecies(item.text).includes(species[0])));
  const groups = [...new Set(observations.flatMap((item) => observedGroups(item.text)))];
  if (species.length === 1 && species[0] === "Rind" && groups.length === 1) result.animalGroup = fact(groups[0], observations.filter((item) => observedGroups(item.text).includes(groups[0])));

  for (const kind of [...new Set(observations.flatMap((item) => item.groupKind ? [item.groupKind] : []))]) {
    const scoped = observations.filter((item) => item.groupKind === kind);
    const scopedGroups = [...new Set(scoped.flatMap((item) => observedGroups(item.text)))];
    if (scopedGroups.length === 1 && groups.length > 1) result[`${kind}.animalGroup`] = fact(scopedGroups[0], scoped.filter((item) => observedGroups(item.text).includes(scopedGroups[0])), "group", kind);
  }

  const counts = observations.flatMap((observation) => headcounts(observation.text).map((count) => ({ ...count, observation })));
  const totals = counts.filter((item) => item.total && !item.observation.groupKind);
  const totalValues = [...new Set(totals.map((item) => item.value))];
  if (totalValues.length === 1) result.animalCount = fact(totalValues[0], totals.map((item) => item.observation));
  return result;
}

/** Agreement strengthens provenance; contradictory candidates never become a guessed default. */
export function mergeProjectFacts(native: ProjectFacts, semantic: ProjectFacts): ProjectFacts {
  const result = { ...native };
  for (const [key, candidate] of Object.entries(semantic)) {
    const existing = result[key];
    if (!existing) { result[key] = candidate; continue; }
    if (existing.value !== candidate.value || existing.scope !== candidate.scope || existing.groupKind !== candidate.groupKind) {
      delete result[key];
      continue;
    }
    const preferred = existing.source === "pdf-text" ? existing : candidate.source === "pdf-text" ? candidate : existing;
    result[key] = { ...preferred, confidence: Math.max(existing.confidence, candidate.confidence), evidence: [...new Set([...existing.evidence, ...candidate.evidence])] };
  }
  return result;
}

/**
 * An absent deterministic fact can mean "contradictory", rather than "missing".
 * Recheck the complete observed context after merging so one selected Vision
 * quote cannot resurrect a global default that the detector deliberately omitted.
 */
export function reconcileProjectFacts(pages: PdfPageData[], areas: DetectedArea[], semanticFacts: ProjectFacts = {}): ProjectFacts {
  const result = mergeProjectFacts(detectProjectFacts(pages, areas), semanticFacts);
  const factQuotes: TextObservation[] = Object.values(semanticFacts).flatMap((candidate, factIndex) => candidate.evidence.flatMap((evidence, evidenceIndex) => {
    const quotes = [...evidence.matchAll(/[„“"«]([^„“"»]+)[“"»]/g)].map((match) => match[1]);
    return quotes.map((text, index) => ({ text, pageNumber: candidate.pageNumber ?? 1, source: candidate.source, anchor: `fact-${factIndex}-${evidenceIndex}-${index}`, ...(candidate.groupKind ? { groupKind: candidate.groupKind } : {}) }));
  }));
  const observations = [...pages.flatMap(nativeObservations), ...semanticObservations(areas), ...factQuotes];
  const species = [...new Set(observations.flatMap((item) => observedSpecies(item.text)))];
  const groups = [...new Set(observations.flatMap((item) => observedGroups(item.text)))];
  if (species.length > 1) {
    delete result.animalSpecies;
    delete result.animalGroup;
  }
  if (groups.length > 1) delete result.animalGroup;
  const totals = [...new Set(observations.filter((item) => !item.groupKind).flatMap((item) => headcounts(item.text).filter((count) => count.total).map((count) => count.value)))];
  if (totals.length > 1) delete result.animalCount;
  return result;
}

const semanticFactSchema = {
  animalSpecies: ["Rind", "Pferd", "Schaf / Ziege", "Schwein", "Sonstige"],
  animalGroup: GROUPS.map((item) => item.value),
};

export interface SemanticFactCandidate {
  value: string | number;
  confidence: number;
  pageNumber: number;
  sourceText: string;
}

/** Vision can read outlined labels, but an inferred species/group is never its own evidence. */
export function validateSemanticProjectFacts(input: Partial<Record<"animalSpecies" | "animalGroup" | "animalCount", SemanticFactCandidate | null>> | null | undefined, pages: PdfPageData[]): ProjectFacts {
  const result: ProjectFacts = {};
  if (!input) return result;
  for (const key of ["animalSpecies", "animalGroup", "animalCount"] as const) {
    const candidate = input[key];
    if (!candidate || candidate.confidence < 0.9 || !candidate.sourceText.trim()) continue;
    const page = pages.find((item) => item.pageNumber === candidate.pageNumber);
    if (!page) continue;
    const sourceText = candidate.sourceText.trim();
    const literalNative = nativeObservations(page).find((observation) => normalize(observation.text).includes(normalize(sourceText)));
    if (!literalNative && !page.imageDataUrl) continue;
    const valid = key === "animalSpecies" ? semanticFactSchema.animalSpecies.includes(String(candidate.value)) && observedSpecies(sourceText).length === 1 && observedSpecies(sourceText)[0] === candidate.value
      : key === "animalGroup" ? semanticFactSchema.animalGroup.includes(String(candidate.value)) && observedGroups(sourceText).length === 1 && observedGroups(sourceText)[0] === candidate.value
        : typeof candidate.value === "number" && Number.isInteger(candidate.value) && headcounts(sourceText).some((count) => count.value === candidate.value && count.total);
    if (!valid) continue;
    result[key] = {
      value: candidate.value, confidence: Math.min(candidate.confidence, literalNative ? 0.97 : 0.94),
      source: literalNative ? "pdf-text" : "ai", scope: "project", pageNumber: page.pageNumber,
      evidence: [`Explizite ${literalNative ? "PDF-Beschriftung" : "Planbeschriftung"}, Seite ${page.pageNumber}: „${sourceText}“`],
    };
  }
  // Conflicting native labels are stronger than one isolated model-selected quote.
  const native = pages.flatMap(nativeObservations);
  const species = [...new Set(native.flatMap((item) => observedSpecies(item.text)))];
  const groups = [...new Set(native.flatMap((item) => observedGroups(item.text)))];
  if (species.length > 1 || (species.length === 1 && result.animalSpecies && result.animalSpecies.value !== species[0])) delete result.animalSpecies;
  if (groups.length > 1 || (groups.length === 1 && result.animalGroup && result.animalGroup.value !== groups[0])) delete result.animalGroup;
  const nativeTotalValues = [...new Set(native.flatMap((item) => headcounts(item.text).filter((count) => count.total).map((count) => count.value)))];
  if (nativeTotalValues.length > 1 || (nativeTotalValues.length === 1 && result.animalCount && result.animalCount.value !== nativeTotalValues[0])) delete result.animalCount;
  return result;
}
