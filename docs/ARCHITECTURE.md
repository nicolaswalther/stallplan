# Technisches Planmodell und Analysepipeline

## Trennung der Schichten

```text
PDF.js Legacy
 ├─ Textobjekte + Position + Orientierung
 ├─ Vektorlinien + Grafiktransformationen
 ├─ Seitenklassifikation
 └─ Rendering
       │
       ├─ deterministische Maße + Einheiten + Ketten
       ├─ beschriftete Vektoreinschließungen
       └─ optionale semantische Bereiche / Rastermaße
                     │
                  Planmodell
                     │
                 PATURA-Regeln
                     │
                Handoff 1.4 + lesbare Planungsübersicht
```

`lib/types.ts` ist unabhängig von React, PDF.js und OpenAI. Seiten speichern Textobjekte und normierte Geometrie; Maße referenzieren Originaltext, Maßlinie, Bezugspunkte, Kette, Einheitsevidenz und Signalwerte. Öffnungshöhen sind ein eigener Typ. Ein Teilmaß kann ein geometrisch und rechnerisch belegtes Gesamtmaß referenzieren.

## Module

| Modul | Aufgabe |
|---|---|
| `lib/pdf-client.ts` | Browserimport, Rendering, Legacy-Lifecycle |
| `lib/pdf/text-extraction.ts` | Rotation und Transformation der Textboxen |
| `lib/pdf/vector-extraction.ts` | PDF.js-6-Pfadbuffer, Grafikzustände, Linien, native OCG-Layernamen, Dokumenttyp |
| `lib/pdf/simplified-view.ts` | Reversible SVG-Präsentation mit gebündelten nativen Linien und benanntem Layerfilter |
| `components/simplified-plan.tsx` | Nutzungsfarben, Liegeboxenmuster und identischer Koordinatenrahmen für Flächen und Bearbeitung |
| `lib/geometry/dimension-lines.ts` | Linienindex, Text-/Linienbezug, Maßbegrenzungen |
| `lib/analysis/measurements.ts` | Maßkandidaten, Ketten, Öffnungspaare, Konfidenz |
| `lib/analysis/unit-detection.ts` | Maßstab, eindeutige Einheitenbelege, `unknown` |
| `lib/analysis/areas.ts` | Beschriftete Vektoreinschließungen sowie geometrisch belegte vollständige Gangbänder |
| `lib/geometry/area-boundaries.ts` | Lokale Vektorgrenzen und vollständig belegte Rechteckschließung |
| `lib/geometry/semantic-regions.ts` | Eindeutige native Raumkennzeichen und automatisch lokalisierte Vektorschrift-Ausschnitte |
| `lib/geometry/room-contours.ts` | Geschlossene Vektorflächen, Aussparungen, Verweigerung bei mehreren Raumkennzeichen |
| `lib/analysis/area-geometry.ts` | Belegte Zuordnung einer wörtlichen Raumbezeichnung zur nativen Kontur |
| `components/area-outline.tsx` | Editierbare Polygon-Markierungen, Klicks durch Aussparungen, Tastaturbedienung |
| `lib/analysis/project-facts.ts` | Explizite mehrsprachige Tierangaben, Umfang, Widerspruchsprüfung |
| `lib/domain/inferred-preferences.ts` | Automatische Vorbelegung, Herkunft, Schutz bewusster Eingaben |
| `lib/plan/viewport.ts` | Begrenzter Mausrad-Zoom und Cursoranker |
| `components/planning-wishes.tsx` | Fokussierter Fragebogen je Projekt/Bereichsgruppe |
| `lib/analysis/pipeline.ts` | Unabhängige Analysezweige, Teilergebnisse |
| `lib/ai/*` | Spezialisierte Bereiche / Rastermaße, Modelle, Kontext |
| `lib/ai/usage.ts` | Tatsächliche Tokens und versionierte, tarifabhängige Kostenschätzung |
| `lib/plan/request.ts` | Validierung der normalisierten Eingangsdaten |
| `lib/plan/review.ts` | Positionsbezogene Fusion, Schutz der Kundenkorrekturen, Prüfung |
| `lib/rules.ts` | PATURA-Systemmöglichkeiten, Projekt- und Bereichsfragen |
| `lib/domain/planning-preferences.ts` | Gruppenvererbung, Bereichsausnahmen, bedingte Fragen, Antwortprovenienz |
| `lib/plan/summary.ts` | Eigenständige druckbare Übersicht ohne externe Assets/Skripte |
| `lib/evaluation/*` | Messbare Qualität und annotierte historische Planpaare |

## Einheiten und Confidence

Eine Einheit ist keine Folge eines plausibel klingenden Zahlenwerts. Ein gedruckter Maßstab allein genügt ebenfalls nicht. Mehrere reale Vektorstrecken müssen mit den geschriebenen Werten in einer Einheit übereinstimmen; alternative Einheiten werden dagegen geprüft. Widersprüchliche oder fehlende Belege ergeben `unknown`. Explizite Einheiten am einzelnen Maß bleiben erhalten.

Die Confidence dokumentiert technische Signale; sie ist noch keine über viele Dokumente kalibrierte Wahrscheinlichkeit. Datenquelle und Review-Status sind getrennt. Eine Kundenkorrektur behält Originalwert, Originaleinheit und Zeitstempel.

## Semantik und Fehlergrenzen

Die Bereichsanalyse liest Nutzungsbeschriftungen und Einrichtungsmuster. Auf Vektor-PDFs ergänzt sie keine bereits vorhandenen Maßzahlen. Vision-Maße werden nur für textarme Raster-/Mischseiten angefragt, jeweils mit eigener Validierung. Ein API- oder Modellfehler lässt die deterministischen Maße bestehen. Tatsächlich verwendete Modelle werden protokolliert.

Die Semantik erhält native Raumkennzeichen mit exakten Koordinaten und höchstens vier echte, hochauflösende PDF-Ausschnitte aus automatisch gefundenen Vektorschriftregionen. Es wird kein Ground-Truth-Text eingespeist und kein OCR-Zahlenwert als Maß übernommen. Eine wörtliche, eindeutig klassifizierbare nummerierte Raumbezeichnung kann mit einem nativen Kennzeichen und einer eindeutig geschlossenen Fläche verbunden werden. Ein Kennzeichen allein legt keine Nutzung fest.

Native Konturen speichern Außenringe, Löcher und Linienquellen. Mehrere Kennzeichen in derselben Fläche, offene Komponenten und geometrische Grenzverletzungen verhindern die Übernahme. Liegt der native Raumanker außerhalb der Modellbox, ist zusätzlich ein realer Beschriftungsausschnitt und semantische Confidence mindestens 0,9 nötig. Dieser Konflikt bleibt explizit prüfpflichtig; Originalbox und Confidence bleiben erhalten. Damit kann die reale Raumkontur eine falsche Bildbox korrigieren, ohne die widersprüchliche Zuordnung automatisch zu bestätigen.

Die Polygonform bleibt in Darstellung, Klickfläche, Verschieben/Skalieren, Handoff und druckbarer Vorschau erhalten. Aussparungen lassen darunterliegende Bereiche auswählbar. Kundeneingriffe behalten die ursprüngliche Kontur und lösen ihre aktuelle automatische Geometriebestätigung ab. Fehlt eine eindeutige Kontur, bleibt die lokale Rechteck-Nachbearbeitung als begrenzter Fallback bestehen.

Die Modell-Confidence ist keine kalibrierte Wahrscheinlichkeit. Ein vorhandener Beschriftungsausschnitt beweist insbesondere nicht selbst, dass eine bestimmte Nummer/Nutzung darin korrekt gelesen wurde. Die Korrektur widersprüchlicher Boxen bleibt deshalb eine semantische Zuordnung mit expliziter Prüfung; zusätzliche Dokumente und separat annotierte Labels müssen ihre Zuverlässigkeit belegen.

Beschriftungsbasierte lokale Bereiche benötigen echte umschließende Kanten. Ein Wort oder ein Eintrag in der Raumtabelle wird nicht zu einer erfundenen Bereichsbox. Tore, Tränken und Bürsten verwenden nicht den umschließenden Raum als Objektposition. Kleine Geräte benötigen konkreten Beschriftungs-/Legenden- oder Symbolgeometriebeleg; Farbe allein reicht nicht. Die Belege bleiben Modellbeobachtungen und benötigen Prüfung.

Eindeutige Bereichslabels korrigieren widersprüchliche Modellkategorien deterministisch; der ursprüngliche Modelltyp bleibt in der Evidenz. Die reine Labelkorrektur ändert keine Geometrie. Ein unabhängiger lokaler Vektorschritt kann Rechteckseiten an kontinuierliche PDF-Linien anpassen. Schraffuren und kurze Trenner zählen nicht als Grenze; Überhänge benötigen vier bestätigte Seiten. Originalbox, betroffene Seiten und Linienquellen bleiben erhalten. Dieser Schritt erhöht weder semantische Confidence noch Reviewstatus. Unregelmäßige Flächen lassen sich mit einer rechteckigen Box nur eingeschränkt beschreiben. KI-Konfidenz allein führt deshalb nicht mehr zur automatischen Übernahme einer Bereichsbox.

## Fachlogik und historischer Datensatz

Projektfragen werden einmal gespeichert. `PlanningPreferences` trennt gemeinsame `groupAnswers`, explizite `areaOverrides` und `additionalEquipment`. Eine Gruppe fasst alle bestätigten Bereiche desselben Typs zusammen; Zusatzwünsche dürfen eine Gruppe ohne Planobjekte bilden. Sie erhalten keine erfundene Position.

Antwortauflösung: Projekt → Bereichsgruppe → explizite Bereichsausnahme. `animalCount` auf Projektebene ist eine Gesamtsumme und wird nicht vererbt. Gruppenbestände bleiben durch Provenienz als Gruppensumme gekennzeichnet; sie dürfen nicht je Bereich aufsummiert werden. Globale Freitextwünsche bleiben ebenfalls auf Projektebene. Inaktive Fragezweige werden aus wirksamen Antworten entfernt, während Rohvorgaben zur Nachvollziehbarkeit erhalten bleiben. Leere Ausnahmen stellen Vererbung wieder her.

Notwendige Angaben werden je gemeinsamem Wunsch einmal gezählt, bei abweichenden Fragezweigen gezielt je Bereich. Bewusste Antworten wie „Noch offen“ oder „Planungsteam entscheidet“ übertragen eine Entscheidung an die Fachplanung; vollständige Wunschangaben bedeuten keine abgeschlossene technische Planung. `review.ready` bleibt die strengere technische Prüfung einschließlich Maßausnahmen. Die Oberfläche führt den Nutzer über drei Hauptschritte; Wünsche zeigen jeweils einen Abschnitt auf einer breiteren Fläche; technische Details sind sekundär.

`DOMAIN_RULES_VERSION` versioniert Fachregeln und Quellen. `getPlanningProducts` grenzt veröffentlichte Systemfamilien deterministisch nach Wünschen ein, wählt keine Artikel und bemisst keine Elektro-/Wasserinstallation. Die Fragen sind abgeleitete Vorarbeit, keine vom PATURA-Fachteam freigegebene Bedarfsbemessung.

`buildHistoricalSample` verknüpft ursprünglichen Handoff und finale Planerannotationen über Dokumenthashes. Vorhersagen und finale Systeme bleiben getrennt. Erfasst werden Geometrie, Belege, Fragen, fehlende Information, Entscheidungen und Maßkorrekturen. Gruppen-/Projektkontext und Antwortprovenienz bleiben erhalten; Projekt-Tieranzahlen werden ab Schema 1.3 nicht als Bereichsbestand gelernt. Eine Modellvorhersage wird nicht automatisch zu Ground Truth.

## Andere Entscheidungsmodelle

Stand 05.10.2026: Die [OpenAI Decisions API](https://openai.com/index/devday-2026-recap/) ist als begrenzte Vorschau angekündigt und beantwortet vorgegebene endliche Entscheidungen aus Text/Bild-Kontext. Eine öffentlich nutzbare Integration über den installierten SDK-Endpunkt liegt hier nicht vor. [Jev von TypeSafe](https://docs.typesafe.ai/models) nimmt derzeit ausschließlich Text an. Es ist daher kein direkter Ersatz für die visuelle Bereichsgeometrie. Es wird keine nicht verfügbare API simuliert und kein unbelegter Geschwindigkeitsgewinn behauptet.

Die getrennten Analysefunktionen erlauben später einen Vergleich: gleiche dokumentierte Regionskandidaten, Labels und mögliche Klassifikationen; Messung von Richtigkeit, False Positives, Latenz und Kosten. Vor einer Umstellung steht dieser Benchmark, nicht der Modellname.

## Sprache, Tierangaben und Eingriffe

Benutzertexte werden mit deutschen Vorlagen normalisiert, einschließlich Bereichsnamen, Zusammenfassung, Warnungen und Evidenz. Fremdsprachige Originalnamen/-beobachtungen bleiben in `originalLabel`, `originalEvidence` und `originalAnalysis`. Wiederholte Namen ohne echte Raumnummer erhalten eine ausdrücklich als „Bereich“ bezeichnete Anwendungsnummer.

Tierangaben kommen bevorzugt aus nahen nativen Textobjekten. Der bestehende Bereichsrequest kann explizite Bildbeschriftungen als getrennte Kandidaten lesen, ohne zweite Vision-Anfrage. Tierart/-gruppe müssen wörtlich belegt sein; eine Kopfzahl benötigt eine ausdrücklich bezeichnete Gesamtsumme. DJP, Kapazität und Raumbestände werden nicht umgedeutet. Kombinierte Quellen werden erneut auf Widersprüche geprüft. Vorbefüllung setzt mindestens 0,9 technischen Score und einen Beleg voraus; Herkunft bleibt bei Vererbung erhalten. Eine abgeschlossene Analyse zieht nicht mehr belegte automatische Vorgaben zurück. Bewusste Eingaben und geleerte Felder werden dabei nicht überschrieben.

Gelöschte Bereiche verlassen die aktive Ansicht und Wunschgruppen. Ein Tombstone mit Zeitstempel verhindert ein Wiederauftauchen derselben Fläche durch verspätete Ergebnisse; andere kleine Geräte innerhalb dieser Fläche bleiben unabhängige Objekte. Die Rückgängig-Aktion stellt den vorherigen Reviewstatus wieder her.
