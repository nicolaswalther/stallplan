import type { AnswerMap, AreaRule, AreaType, DomainQuestion } from "./types";

export const RULES_VERSION = "2026-10-05.2";
export const DOMAIN_RULES_VERSION = RULES_VERSION;

const animalSpecies = ["Rind", "Pferd", "Schaf / Ziege", "Schwein", "Sonstige"];
const cattleGroups = ["Milchkühe", "Mutterkühe", "Trockensteher", "Jungvieh", "Kälber", "Mastrinder", "Gemischte Gruppen", "Noch offen"];
const yesNoOpen = ["Ja", "Nein", "Noch offen"];
const decide = "Planungsteam entscheidet";
const question = (id: string, label: string, options: string[], required = true): DomainQuestion => ({ id, label, type: "select", required, options });
const stallEquipment = { label: "PATURA Stalleinrichtungen", url: "https://www.patura.com/de_DE/produkte/stalleinrichtungen-107141" };

export const PROJECT_QUESTIONS: DomainQuestion[] = [
  question("animalSpecies", "Tierart", animalSpecies),
  question("projectType", "Situation", ["Neubau", "Umbau / Bestand", "Noch offen"]),
];

/** Optional project defaults apply once; animalCount is the project total. */
export const PROJECT_CONTEXT_QUESTIONS: DomainQuestion[] = [
  question("animalGroup", "Tiergruppe", cattleGroups, false),
  { id: "animalCount", label: "Tieranzahl insgesamt", type: "number", required: false },
  { id: "planningNotes", label: "Weitere Wünsche", type: "text", required: false },
];
export const PROJECT_FACT_QUESTIONS = [...PROJECT_QUESTIONS, ...PROJECT_CONTEXT_QUESTIONS];

/** Area/group count is a deliberate override, never a copied project total. */
export const HERD_OVERRIDE_QUESTIONS: DomainQuestion[] = [
  question("animalGroup", "Abweichende Tiergruppe", cattleGroups, false),
  { id: "animalCount", label: "Tieranzahl dieser Gruppe", type: "number", required: false },
];
export const AREA_HERD_OVERRIDE_QUESTIONS: DomainQuestion[] = HERD_OVERRIDE_QUESTIONS.map((item) => item.id === "animalCount" ? { ...item, label: "Tieranzahl dieses Bereichs" } : item);

export const AREA_RULES: Record<AreaType, AreaRule> = {
  feeding_area: {
    title: "Fressbereiche", description: "Fressplätze und Fangfunktion.",
    products: ["Selbstfang-Fressgitter", "Sicherheits-Selbstfang-Fressgitter", "Futtertischabtrennungen", "Schrägfressgitter"],
    measurements: ["nutzbare Fresslänge", "Fressplatzbreite", "Montagehöhe", "Anschlusspunkte"],
    questions: [
      question("feedingRestraint", "Tiere am Fressplatz fixieren?", yesNoOpen),
      question("horns", "Sind die Tiere behornt?", yesNoOpen),
    ],
    sources: [{ label: "PATURA Fressgitter", url: "https://www.patura.com/de_DE/produkte/fressgitter-107144" }],
  },
  cubicles: {
    title: "Liegeboxen", description: "Liegeboxenbügel und Liegeflächen.",
    products: ["Liegeboxenbügel", "Nackenrohrsystem", "Latexmatratzen", "Wasserbetten", "Noppen-Matratze Comfort"],
    measurements: ["Boxenbreite", "Boxenlänge", "Achsabstand", "Montageposition"],
    questions: [
      question("cubicleEquipment", "Liegeboxenbügel", ["Neu planen", "Vorhandene behalten", "Noch offen"]),
      question("bedding", "Liegefläche", ["Vorhandene Liegefläche behalten", "Tiefbox mit Einstreu", "Latexmatratze", "Wasserbett", "Noppen-Matratze Comfort", decide]),
    ],
    sources: [{ label: "PATURA Kuhmatratzen", url: "https://www.patura.com/de_DE/produkte/kuhmatratzen-7176411" }, stallEquipment],
  },
  alley: {
    title: "Laufgänge", description: "Tierverkehr, Belag und Absperrungen.",
    products: ["Rillenboden Active Duo", "Abtrennungen", "Tore", "Personendurchgänge"],
    measurements: ["lichte Breite", "Durchgangslänge", "Anschlusspunkte"],
    questions: [
      question("traffic", "Wer nutzt den Gang?", ["Tiere", "Personen / Service", "Tiere und Maschinen", "Noch offen"]),
      question("floorPreference", "Laufgangbelag", ["Rillenboden Active Duo", "Vorhandenen Boden behalten", decide]),
      question("separation", "Gang absperrbar machen?", yesNoOpen),
    ],
    sources: [stallEquipment, { label: "PATURA Rillenboden Active Duo", url: "https://www.patura.com/de_DE/produkt/339190-rillenboden-activeduo-laufgangbelag-fur-rinder-inkl-nagelanker-und-bursten-lange-max-150m-breite-80cm-hohe-2cm" }],
  },
  calving: {
    title: "Abkalbebuchten", description: "Geburt, Betreuung und flexible Buchten.",
    products: ["Abtrennungen", "Tore", "Abtrennung für Tierbehandlung"],
    measurements: ["Buchtenlänge", "Buchtenbreite", "Toröffnung", "Anschlusspunkte"],
    questions: [
      question("penLayout", "Buchtenaufteilung", ["Fest", "Flexibel teilbar", decide]),
      question("treatmentRestraint", "Tier zur Betreuung fixieren?", yesNoOpen),
    ],
    sources: [stallEquipment, { label: "PATURA Abtrennung für Tierbehandlung", url: "https://www.patura.com/de_DE/produkt/322028-abtrennung-fur-tierbehandlung" }],
  },
  pens: {
    title: "Tierbuchten", description: "Gruppen- oder Einzelbuchten für Rinder und Jungvieh.",
    products: ["Abtrennungen", "Tore", "Kälber-Gruppenboxen", "Kälber-Einzelboxen"],
    measurements: ["Buchtenlänge", "Buchtenbreite", "Toröffnung", "Anschlusspunkte"],
    questions: [
      question("penHousing", "Unterbringung", ["Gruppenbucht", "Einzelbuchten", decide]),
      question("penLayout", "Buchtenaufteilung", ["Fest", "Flexibel teilbar", decide]),
    ],
    sources: [stallEquipment, { label: "PATURA Kälberhaltung", url: "https://www.patura.com/de_DE/produkte/kalberhaltung-107148" }],
  },
  isolation: {
    title: "Kranken- / Separationsbuchten", description: "Separieren und betreuen.",
    products: ["Abtrennungen", "Tore", "Abtrennung für Tierbehandlung"],
    measurements: ["Buchtenlänge", "Buchtenbreite", "Toröffnung", "Anschlusspunkte"],
    questions: [
      question("penLayout", "Buchtenaufteilung", ["Fest", "Flexibel teilbar", decide]),
      question("treatmentRestraint", "Tier zur Behandlung fixieren?", yesNoOpen),
    ],
    sources: [stallEquipment, { label: "PATURA Abtrennung für Tierbehandlung", url: "https://www.patura.com/de_DE/produkt/322028-abtrennung-fur-tierbehandlung" }],
  },
  gate: {
    title: "Tore / Durchgänge", description: "Absperrungen und Gebäudeöffnungen.",
    products: ["Stalltore", "Personenschlupf", "Schnelllauftore", "Agrartore", "Windschutzvorhänge"],
    measurements: ["lichte Öffnung", "Montagehöhe", "Pfosten-/Wandanschluss"],
    questions: [
      question("gateLocation", "Wo werden Tore benötigt?", ["Im Stall", "An Außenöffnungen", "Innen und außen", "Noch offen"]),
      question("gateUse", "Durchgang für", ["Tiere", "Personen", "Maschinen", "Tiere und Maschinen", "Noch offen"]),
      { ...question("windProtection", "Windschutz vorsehen?", yesNoOpen), when: { questionId: "gateLocation", values: ["An Außenöffnungen", "Innen und außen"] } },
      question("personAccess", "Separaten Personendurchgang vorsehen?", yesNoOpen, false),
    ],
    sources: [stallEquipment],
  },
  drinker: {
    title: "Tränken", description: "Tränkestellen und Frostschutz.",
    products: ["Trogtränken", "Tränkebecken", "Heizbare Tränken", "Umlaufheizsysteme", "24-V-Transformatoren"],
    measurements: ["Aufstellfläche", "Montagehöhe", "Leitungsanschlüsse", "Ringleitung bei Umlaufheizung prüfen"],
    questions: [
      question("frostProtection", "Frostschutz benötigt?", yesNoOpen),
      { ...question("heatingContext", "Vorhandene Tränkenheizung", ["Umlaufheizung vorhanden", "Einzelheizung / Transformator vorhanden", "Noch keine", "Unbekannt"]), when: { questionId: "frostProtection", values: ["Ja"] } },
      { ...question("heatingPreference", "Gewünschter Frostschutz", ["Neue Umlaufheizung prüfen", "Einzelheizung mit Transformator", decide]), when: { questionId: "heatingContext", values: ["Noch keine", "Unbekannt"], and: [{ questionId: "frostProtection", values: ["Ja"] }] } },
      question("drinkingType", "Tränkeform", ["Trogtränke", "Tränkebecken", decide], false),
    ],
    sources: [
      { label: "PATURA Tränketechnik", url: "https://www.patura.com/de_DE/produkte/tranketechnik-107156" },
      { label: "PATURA Umlaufheizsystem", url: "https://www.patura.com/de_DE/produkt/gruppe-127512-umlaufheizsystem-mit-93-85-w-pumpe" },
      { label: "PATURA 24-V-Transformatoren", url: "https://www.patura.com/de_DE/produkt/gruppe-127495-transformatoren/381502-transformator-mod-400-24-volt-400-w" },
    ],
  },
  brush: {
    title: "Bürsten", description: "Tierkomfort und Bürstensysteme.",
    products: ["Mechanische Schwingbürsten", "Elektrische Pendelbürsten", "Elektrische Doppelbürsten"],
    measurements: ["Aufstellfläche", "Montagehöhe", "Befestigungspunkt"],
    questions: [
      question("brushType", "Bürstensystem", ["Mechanisch", "Elektrisch", decide]),
      { ...question("brushPower", "Strom am Aufstellort vorhanden?", yesNoOpen), when: { questionId: "brushType", values: ["Elektrisch"] } },
    ],
    sources: [stallEquipment, { label: "PATURA Schwingbürste", url: "https://www.patura.com/de_DE/produkt/gruppe-7105238-patura-schwingburste/334025-schwingburste-maxi-fur-rinder-und-grosspferde-hohe-155-cm-gewicht-60-kg" }],
  },
  unknown: {
    title: "Weitere Bereiche", description: "Nutzung für das Planungsteam beschreiben.", products: [], measurements: [],
    questions: [{ id: "purpose", label: "Wofür soll der Bereich genutzt werden?", type: "text", required: true }],
  },
};

export const areaTypeOptions = Object.entries(AREA_RULES).map(([value, rule]) => ({ value: value as AreaType, label: rule.title }));

/** Only the currently applicable branch is asked and exported. */
export function getGroupQuestions(kind: AreaType, answers: AnswerMap = {}): DomainQuestion[] {
  return AREA_RULES[kind].questions.filter((item) => !item.when || (item.when.values.includes(answers[item.when.questionId])
    && (item.when.and ?? []).every((condition) => condition.values.includes(answers[condition.questionId]))));
}
export function getAreaQuestions(kind: AreaType, answers: AnswerMap = {}): DomainQuestion[] {
  return getGroupQuestions(kind, answers);
}
