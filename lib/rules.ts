import type { AreaRule, AreaType, DomainQuestion } from "./types";

export const RULES_VERSION = "2026-10-05.1";
export const DOMAIN_RULES_VERSION = RULES_VERSION;

const animalSpecies = ["Rind", "Pferd", "Schaf / Ziege", "Schwein", "Sonstige"];
const cattleGroups = ["Milchkühe", "Trockensteher", "Jungvieh", "Kälber", "Mastrinder", "Sonstige"];

export const PROJECT_QUESTIONS: DomainQuestion[] = [
  { id: "animalSpecies", label: "Tierart", type: "select", required: true, options: animalSpecies },
  { id: "projectType", label: "Situation", type: "select", required: true, options: ["Neubau", "Umbau / Bestand", "noch offen"] },
];

export const AREA_RULES: Record<AreaType, AreaRule> = {
  feeding_area: {
    title: "Fressbereich",
    description: "Futtertisch und Fressachse.",
    products: ["SSV-Fressgitter", "Fressgitter / Fressplatzsysteme", "Abtrennungen zum Fressgang"],
    measurements: ["nutzbare Fresslänge", "Fressplatzbreite", "Montagehöhe", "Anschlusspunkte"],
    questions: [
      { id: "animalSpecies", label: "Tierart", type: "select", required: true, options: animalSpecies },
      { id: "animalGroup", label: "Tiergruppe", type: "select", required: true, options: cattleGroups },
      { id: "animalCount", label: "Tieranzahl", type: "number", required: true },
      { id: "projectType", label: "Situation", type: "select", required: true, options: ["Neubau", "Umbau / Bestand", "noch offen"] },
    ],
  },
  cubicles: {
    title: "Liegeboxen",
    description: "Liegeboxenreihen und zugehörige Systeme.",
    products: ["Liegeboxenbügel", "Nackenrohrsystem", "Befestigungs- und Montagesysteme"],
    measurements: ["Boxenbreite", "Boxenlänge", "Achsabstand", "Montageposition"],
    questions: [
      { id: "animalSpecies", label: "Tierart", type: "select", required: true, options: animalSpecies },
      { id: "animalGroup", label: "Tiergruppe", type: "select", required: true, options: cattleGroups },
      { id: "animalCount", label: "Tieranzahl", type: "number", required: true },
      { id: "projectType", label: "Situation", type: "select", required: true, options: ["Neubau", "Umbau / Bestand", "noch offen"] },
    ],
  },
  alley: {
    title: "Laufgang",
    description: "Lauf- und Verkehrsbereich.",
    products: ["Abtrennungen", "Tore", "Personendurchgänge"],
    measurements: ["lichte Breite", "Durchgangslänge", "Anschlusspunkte"],
    questions: [
      { id: "animalSpecies", label: "Tierart", type: "select", required: true, options: animalSpecies },
      { id: "animalGroup", label: "Tiergruppe", type: "select", required: false, options: cattleGroups },
      { id: "usage", label: "Nutzung", type: "select", required: true, options: ["Tierverkehr", "Mensch / Service", "gemischt"] },
      { id: "closingNeeded", label: "Absperrbar?", type: "boolean", required: true },
    ],
  },
  calving: {
    title: "Abkalbebereich",
    description: "Abkalbe- und Separationsbereich.",
    products: ["Abtrennungen", "Tore", "flexible Buchtenlösungen"],
    measurements: ["Buchtenlänge", "Buchtenbreite", "Toröffnung", "Anschlusspunkte"],
    questions: [
      { id: "animalSpecies", label: "Tierart", type: "select", required: true, options: animalSpecies },
      { id: "animalGroup", label: "Tiergruppe", type: "select", required: false, options: cattleGroups },
      { id: "penCount", label: "Anzahl Buchten", type: "number", required: true },
      { id: "flexibleLayout", label: "Flexible Buchtenteilung?", type: "boolean", required: true },
    ],
  },
  gate: {
    title: "Tor / Durchgang",
    description: "Tor oder Zugang zwischen Bereichen.",
    products: ["Stalltore", "Teleskop-Tore", "Personendurchgänge"],
    measurements: ["lichte Öffnung", "Montagehöhe", "Pfosten-/Wandanschluss"],
    questions: [
      { id: "animalSpecies", label: "Tierart", type: "select", required: false, options: animalSpecies },
      { id: "gateUse", label: "Nutzung", type: "select", required: true, options: ["Tierdurchgang", "Maschinendurchfahrt", "Personendurchgang", "gemischt"] },
      { id: "projectType", label: "Situation", type: "select", required: true, options: ["Neubau", "Umbau / Bestand", "noch offen"] },
      { id: "hingeSide", label: "Anschlag", type: "select", required: false, options: ["links", "rechts", "flexibel", "noch offen"] },
    ],
  },
  unknown: {
    title: "Unklar",
    description: "Noch nicht eindeutig klassifiziert.",
    products: [],
    measurements: [],
    questions: [
      { id: "animalSpecies", label: "Tierart", type: "select", required: false, options: animalSpecies },
      { id: "purpose", label: "Nutzung", type: "text", required: true },
    ],
  },
};

export const areaTypeOptions = Object.entries(AREA_RULES).map(([value, rule]) => ({
  value: value as AreaType,
  label: rule.title,
}));

/** Project facts are asked once. Technical dimensions stay in the measurement layer. */
export function getAreaQuestions(kind: AreaType): DomainQuestion[] {
  const projectIds = new Set(PROJECT_QUESTIONS.map((question) => question.id));
  return AREA_RULES[kind].questions.filter((question) => !projectIds.has(question.id));
}
