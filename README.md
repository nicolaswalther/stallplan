# PATURA Stallplan Assistant

PDF hochladen → Maße und Bereiche automatisch vorbereiten → Ausnahmen korrigieren → wenige fachliche Angaben ergänzen → JSON für die Fachplanung exportieren.

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
- Semantische Bereichserkennung als separater Vision-Schritt. Vorhandene Vektor-PDF-Zahlen werden nicht erneut per Vision gelesen. Rastermaße haben einen eigenen optionalen Analyseschritt.
- PATURA-Systemmöglichkeiten und Fragen kommen aus versionierbaren Regeln, nicht aus Modell-Produktempfehlungen.

## Oberfläche und Daten

Der Plan steht neben einer schlanken Kontextspalte. Zoom, Seitenwechsel, manuelle Bereiche und direkte Auswahl bleiben möglich. Ausgewählte Bereiche lassen sich verschieben und über vier Handles skalieren; Originalgeometrie und Korrekturhistorie bleiben erhalten. Sichere Vorschläge werden vorbereitet; unsichere Ergebnisse lassen sich gezielt prüfen. Tierart und Neubau/Bestand werden einmal auf Projektebene abgefragt. Maße sind keine Fachfragen.

Der Handoff (`schemaVersion: 1.2`) enthält Textobjekte, Geometrie, Maßprovenienz, Einheitsevidenz, Prüfstatus, Originalwerte und Korrekturhistorie. Ein Export mit offenen Angaben ist ausdrücklich als unvollständig erkennbar. Die Fachplanung bleibt beim Planer.

## Qualität prüfen

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run evaluate -- /pfad/zum/beispielplan.pdf tests/fixtures/obora-reference.json /tmp/evaluation.json
```

Die Evaluation prüft den SHA-256 des Dokuments und vergleicht jedes Maßvorkommen einzeln nach Wert und Position. Der Kundenplan selbst wird nicht im Repository gespeichert. Die Referenz umfasst 194 visuell geprüfte Maßangaben, 26 Maßketten und 44 ausgeschlossene Nichtmaßangaben.

Details: [Architektur](docs/ARCHITECTURE.md), [Evaluation und bekannte Grenzen](docs/EVALUATION.md). Der vorbereitete historische Dataset Builder liegt in `lib/evaluation/dataset.ts`; finale Systeme benötigen explizite Planerannotationen. Es findet kein Modelltraining statt.
