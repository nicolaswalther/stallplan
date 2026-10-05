# PATURA Stallplan Assistant

MVP für die automatisierte Vorarbeit bei Stallplanungen:

**PDF hochladen → automatisch analysieren → Bereiche kurz prüfen → fachliche Angaben ergänzen → Planungsdatensatz übergeben**

## Architektur

Die Anwendung trennt weiterhin klar:

1. **Deterministische PDF-Analyse** – PDF.js extrahiert Seiten, Textpositionen und explizite Planmaße.
2. **Semantische KI-Analyse** – OpenAI Vision erhält das Planbild plus positionsbezogene PDF-Textobjekte und schlägt Bereiche sowie zusätzliche Maße vor.
3. **PATURA-Fachlogik** – Produkte, relevante Maßtypen und Rückfragen kommen aus `lib/rules.ts`, nicht aus dem Modell.

Die KI erzeugt keine verbindliche Stallplanung.

## Stack

- Next.js 16 / React / TypeScript
- Tailwind CSS 4
- PDF.js Legacy Build
- OpenAI Responses API mit Structured Outputs
- Zod

## Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6.1-sol
```

`OPENAI_MODEL` ist optional. Ohne Angabe wird `gpt-6.1-sol` verwendet.

## Aktueller Ablauf

- PDF auswählen
- PDF wird lokal gerendert
- Text inklusive Positionen wird extrahiert
- explizite Maße mit Einheit werden deterministisch erkannt
- KI-Analyse startet automatisch
- Vision gleicht Planbild und positionsbezogenen PDF-Text ab
- Bereichsvorschläge werden geprüft oder gesammelt übernommen
- individuelle Fragen betreffen nur fachlichen Kontext wie Tierart, Tiergruppe, Tieranzahl und Nutzung
- Maße werden separat automatisch geführt und können bei Bedarf korrigiert werden
- strukturierter JSON-Handoff

## Warum die Maßerkennung jetzt besser ist

Die erste Version hat PDF-Text zu einem einzigen String zusammengezogen. Dadurch ging verloren, **wo** ein Maß auf dem Plan steht.

Jetzt wird jedes Textobjekt mit normalisierten X/Y-Koordinaten gespeichert. Die KI erhält damit z. B. nicht nur `12,50 m`, sondern zusätzlich seine Position auf der Seite und kann den Wert mit dem sichtbaren Maßstrich bzw. Stallbereich abgleichen.

Zusätzlich:

- höher aufgelöstes Seitenrendering
- Erkennung auch bei getrennten PDF-Textobjekten wie `12,50` + `m`
- räumliche Deduplizierung
- PDF-Maße und KI-Maße werden zusammengeführt
- Kundenkorrekturen bleiben separat nachvollziehbar

## Grenzen

- DWG/DXF ist noch nicht implementiert.
- Geometrische Längen werden bewusst **nicht aus Pixeln geschätzt**.
- Bei Scans ohne Textlayer hängt die Maßerkennung stärker vom Vision-Modell ab.
- Eine echte CAD-/Vektor-Geometrieanalyse von Maßlinien ist der nächste technische Qualitätssprung.

Weitere Architekturdetails: `docs/ARCHITECTURE.md`.
