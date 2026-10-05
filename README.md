# PATURA Stallplan Assistant

MVP für die strukturierte Vorarbeit bei Stallplanungen:

**PDF hochladen → deterministisch auslesen → KI-Bereichsvorschläge → Nutzer bestätigt/korrigiert → PATURA-Fachfragen → strukturierte Planungsanfrage**

Die Anwendung trennt bewusst drei Ebenen:

1. **Deterministische Analyse** – PDF-Rendering, Text und eindeutig geschriebene Maße werden im Browser mit PDF.js extrahiert.
2. **Visuelle / semantische Analyse** – OpenAI Vision analysiert gerenderte Seitenbilder zusammen mit dem bereits extrahierten Text und liefert ausschließlich strukturierte Vorschläge.
3. **PATURA-Fachlogik** – Produkte, benötigte Maße und Rückfragen kommen aus einer expliziten Regelbasis (`lib/rules.ts`), nicht aus dem Modell.

## Stack

- Next.js 16 / React / TypeScript
- Tailwind CSS 4
- PDF.js (`pdfjs-dist`)
- OpenAI Responses API mit Structured Outputs
- Zod zur Eingabe- und Antwortvalidierung
- Keine Datenbank im MVP; Ergebnis wird als nachvollziehbares JSON exportiert

## Start

```bash
npm install
cp .env.example .env.local
# OPENAI_API_KEY in .env.local setzen
npm run dev
```

Anschließend `http://localhost:3000` öffnen.

### Umgebungsvariablen

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
```

`OPENAI_MODEL` ist optional. Standard ist `gpt-5.6`.

## Was der MVP kann

- PDF per Drag & Drop einlesen
- jede Seite lokal rendern
- vorhandenen PDF-Text extrahieren
- eindeutig geschriebene `m`, `cm`, `mm`-Maße deterministisch erfassen
- Seitenbilder + PDF-Text an die KI-Analyse übergeben
- strukturierte Bereichsvorschläge mit Confidence, Evidenz, Seite und Bounding Box erhalten
- Bereiche bestätigen, verwerfen oder fachlich umklassifizieren
- eigene Bereiche per Maus direkt in den Plan einzeichnen
- pro bestätigtem Bereich ausschließlich hinterlegte PATURA-Fragen anzeigen
- Maße mit Quelle und Status getrennt speichern
- erkannte Werte durch Kundenwerte überschreiben, ohne die Provenienz zu verlieren
- finale Planungsanfrage als JSON exportieren

## Sicherheits- und Qualitätsprinzipien

- Die KI erzeugt **keine verbindliche Planung**.
- Die KI trifft **keine Produktauswahl**.
- Fehlende Angaben dürfen vom Modell nicht erfunden werden.
- KI-Ergebnisse sind standardmäßig `unconfirmed`.
- Manuell eingezeichnete Bereiche sind als `manual` gekennzeichnet.
- PDF-Text-Maße und KI-Maße bleiben nach Quelle unterscheidbar.
- Kundenseitig geänderte Maße werden als `customer` gespeichert.
- Die Fachlogik ist versionierbarer TypeScript-Code und damit testbar.

## Aktuelle Einschränkungen

- PDF zuerst; DWG/DXF noch nicht implementiert.
- Visuelle KI-Analyse ist im MVP auf die ersten vier Planseiten begrenzt. Text wird über weitere Seiten dennoch berücksichtigt.
- Echte Vektor-Geometrie, Maßkettenbeziehungen, Layer und Maßstabsableitung sind noch nicht implementiert.
- Daten werden noch nicht serverseitig persistiert.
- Die aktuelle Fachregelbasis ist ein startfähiges Beispiel und muss mit PATURA-Planern fachlich vervollständigt werden.

## Nächste sinnvolle Ausbaustufen

1. **Vektorgeometrie aus PDF:** Linien, Polylinien, Maßketten, Textpositionen und Maßstab separat extrahieren.
2. **Persistenz:** Projekte, Revisionen, Bereichsentscheidungen und Audit Trail in PostgreSQL.
3. **Historische Planpaare:** Kundenplan + fertiger PATURA-Plan als strukturierte Trainings-/Evaluationsdatensätze aufbereiten.
4. **DWG/DXF:** serverseitiger Import und Normalisierung in dasselbe interne Planmodell.
5. **Fachregel-Editor:** Regeln nicht mehr nur im Code, sondern versioniert über ein internes Admin-UI pflegen.
6. **Evaluation:** Erkennungsquote pro Bereichstyp, Fehlklassifizierungen und Nutzerkorrekturen messen.

Weitere Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
