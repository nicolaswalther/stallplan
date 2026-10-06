# Beispielpläne reproduzierbar prüfen

[Manifest](../tests/fixtures/corpus/manifest.json) und zugehörige JSON-Dateien enthalten unabhängig aus sechs Originalplänen gebildete Referenzen. Die PDFs, private Renderings und Modellantworten gehören nicht zur Sammlung. SHA-256 und Originaldateiname verbinden jede Referenz mit dem richtigen Dokument. Referenzpfade sind relativ zum Manifestverzeichnis.

Alle Flächenreferenzen sind **partiell und geometrisch grob**. Die drei Maßreferenzen enthalten visuell geprüfte Vorkommen mit nativen PDF-Textboxen; sie decken ausgewählte Maßketten ab. Boxen und Flächenpolygone sind im Viewport auf 0..1 normalisiert. `bboxPoints` bewahrt ergänzend die ursprünglichen PDF-Punkte und ist kein normalisiertes UI-Feld.

| Plan-ID | Flächen-Granularität | Maßreferenz / Einheit |
|---|---|---|
| `latvia` | Vier Abkalbebuchten-Reihengruppen und Hauptgänge | Native lineare Maße in mm; Höhenangaben laut Plan separat in m |
| `flexicubicles` | Verbundene Liegeboxenblöcke und zusammengefasste Gangbänder | Keine vollständige Maßreferenz; Vektorglyphen statt nativer Maßtexte |
| `rzut` | Verbundene Liegeboxenblöcke und Hauptnutzungsflächen | Keine vollständige Maßreferenz; cm plausibel, global nicht ausdrücklich belegt |
| `szekszard-calving` | Sicher benannte Hauptfunktionen | Ausgewählte Meter-Maßketten; Wandmaße zusätzlich in cm |
| `szekszard-production` | Verbundene Liegeboxenblöcke und Hauptgänge | Ausgewählte Meter-Maßketten; Wandmaße zusätzlich in cm |
| `kacprzak` | Zehn einzelne Bullenbuchten; alternativ zwei Buchten-Gruppen | Handskizze; Einheit unbekannt, linke 5000-/6000-Angaben widersprüchlich |

## Wiederholen

Die vorhandenen Befehle reichen aus. Original-PDFs separat bereitstellen und das konkrete Dokument anhand des Manifest-Hashes prüfen. Beispiel für deterministische Maßerkennung:

```bash
npm run evaluate -- "private-plans/LP-DzB_AR-1.1-i1 1. stāva plāns_2026-08-12.pdf" tests/fixtures/corpus/latvia-measurements-reference.json
```

`evaluate` liest das Original-PDF, prüft dessen SHA-256 und bewertet die deterministischen Maße. Dies startet keine KI-Analyse. Für einen Bereichsvergleich die tatsächliche Analyseausgabe als JSON mit `areas` und möglichst `documentHash` oder `documentSha256` auf oberster Ebene bereitstellen:

```bash
npm run evaluate:areas -- artifacts/latvia-analysis.json tests/fixtures/corpus/latvia-areas-reference.json
npm run evaluate:areas -- artifacts/kacprzak-analysis.json tests/fixtures/corpus/kacprzak-areas-reference-grouped.json
```

Der optionale dritte Pfad schreibt den Bericht in eine Datei; das Zielverzeichnis muss existieren. Mehrere Läufe können über das vorhandene `{ "runs": [...] }`-Format verglichen werden. Modell, Variante, Laufnummer, Dauer und Eingabehash mitführen, damit Vergleiche nachvollziehbar bleiben. Ein fehlender behaupteter Dokumenthash wird vom Bereichsbericht ausdrücklich angezeigt; die Dateizuordnung dann separat prüfen.

## Ergebnisse korrekt lesen

- Granularität vor dem Vergleich festlegen. Eine zusammengefasste Buchtenreihe ist nicht dasselbe Objekt wie ihre Einzelbuchten. Für Kacprzak gibt es deshalb zwei getrennte Referenzen. Doppelreihen werden in mehreren Plänen pro verbundenem Block zusammengefasst.
- `excludedAreas` und `unscoredKinds` erhalten. Sie kennzeichnen Nebenzeichnungen, unbestätigte Nutzungen, zusätzliche Verbindungsgänge oder nicht vollständig annotierte Geräte. Ein Treffer dort ist kein belegter Falschbereich.
- Zusätzliche erkannte Maße außerhalb der **partiellen** Maßreferenz sind zunächst ungeprüfte Vorkommen. Die numerisch als `falsePositives` ausgegebenen Restkandidaten müssen manuell gegen das Original geprüft werden; daraus keine dokumentweite Precision behaupten.
- Werte, Positionen und Einheiten getrennt betrachten. Wiederholte 5,00/600/5900 sind verschiedene Vorkommen. Ein richtiger Zahlenwert an falscher Position ist weiterhin ein Fehler.
- Achsnummern, Platz-/Stückzahlen, Raumkennungen, Flächen und Höhenkoten sind keine linearen Maße. In Latvia gelten mm für Maßketten und m für Höhen; in Ungarn stehen Meter- und Zentimetermaße auf demselben Blatt. Abweichungen bei Achsen und Höhen als eigene Fehlertypen dokumentieren, nicht durch globale Umrechnung kaschieren.
- Achssummen und äußere Gebäudemaße können unterschiedliche Bezugspunkte besitzen. Beispielsweise ergibt die ungarische Abkalbe-Achskette 171,00 m, während 171,39 m ein sichtbares äußeres Gesamtmaß ist. Das ist kein Beleg für einen falschen Gesamtwert.
- Die ungarische Abkalbereferenz lässt rosa Rinderplatzraster mit fachlich unbestätigtem Haltungssystem bewusst unbewertet. Titel, Farbe oder regelmäßige Stäbe allein liefern dafür keine sichere Klasse.

Referenzen bei Erkennungsfehlern nicht an die Vorhersage anpassen. Fachlich begründete Referenzkorrekturen separat dokumentieren. Für belastbare allgemeine Qualitätsaussagen weitere, bisher unbenutzte Projekte zurückhalten; diese sechs Beispielpläne dienen der Entwicklung und Regression.
