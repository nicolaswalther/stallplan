# GEA: vollständige Gangflächen und vereinfachte SVG-Ansicht

Prüfung vom 6. Oktober 2026, Ausgangscommit `0f8e310`. Referenz: `Burdelak_Piotr_k001.pdf`, SHA-256 `4d8db49a7f32b2a795a227a6828fd4b148fa9ca57ab2ae1efacf8bcd0fb54e47`. Kundendokumente, Bilder und rohe Modellantworten bleiben außerhalb des Repositorys.

## Ursache und geometrische Korrektur

Der markierte Hauptlaufgang umfasste nur einen beschriftungsnahen Ausschnitt. Die nativen Bodenschraffuren liegen hier teilweise 12,6 PDF-Punkte auseinander; der vorherige absolute 12-Punkte-Filter ließ diese Linien als Raumseiten zu. Außerdem teilten bemaßte Innenlinien die Futtertische künstlich auf.

Die Erkennung prüft jetzt regelmäßige parallele Linienfamilien anhand Abstand, Wiederholungszahl und Verhältnis zur Linienlänge. Entfernte echte Begrenzungswände bleiben erhalten. Lange Maßlinien werden durch tatsächlich vorhandene kurze diagonale Begrenzungsstriche und ihre lokale Zeichnungsfolge unterschieden; echte Querpassagen behalten ihre engen Grenzen.

Ein vollständiges offenes Gangband erfordert mehrere eindeutige gleiche Nutzungslabels, zwei belegte PDF-Rails und angrenzende unabhängig erkannte Liegeboxen. Größere Unterbrechungen sind nur an einer geometrisch belegten Querpassage zwischen solchen Boxenblöcken zulässig. Breite, Höhe, andere Nutzungslabels und Möbelüberlappungen werden geprüft. Es gibt keine Regeln für Dateinamen, erwartete Raumzahlen oder feste Plankoordinaten.

`stripProvenance` enthält die tatsächlichen Linien- und Text-IDs. Die Confidence 0,89 ist eine konservative Regelentscheidung, keine kalibrierte Wahrscheinlichkeit. Offene Gangenden bleiben überprüfbar. Kleinere Modellfragmente und größere Modellüberhänge derselben Beschriftung ersetzen diese native Geometrie nicht. Kundenkorrekturen behalten `originalStripProvenance` und entfernen die aktive geometrische Bestätigung.

## Darstellung

Die umschaltbare Ansicht **Original / Vereinfacht** nutzt die tatsächlichen PDF-Vektoren und dieselben normalisierten Flächen wie die Bearbeitung. Fressbereiche sind sandfarben, Liegeboxen grün mit einem dezenten Muster, Laufgänge blau. Eine kleine Legende erklärt die Farben; offene Vorschläge sind gestrichelt.

PDF.js liefert nun optional die originalen OCG-Layernamen je Linie. Nur ausdrücklich benannte reine Schraffur- und Beschriftungslayer werden ausgeblendet. Gemischte beziehungsweise unbekannte Layer bleiben erhalten. Kurze unbekannte Striche werden lediglich dezenter dargestellt. Native Liegeboxentrenner werden nicht als grafische Schraffuren geraten und gelöscht.

Im GEA-Plan werden 17.061 Linien aus Schraffurlayern und 19.956 Linien aus Beschriftungslayern ausgeblendet. 87.995 unterschiedliche verbleibende Segmente werden in zwölf SVG-Pfaden gebündelt. Die Aufbereitung dauert im lokalen Versuch ungefähr 0,2 Sekunden. Alle 149.003 Originalsegmente bleiben einschließlich Layerprovenienz im Planmodell und JSON-Handoff erhalten.

Auswahl, Verschieben, Skalieren, manuelles Markieren, Entfernen und Rückgängig verwenden dieselben Koordinaten in beiden Ansichten. SVG-Füllungen übernehmen Polygonlöcher und Korrekturen. Der Ansichtswechsel verändert die eingepasste Plangröße nicht. Die Maßansicht zeigt automatisch das Original. Ein SVG-Download liegt unter **Technische Details**.

Die aktuelle SVG-Präsentation bildet gerade native Segmente ab; Bézierkurven und kleine Rasterobjekte werden nicht rekonstruiert. Sie ist deshalb eine vereinfachte Nutzungsübersicht. Reine Scans, große Rasterzeichnungen mit einzelnen nativen Achsen und unvollständig lokalisierte Rasterinhalte verwenden das Original. Das farbige Ergebnis wird nicht als neuer Erkennungsbeleg an das Modell zurückgegeben.

## Messung

Die unveränderte, unabhängig grob geprüfte Teilreferenz enthält 14 Hauptflächen. Richtige Kategorie und Flächen-IoU mindestens 0,5 sind erforderlich. Zusätzliche Seiten-/Roboter-/Quergänge und kleine Geräte sind nicht vollständig annotiert; eine allgemeine Dokumentprecision lässt sich daraus nicht ableiten.

| Rein native GEA-Erkennung | Ausgangsstand | Korrigierter Stand |
| --- | ---: | ---: |
| Korrekt lokalisierte Hauptflächen | 5/14 | 11/14 |
| Falsche oder fragmentierte bewertete Vorschläge | 14 | 0 |
| Vollständige Hauptlaufgänge | 0/4 | 4/4 |
| Vollständige Futtertische | 0/2 | 2/2 |
| Doppel-Liegeboxenblöcke | 5/5 | 5/5 |

Die vier Gangflächen erreichen 0,953, 0,977, 0,979 und 0,981 IoU, im Mittel 0,973. Drei Spezialbuchten haben weiterhin keine sichere native Kontur. Die frische Ausgangsreproduktion korrigiert die ältere pauschale Angabe „11/14 native Hauptflächen“ im bisherigen Burdelak-Bericht: Kleine Gang-/Futtertischfragmente erfüllen die vollständige Referenzlokalisierung nicht.

Der native Vergleich umfasst acht Pläne. Der ungarische Abkalbeplan verbessert sich von 10/12 auf 11/12 geprüfte Hauptflächen. Der Produktionsplan bleibt bei 10/31; seine mittlere IoU über alle Referenzflächen steigt von 0,358 auf 0,383. Die übrigen fünf Dokumente bleiben in dieser nativen Teilpipeline unverändert. Null native Flächen bei einem anderen Plan bedeutet weiterhin ergänzende Semantik/OCR, nicht eine erfolgreiche Gesamterkennung.

Zwei echte GEA-Uploads liefern HTTP 200 mit Luna; der Analyse-Endpunkt benötigt ungefähr 31,6 und 28,2 Sekunden. Beide erhalten vier vollständige native Hauptgänge und fünf native Liegeboxenblöcke. Der zuletzt vollständig geprüfte Lauf liefert 21 Vorschläge, von denen 12/14 Hauptreferenzen ausreichend lokalisiert sind. Vier der 16 bewerteten Vorschläge erfüllen die Zuordnung nicht; fünf weitere Vorschläge sind ausgeschlossen oder unbewertet. Ein oberer Abkalbebereich fehlt, der Separationsbereich bleibt zu ungenau. Die globale semantische Qualität wird durch die SVG-Präsentation nicht garantiert.

Bildmaße bleiben variabel: sieben im ersten, zwei im zweiten neuen Lauf. Diese Runde verändert ihre Erkennung nicht. Der nächste technische Qualitätsschritt für sie bleibt regionales OCR mit eigenständiger Einheiten- und Positionsevaluation.

Der [strukturierte Messbericht](evaluations/gea-svg-2026-10-06.json) trennt native Vorher-/Nachher-Messung, tatsächlichen Modelllauf und reine Rendererprüfungen.

## Validierung und nächste Schritte

265 Tests, TypeScript, ESLint und Produktionsbuild bestehen. Zwei tatsächliche Modellaufrufe, ein Entwicklungs-Replay und ein Produktions-Replay wurden verwendet. Vollständig geprüft sind Upload, sichtbare SVG/Originalzeichnung, Auswahl, Mausradzoom über Bereichen, identische Umschaltkoordinaten, Verschieben/Skalieren mit synchronen Füllungen, Entfernen/Rückgängig, manuelles Zeichnen/Löschen, SVG-/JSON-Export, Original-Maßansicht, Wünsche, mobiles Layout und Neustart. Die Browserprüfungen zeigen keine Console- oder JavaScript-Fehler.

Weitere echte Uploads mit Flexicubicles, dem ungarischen Produktionsplan und dem Kacprzak-Scan prüfen den Renderer bei bewusst gestubbter API. Eine getrennte zweitseitige Rendererfixture prüft Vektor-/Rasterwechsel, erhaltene Ansichtspräferenz und Klicks durch Polygonlöcher. Diese Prüfungen behaupten keine zusätzliche Modellqualität.

Als nächstes sollten native Gangkandidaten und Spezialbuchten auf weiteren Symbolfamilien unabhängig annotiert werden. Danach lassen sich geschlossene beziehungsweise offene Konturen und Konflikte systematisch vergleichen. Für die Präsentation können künftig vollständige native Kurven-/Bildpfade ergänzt werden, sofern ihre Layerzuordnung und Darstellung zuverlässig erhalten bleiben.
