# PATURA Stallplan Assistant

PDF hochladen → Plan prüfen → gemeinsame Wünsche festlegen → Planungsübersicht für die Fachplanung speichern.

## Start

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Optional in der **ignorierten** `.env.local`:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6-luna
```

Die lokale PDF-Analyse funktioniert auch ohne API-Schlüssel. `OPENAI_MODEL` überschreibt das bevorzugte Modell; bei nachgewiesener Modell-Nichtverfügbarkeit wird `gpt-6.1-sol` versucht. Ein fehlgeschlagener Analyseschritt verwirft keine erfolgreichen Ergebnisse anderer Schritte.

## Analyse

- PDF.js **Legacy Build und passender Worker**; `loadingTask.promise`, `page.cleanup()`, `loadingTask.destroy()`.
- Rotationskorrekte Textobjekte, Schriftgröße, Orientierung, Baseline und echte Vektorlinien aus dem Operator-Stream.
- Automatische Unterscheidung Vektor-PDF / Scan / Mischform.
- Maßtext plus Maßlinie, Endbegrenzungen, Maßketten und dokumentierter Maßstab. Zahlen ohne ausgeschriebene Einheit werden strukturell erkannt.
- Einheit nur mit belegter Zeichnungsangabe oder mehreren konsistenten Text-/Vektorlängen. Sonst `unknown`, ohne Umrechnung.
- Öffnungsbreiten und Öffnungshöhen bleiben unterschiedliche Maßtypen. Höhen besitzen keine erfundene Grundriss-Maßlinie.
- Zahlen aus Maßstäben, Höhenkoten, DJP, Flächen, Volumen und Titelblock sind keine gewöhnlichen Längenmaße.
- Automatische Bereichsrechtecke werden lokal an belegte PDF-Vektorgrenzen angepasst; Originalbox und Linienquellen bleiben erhalten. Keine zusätzliche KI-Anfrage.
- Semantische Bereichserkennung als separater Vision-Schritt. Vorhandene Vektor-PDF-Zahlen werden nicht erneut per Vision gelesen. Rastermaße haben einen eigenen optionalen Analyseschritt.
- PATURA-Systemmöglichkeiten und Fragen kommen aus versionierbaren Regeln, nicht aus Modell-Produktempfehlungen.

## Oberfläche und Daten

Der Plan steht neben einem Ablauf mit drei Schritten: **Plan prüfen, Wünsche, Übersicht**. Mausrad-Zoom funktioniert auch über markierten Bereichen; Umschalt + Mausrad verschiebt die Ansicht. Seitenwechsel steht oben, doppelte Fußleiste und permanenter Fertig-Status entfallen. Entfernte Bereiche verschwinden aus Plan und Liste und lassen sich direkt rückgängig machen; im technischen Audit bleiben sie nachvollziehbar. Ausgewählte Bereiche lassen sich verschieben und über vier Handles skalieren; Originalgeometrie und Korrekturhistorie bleiben erhalten. KI-Sicherheit allein bestätigt keine Bereichsgeometrie. Vorschläge können einzeln oder gesammelt übernommen werden.

Die Wünsche-Ansicht gibt dem Fragebogen mehr Bildschirmfläche und führt mit Weiter/Zurück durch einen Abschnitt nach dem anderen. Gleiche Bereichstypen teilen eine Vorgabe: beispielsweise alle Liegeboxen zusammen. Zwei bis drei notwendige Entscheidungen pro Gruppe betreffen Nutzung und Wünsche, keine Planmaße. Einzelne Bereiche dürfen davon abweichen; Herkunft und wirksame Antworten bleiben nachvollziehbar. Tierart, Situation und übergreifende Tiergruppe werden projektweit gespeichert. Die Gesamt-Tieranzahl wird nicht auf einzelne Bereiche kopiert.

Kontrastreiche Auswahlfelder, größere Eingaben und eine kompakte Abschnittsanzeige erleichtern die Bedienung. Mobil lässt sich der Plan während der Wünsche einblenden; auf dem Desktop bleibt er daneben sichtbar. Die Sammelübernahme berücksichtigt eigenständige Vektorbelege für die Bereichsseiten und führt anschließend zu offenen Umrandungen. Details und gemessene Ergebnisse: [Bedienung und Qualitätsprüfung](docs/USABILITY-QUALITY.md).

Tränken, Bürsten und zusätzliche Tore können auch ohne eingezeichnetes Objekt gewünscht werden. Frostschutz fragt nur bei Bedarf nach vorhandener Heiztechnik und einer gewünschten Ergänzung; elektrische Bürsten nach Strom, Außentore nach Windschutz. Weiterer Bedarf kann als Projektwunsch notiert werden. Die Fragen und möglichen Systemfamilien sind anhand offizieller Quellen abgeleitet und benötigen fachliche Freigabe: [PATURA-Recherche](docs/PATURA-RESEARCH.md).

Der primäre Export ist eine eigenständige **druckbare HTML-Planungsübersicht** mit gemeinsamen Vorgaben, individuellen Abweichungen und nummerierten Planvorschauen. Sie lässt sich im Browser als PDF speichern. Es wird keine Anfrage versendet. **Technische Details** enthalten Maße, Quellen und JSON-Export. Technische Maßprüfungen blockieren die Wunschübersicht nicht; im Handoff bleiben sie offen.

Erkannte Tierart, Tiergruppe und ausdrücklich bezeichnete Gesamt-Tieranzahl können mit Quellenhinweis vorbefüllt werden. DJP, Plätze und lokale Bestände werden nicht als Gesamtkopfzahl übernommen. Widersprüche bleiben offen, Nutzereingaben haben Vorrang. Die Anwendungsausgabe ist Deutsch; Originalbeschriftungen bleiben separat im Audit erhalten.

Der Handoff (`schemaVersion: 1.4`) enthält Gruppenvorgaben, Bereichsausnahmen, Antwortprovenienz (`project/group/area`), Zusatzwünsche sowie Textobjekte, Geometrie, Maßprovenienz und Korrekturhistorie. Ein Export mit offenen Angaben ist ausdrücklich als Entwurf erkennbar. Die Fachplanung bleibt beim Planer.

## Qualität prüfen

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run evaluate -- /pfad/zum/beispielplan.pdf tests/fixtures/obora-reference.json /tmp/evaluation.json
```

Die Evaluation prüft den SHA-256 des Dokuments und vergleicht jedes Maßvorkommen einzeln nach Wert und Position. Der Kundenplan selbst wird nicht im Repository gespeichert. Die Referenz umfasst 194 visuell geprüfte Maßangaben, 26 Maßketten und 44 ausgeschlossene Nichtmaßangaben.

Details: [Architektur](docs/ARCHITECTURE.md), [Evaluation und bekannte Grenzen](docs/EVALUATION.md), [Vektorgrenzen-Vergleich](docs/BOUNDARY-QUALITY.md). Der vorbereitete historische Dataset Builder liegt in `lib/evaluation/dataset.ts`; finale Systeme benötigen explizite Planerannotationen. Es findet kein Modelltraining statt.
