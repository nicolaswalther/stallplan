# Machbarkeitsanalyse und MVP-Architektur

## 1. Architekturentscheidung

Das System sollte nicht als „PDF an ein LLM schicken“ gebaut werden. Ziel ist ein internes, nachvollziehbares Planmodell, auf das mehrere Analyseschichten einzahlen.

```text
PDF (später DWG/DXF)
        │
        ├── Deterministische Extraktion
        │     ├── Seiten
        │     ├── Text
        │     ├── geschriebene Maße
        │     └── später: Linien / Layer / Maßketten / Maßstab
        │
        ├── Rendering
        │     └── Seitenbilder
        │
        └── Semantische KI
              ├── Bereichstyp
              ├── Bounding Box
              ├── Confidence
              └── Evidence
                    │
                    ▼
             internes Planmodell
                    │
              Nutzer bestätigt
                    │
                    ▼
              PATURA-Fachlogik
              ├── relevante Systeme
              ├── Entscheidungspunkte
              ├── Fragen
              └── benötigte Maße
                    │
                    ▼
             Planungsdatensatz
```

## 2. Warum PDF vor DWG

PDF ist für den MVP klar vorzuziehen:

- Browserdarstellung ist robust und leicht verfügbar.
- PDF.js liefert Text und Seitenstruktur ohne proprietäre CAD-Abhängigkeiten.
- Vektor-PDFs enthalten oft bereits ausreichend Text- und Geometrieinformationen für erste deterministische Schritte.
- Scans können über Vision ergänzt werden.
- Die interaktive Prüfoberfläche lässt sich unabhängig vom späteren CAD-Import entwickeln.

DWG sollte erst folgen, wenn das interne Planmodell stabil ist. Sonst wird der CAD-Import zu früh zum Architekturtreiber.

### DWG/DXF später

Sinnvolle Strategie:

1. DWG serverseitig in ein analysierbares Austauschformat normalisieren.
2. Layer, Blöcke, Polylinien und Texte in dasselbe interne Koordinatensystem überführen.
3. Fachlogik und UI unverändert weiterverwenden.

Dadurch bleibt der Dateityp nur eine Importfrage.

## 3. Interne fachliche Objekte

Das zentrale Modell sollte langfristig ungefähr so aussehen:

```text
StallProject
  ├── PlanDocument
  │    ├── Page / Sheet
  │    ├── GeometryObject
  │    ├── TextObject
  │    └── Measurement
  │
  ├── Area
  │    ├── type
  │    ├── geometry
  │    ├── source
  │    ├── confidence
  │    └── reviewStatus
  │
  ├── DomainDecision
  ├── QuestionAnswer
  └── PlanningHandoff
```

Für jedes automatisch erzeugte Objekt gehören mindestens dazu:

- Quelle
- Erstellungszeitpunkt
- Confidence, wenn KI beteiligt war
- Bestätigungsstatus
- ursprünglicher Wert
- ggf. bestätigter / korrigierter Wert

## 4. Fachlogik statt Prompt-Wissen

Die Regel `Bereich → Systeme → Fragen → Maße` liegt im MVP in `lib/rules.ts`.

Beispiel:

```text
Fressbereich
  → SSV-Fressgitter / Fressplatzsysteme
  → Tiergruppe?
  → Tieranzahl?
  → Montageart?
  → gewünschte Fressplatzbreite?
  → vorhandene Rohrdimension?
```

Das Modell bekommt diese Produktauswahl **nicht** zur freien Entscheidung. Ein LLM kann später helfen, Antworten zu normalisieren oder Freitext zu verstehen, aber nicht die Produktregel ersetzen.

## 5. KI-Integration im MVP

Der API-Endpunkt `app/api/analyze/route.ts` nutzt die OpenAI Responses API.

Input:

- deterministisch extrahierter Text
- gerenderte Seitenbilder
- klare Begrenzung der zulässigen Bereichstypen

Output:

- Schema-validiertes JSON
- Bereichstyp
- Bounding Box
- Confidence
- Evidence
- erkennbare Maße
- Warnungen

Das Modell wird explizit angewiesen:

- keine Planung zu erzeugen
- keine Produkte auszuwählen
- fehlende Angaben nicht zu erfinden
- Maße nur bei tatsächlicher Erkennbarkeit auszugeben

## 6. Training vs. kein Training

### Jetzt: kein eigenes Modell trainieren

Für die erste Phase ist Training unnötig und wahrscheinlich kontraproduktiv. Zuerst muss klar werden, welche Zielobjekte, Fehlerklassen und Entscheidungen überhaupt stabil genug definiert sind.

Priorität:

1. Fachschema festlegen.
2. Historische Planpaare strukturiert annotieren.
3. Baseline mit allgemeinem Vision-Modell messen.
4. Korrekturen und Nutzerentscheidungen sammeln.
5. Erst danach prüfen, ob Fine-Tuning / Detection-Modell einen echten Vorteil bringt.

### Historische Planpaare

Die Kombination

```text
ursprünglicher Kundenplan
+
fertiger PATURA-Plan
```

ist extrem wertvoll, aber zunächst als **Dataset-Quelle**, nicht als ungefiltertes Trainingsmaterial.

Pro Paar sollten z. B. extrahiert werden:

```yaml
area:
  type: feeding_area
  source_geometry:
    length_m: 18.40
  source_labels:
    - Futtertisch
  final_system:
    - SSV-Fressgitter
  planner_decisions:
    - mounting_type
    - feeding_width
  missing_information:
    - animal_group
    - animal_count
    - pipe_dimension
```

Mit so einem Datensatz können später drei Dinge getrennt evaluiert werden:

- Bereichserkennung
- Geometrie-/Maßerkennung
- fachliche Entscheidungsunterstützung

## 7. Datenmodell für historische Planpaare

Empfohlene spätere Tabellen:

```text
projects
plan_documents
plan_pages
plan_objects
areas
measurements
area_reviews
questions
answers
planning_outputs
historical_pairs
annotations
model_runs
```

Besonders wichtig ist `model_runs`:

```text
model
prompt_version
input_document_revision
output_json
latency
review_changes
created_at
```

Damit kann später objektiv gemessen werden, ob ein neues Modell oder ein neuer Prompt besser ist.

## 8. Interaktive Planoberfläche

Der MVP nutzt normalisierte Bounding Boxes (`0..1`). Das ist absichtlich unabhängig von Pixelgröße und Bildschirmzoom.

Damit sind später möglich:

- Verschieben und Skalieren erkannter Bereiche
- Polygon-Markierungen statt nur Rechtecke
- Maßlinien
- Verknüpfung zwischen Bereich und Maßkette
- Layer ein-/ausblenden
- Referenzpunkte für Maßstabsbestimmung

## 9. Geometrie-Roadmap

### Phase A – aktueller MVP

- Seitenrendering
- Text
- explizite Maße mit Einheit
- semantische Bounding Boxes

### Phase B – Vektor-PDF

- Textkoordinaten
- Liniensegmente
- Rechtecke / Polylinien
- Maßlinienmuster
- Zusammenhang Text ↔ Maßlinie
- Maßstab aus vorhandenen Maßketten ableiten

### Phase C – CAD

- Layer
- Blockreferenzen
- Einheiten
- Polylinien
- wiederkehrende Symbole
- Mapping auf dasselbe interne Objektmodell

## 10. MVP-Erfolgskriterien

Der MVP sollte nicht daran gemessen werden, ob die KI „den ganzen Stall versteht“.

Sinnvolle KPIs:

- Anteil korrekt vorgeschlagener Bereiche
- Anteil der Vorschläge, die der Nutzer nur bestätigen muss
- Zeitersparnis bis zur vollständigen Planungsanfrage
- Anteil automatisch erkannter Maße, die bestätigt werden
- häufigste fehlende Angaben
- häufigste Nutzerkorrekturen pro Bereichstyp
- Zahl der manuellen Markierungen

Die wichtigste Metrik ist letztlich **reduzierte Vorbereitungszeit bei gleichbleibender oder höherer Datenqualität**.
