import type { AreaRule, AreaType } from "./types";

export const AREA_RULES: Record<AreaType, AreaRule> = {
  feeding_area: {
    title: "Fressbereich",
    description: "Futtertisch, Fressachse und zugehörige Absperr- bzw. Fressgittersysteme.",
    products: ["SSV-Fressgitter", "Fressgitter / Fressplatzsysteme", "Abtrennungen zum Fressgang"],
    measurements: ["nutzbare Fresslänge", "Fressplatzbreite", "Montagehöhe", "vorhandene Rohrdimension"],
    questions: [
      { id: "animalGroup", label: "Tiergruppe", type: "select", required: true, options: ["Milchkühe", "Jungvieh", "Kälber", "Mastrinder", "Sonstige"] },
      { id: "animalCount", label: "Tieranzahl", type: "number", required: true },
      { id: "mounting", label: "Montageart", type: "select", required: true, options: ["zwischen Pfosten", "vor Pfosten", "an Bestandskonstruktion", "noch offen"] },
      { id: "feedingWidth", label: "Gewünschte Fressplatzbreite", type: "number", unit: "cm", required: false },
      { id: "pipeDimension", label: "Bestehende Rohrdimension / Anschluss", type: "text", required: false },
    ],
  },
  cubicles: {
    title: "Liegeboxen",
    description: "Liegeboxenreihen inklusive Bügel, Nackenrohr und relevanter Boxenmaße.",
    products: ["Liegeboxenbügel", "Nackenrohrsystem", "Befestigungs- und Montagesysteme"],
    measurements: ["Boxenbreite", "Boxenlänge", "Achsabstand", "Sockel-/Montageposition"],
    questions: [
      { id: "animalGroup", label: "Tiergruppe", type: "select", required: true, options: ["Milchkühe", "Trockensteher", "Jungvieh"] },
      { id: "boxCount", label: "Anzahl Liegeboxen", type: "number", required: true },
      { id: "boxWidth", label: "Gewünschte Boxenbreite", type: "number", unit: "cm", required: false },
      { id: "mountingBase", label: "Montageuntergrund", type: "select", required: false, options: ["Betonsockel", "Bodenplatte", "Bestand", "noch offen"] },
    ],
  },
  alley: {
    title: "Laufgang",
    description: "Verkehrs- und Laufbereiche zwischen Funktionszonen.",
    products: ["Abtrennungen", "Tore", "Personendurchgänge"],
    measurements: ["lichte Breite", "Durchgangslänge", "Anschlusspunkte"],
    questions: [
      { id: "usage", label: "Nutzung des Laufgangs", type: "select", required: true, options: ["Tierverkehr", "Mensch / Service", "gemischt"] },
      { id: "closingNeeded", label: "Soll der Bereich absperrbar sein?", type: "boolean", required: true },
      { id: "clearWidth", label: "Erforderliche lichte Breite", type: "number", unit: "cm", required: false },
    ],
  },
  calving: {
    title: "Abkalbebereich",
    description: "Abkalbe- und Separationsbuchten mit erhöhtem Fokus auf flexible Abtrennung und Zugang.",
    products: ["Abtrennungen", "Tore", "flexible Buchtenlösungen"],
    measurements: ["Buchtenlänge", "Buchtenbreite", "Torbreite", "Anschlusshöhen"],
    questions: [
      { id: "penCount", label: "Anzahl Buchten", type: "number", required: true },
      { id: "flexibleLayout", label: "Soll die Buchtenteilung flexibel sein?", type: "boolean", required: true },
      { id: "accessWidth", label: "Benötigte Zugangsbreite", type: "number", unit: "cm", required: false },
    ],
  },
  gate: {
    title: "Tor / Durchgang",
    description: "Öffnung oder Durchgang, der mit einem Tor oder einer Zugangslösung ausgestattet werden kann.",
    products: ["Weidetore / Stalltore", "Teleskop-Tore", "Personendurchgänge"],
    measurements: ["lichte Öffnungsbreite", "Anschlagseite", "Montagehöhe", "Pfosten-/Wandanschluss"],
    questions: [
      { id: "gateUse", label: "Nutzung", type: "select", required: true, options: ["Tierdurchgang", "Maschinendurchfahrt", "Personendurchgang", "gemischt"] },
      { id: "hingeSide", label: "Gewünschte Anschlagseite", type: "select", required: false, options: ["links", "rechts", "flexibel"] },
      { id: "openingWidth", label: "Lichte Öffnungsbreite", type: "number", unit: "cm", required: true },
    ],
  },
  unknown: {
    title: "Unklarer Bereich",
    description: "Noch nicht eindeutig klassifizierter Bereich. Erst nach Bestätigung wird Fachlogik angewendet.",
    products: [],
    measurements: [],
    questions: [
      { id: "purpose", label: "Wofür wird dieser Bereich genutzt?", type: "text", required: true },
    ],
  },
};

export const areaTypeOptions = Object.entries(AREA_RULES).map(([value, rule]) => ({
  value: value as AreaType,
  label: rule.title,
}));
