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
                Handoff 1.2
```

`lib/types.ts` ist unabhängig von React, PDF.js und OpenAI. Seiten speichern Textobjekte und normierte Geometrie; Maße referenzieren Originaltext, Maßlinie, Bezugspunkte, Kette, Einheitsevidenz und Signalwerte. Öffnungshöhen sind ein eigener Typ. Ein Teilmaß kann ein geometrisch und rechnerisch belegtes Gesamtmaß referenzieren.

## Module

| Modul | Aufgabe |
|---|---|
| `lib/pdf-client.ts` | Browserimport, Rendering, Legacy-Lifecycle |
| `lib/pdf/text-extraction.ts` | Rotation und Transformation der Textboxen |
| `lib/pdf/vector-extraction.ts` | PDF.js-6-Pfadbuffer, Grafikzustände, Linien, Dokumenttyp |
| `lib/geometry/dimension-lines.ts` | Linienindex, Text-/Linienbezug, Maßbegrenzungen |
| `lib/analysis/measurements.ts` | Maßkandidaten, Ketten, Öffnungspaare, Konfidenz |
| `lib/analysis/unit-detection.ts` | Maßstab, eindeutige Einheitenbelege, `unknown` |
| `lib/analysis/areas.ts` | Beschriftung plus reale vierseitige Vektoreinschließung |
| `lib/analysis/pipeline.ts` | Unabhängige Analysezweige, Teilergebnisse |
| `lib/ai/*` | Spezialisierte Bereiche / Rastermaße, Modelle, Kontext |
| `lib/plan/request.ts` | Validierung der normalisierten Eingangsdaten |
| `lib/plan/review.ts` | Positionsbezogene Fusion, Schutz der Kundenkorrekturen, Prüfung |
| `lib/rules.ts` | PATURA-Systemmöglichkeiten, Projekt- und Bereichsfragen |
| `lib/evaluation/*` | Messbare Qualität und annotierte historische Planpaare |

## Einheiten und Confidence

Eine Einheit ist keine Folge eines plausibel klingenden Zahlenwerts. Ein gedruckter Maßstab allein genügt ebenfalls nicht. Mehrere reale Vektorstrecken müssen mit den geschriebenen Werten in einer Einheit übereinstimmen; alternative Einheiten werden dagegen geprüft. Widersprüchliche oder fehlende Belege ergeben `unknown`. Explizite Einheiten am einzelnen Maß bleiben erhalten.

Die Confidence dokumentiert technische Signale; sie ist noch keine über viele Dokumente kalibrierte Wahrscheinlichkeit. Datenquelle und Review-Status sind getrennt. Eine Kundenkorrektur behält Originalwert, Originaleinheit und Zeitstempel.

## Semantik und Fehlergrenzen

Die Bereichsanalyse liest Nutzungsbeschriftungen und Einrichtungsmuster. Auf Vektor-PDFs ergänzt sie keine bereits vorhandenen Maßzahlen. Vision-Maße werden nur für textarme Raster-/Mischseiten angefragt, jeweils mit eigener Validierung. Ein API- oder Modellfehler lässt die deterministischen Maße bestehen. Tatsächlich verwendete Modelle werden protokolliert.

Beschriftungsbasierte lokale Bereiche benötigen echte umschließende Kanten. Ein Wort oder ein Eintrag in der Raumtabelle wird nicht zu einer erfundenen Bereichsbox. Unregelmäßige Flächen lassen sich mit einer rechteckigen Box nur eingeschränkt beschreiben.

## Fachlogik und historischer Datensatz

Projektfragen (Tierart, Situation) werden einmal gespeichert. Bereichsfragen beschreiben Nutzung, Tiergruppe und betriebliche Entscheidungen; Maßanforderungen bleiben eine technische Schicht. `DOMAIN_RULES_VERSION` versioniert die Fachregeln. Die aufgeführten Systeme sind Möglichkeiten für die spätere Fachplanung.

`buildHistoricalSample` verknüpft ursprünglichen Handoff und finale Planerannotationen über Dokumenthashes. Vorhersagen und finale Systeme bleiben getrennt. Erfasst werden Geometrie, Belege, Fragen, fehlende Information, Entscheidungen und Maßkorrekturen. Eine Modellvorhersage wird nicht automatisch zu Ground Truth.
