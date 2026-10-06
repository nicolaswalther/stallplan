# Burdelak: Prüfung und Reparatur der Analyse

Geprüft am 6. Oktober 2026 mit `Burdelak_Piotr_k001.pdf`, SHA-256 `4d8db49a7f32b2a795a227a6828fd4b148fa9ca57ab2ae1efacf8bcd0fb54e47`. Das Kundendokument, seine Bilder, API-Rohantworten und Zugangsdaten bleiben außerhalb des Repositorys.

**Aktualisierung:** Die [GEA-/SVG-Arbeitsrunde](GEA-SVG-ITERATION.md) reproduziert die zu kleinen Gangmarkierungen, korrigiert die native Ausgangsmessung auf 5/14 vollständig lokalisierte Hauptflächen und erreicht anschließend 11/14. Die dort getrennt ausgewiesenen neuen Messungen ersetzen die ältere pauschale native Angabe unten. Historische Modell- und OCR-Läufe bleiben als datierte Einzelversuche erhalten.

## Ursachen

Der Plan ist eine sehr dichte CAD-Mischform: eine Seite mit 2.384 × 1.684 PDF-Punkten, 89 normalisierten Textobjekten und 149.003 extrahierten Linien. Viele Maßziffern sind gezeichnete Pfade und deshalb keine PDF-Textobjekte.

1. Eine 1,6 MB große PDF erzeugte einen 23,45 MB großen Analyse-Request. Lokal kam bereits die Ausgangsversion mit HTTP 200 zurück; ein Fehler beim tatsächlichen Hosting wurde nicht reproduziert. Die Anfrage überschritt jedoch typische Funktionslimits deutlich.
2. 21 Positionszahlen und Flächenexponenten wurden fälschlich als Längenmaße akzeptiert. Kleine Glyphenstriche und Möbel-/Wandkanten lieferten scheinbare Maßlinien. Diese falschen Geometriemaße unterdrückten anschließend die Bildanalyse der tatsächlichen Maßketten.
3. Polnische Beschriftungen waren unvollständig klassifiziert. `GANEK GNOJOWY` bezeichnet einen Mist-/Laufgang; `SEPARATKA – 10 LEGOWISK` einen Separationsbereich mit zehn Plätzen.
4. Dichte Bodenschraffuren erschwerten die Bildanalyse. Wiederholte echte Modellaufrufe lieferten teilweise fünf passende Liegeboxenblöcke, teilweise eine Sammelfläche über mehrere Reihen und Gänge, teilweise überhaupt keine dieser fünf Flächen. Ein besserer Einzelaufruf beweist keine stabile Erkennung.

## Eingebaute Änderungen

- Verlustfreie Gzip-Übertragung mit 4 MiB Transportbudget und 64 MiB entpacktem Budget. Der Server liest begrenzte Streams, unterstützt bisherige unkomprimierte Clients und behandelt ungültige Kompression, JSON und Übergrößen ausdrücklich.
- Deutsche Fehlermeldung auch bei HTML-Fehlern des Hostings. Die lokale Analyse bleibt sichtbar; Wiederholen verwendet das bereits gelesene Dokument.
- Schriftgrößenbezogene Prüfung von Maßlinien, strengere echte Endbegrenzungen und Erkennung separat gesetzter Flächen-/Volumenexponenten. Die 21 nativen Fehlmaße verschwinden.
- Separate Bereichsansicht ohne ausschließlich ausdrücklich bezeichnete Schraffurlayer. Hier werden `A-Detl-Patt`, `GEA_Kreskowanie_ruszta` und `GEA_Kreskowanie_sloma` ausgeblendet. Originalansicht, Maßanalyse und sämtliche Vektorlinien bleiben erhalten; die ausgeblendeten Layer stehen im Audit. Gemischte Text-/Wand-/Ausstattungslayer werden nicht ausgeblendet.
- Erweiterte deutsche/polnische Bereichsklassifikation und gemeinsame Umgrenzung wiederholter Beschriftungen eines Streifens. Eine gezählte Ausstattung überschreibt keine ausdrücklich benannte Separations- oder Abkalbefunktion.
- Konservative geometrische Erkennung von Doppel-Liegeboxenreihen: paarige kleine PDF-Endkappen, durchgehende Stirnkanten und mindestens sechs regelmäßig angeordnete, auf beiden Seiten passende Trennstäbe. Keine Dateinamen, Plankoordinaten, erwarteten Anzahlen oder angenommenen realen Maße bestimmen das Ergebnis.
- Sammelflächen der KI dürfen keine belegten Einzelblöcke und ihre Zwischenpassagen überschreiben. Mehrere unabhängig beschriftete Gangstreifen begrenzen übergroße KI-Rechtecke. Nutzerkorrekturen und Polygone bleiben geschützt.
- Exakt vorhandene Beschriftungen stark belegter nativer Bereiche müssen auch räumlich zur KI-Box passen. Kleinere, überwiegend enthaltene KI-Fragmente derselben stark belegten Beschriftung erzeugen keinen zweiten Bereich. Schwach belegte Umgrenzungen erzwingen diese Prüfung nicht: die zweite Abkalbebeschriftung dieses Plans ist kein natives Textobjekt.
- Bildmaßvorschläge werden an ihren Textpositionen auf vorhandene PDF-Tinte geprüft. Dieser Filter beweist weder Ziffernwert noch Einheit. Scans, unvollständig ausgelesene Geometrie und echte Bild-/Kurvenregionen bleiben als mögliche Textquellen erhalten.
- Geometriequellen und Korrekturhistorie werden exportiert. Eine Nutzerkorrektur entfernt die aktive Musterbegründung von der veränderten Box und erhält sie als Originalbeleg.

## Gemessene Qualität

Die unabhängige, grob visuell geprüfte **Teilreferenz** enthält 14 Hauptflächen: zwei Futtertische, fünf zusammenhängende Doppel-Liegeboxenblöcke, vier Hauptgänge, zwei Abkalbebereiche und einen Separationsbereich. Weitere Seiten-/Roboter-/Quergänge sind ausdrücklich ausgeschlossen; kleine Geräte bleiben unbewertet. Die alternative Referenz gruppiert die oberen und unteren Liegeboxen jeweils als zwei Polygonteile. Keine dieser Referenzen rechtfertigt eine vollständige Dokumentprecision.

| Prüfung | Ergebnis |
| --- | --- |
| Native Doppel-Liegeboxenblöcke | 5/5 passend, keine zusätzlichen Musterflächen; mittlere Flächen-IoU 0,981 |
| Nur native Hauptflächen | 11/14 mit richtiger Klasse und Flächen-IoU ≥ 0,5 |
| Native falsche Längenmaße | 21 → 0 |
| Ursprünglicher Obora-Regressionsplan | 194/194 geprüfte Maße; keine zusätzlichen Musterbereiche |

Der native Fallback erkennt Futtertische, Hauptgänge und die fünf Liegeboxenblöcke ohne Modellaufruf. Die drei übrigen Referenzflächen bleiben anhand der nativen Geometrie zu klein oder fehlen. Modellhilfe kann sie ergänzen, ist aber weiterhin variabel. 0,88 Musterconfidence ist eine konservative Regelentscheidung, keine statistisch kalibrierte Erfolgswahrscheinlichkeit; die Vorschläge bleiben überprüfbar.

Ein Replay derselben echten Modellantwort vor/nach Textanker- und Fragmentschutz entfernt vier Fehl-/Doppelvorschläge: den in einen Gang verschobenen oberen Futtertisch, ein unteres Futtertischfragment und zwei verschobene Gangboxen. Die Teilreferenzabdeckung bleibt bei 12/14. Sieben weitere Vorhersagen erfüllen deren Zuordnungs-/Überlappungskriterien noch nicht; darunter fallen auch zusätzliche Gangflächen mit anderer Aufteilung. Die Abkalbe- und Separationskonturen bleiben zu klein. Diese verbleibenden Fehler werden nicht durch einen bevorzugt ausgewählten Modelllauf verborgen.

Der Titelblock nennt Meter **oder** Zentimeter. Eine passende Teil-/Gesamtsumme allein klärt diese Einheit nicht. Deshalb werden unzureichend belegte Werte unverändert mit `unknown` gespeichert.

Der abschließende echte Browserlauf liefert HTTP 200: 20 Bereichsvorschläge, davon 12/14 ausreichend lokalisierte Referenzflächen, mit mittlerer Flächen-IoU 0,810 über alle 14 Referenzen. Alle fünf Liegeboxenblöcke, beide Futtertische und vier Hauptgänge erfüllen die Kriterien. Fünf der 17 in dieser Teilreferenz bewerteten Vorschläge erfüllen die Zuordnung nicht; drei zusätzliche Vorschläge sind ausgeschlossen oder unbewertet. 27 Bildmaßvorschläge sind weiterhin unsicher und besitzen keine belegte Einheit. Die Übertragung umfasst 2.659.878 Bytes statt 24.139.206 Bytes entpackter JSON-Daten. Die API antwortet in etwa 36 Sekunden; Upload plus Browserprüfungen dauern 45,67 Sekunden. Der [Messbericht](evaluations/burdelak-2026-10-06.json) hält diesen Lauf und seine Grenzen fest.

Eine gesonderte Prüfung der 27 Bildmaßvorschläge ergibt innerhalb der drei Außenketten 19/30 Referenzvorkommen mit gleichem Wert und Position innerhalb von zwölf PDF-Punkten. Sieben weitere Boxen driften in den späteren oberen/unteren Modulen zu weit nach rechts; damit fehlen elf positionsrichtig zugeordnete Referenzvorkommen, darunter die vier linken Maße `11.60`, `17.83`, `8.58` und `38.00`. Ein zusätzliches `38.00` rechts liegt außerhalb dieser Teilreferenz und wurde direkt im PDF visuell als echte Länge geprüft. Der dritte obere `6.00`-Wert ist im hochauflösenden Originalausschnitt trotz Lüftersymbol lesbar; das OCR-Auslassen bedeutet keinen falschen Modellwert.

Auch unterhalb der Abstandstoleranz sind nicht alle Boxen gut: nur 17/25 mit einer tatsächlichen OCR-Textbox vergleichbare Vorschläge decken mindestens deren Hälfte ab. Der Positionsfilter verhindert leere Markierungen, ersetzt aber keine präzise Texterkennung. Deshalb sind **27 Vorschläge ausdrücklich nicht 27 vollständig richtige Maße**. Hier hat die Ersetzung freier Modellpositionen durch regionales OCR den nächsten belegten Qualitätsnutzen.

## Vergleich der Methoden

Text plus Vektorprüfung verhindert hier Positionsnummern als Fehlmaße, kann aber die gezeichneten Maßziffern nicht direkt lesen. Vereinfachte Schraffurbilder verbessern einzelne semantische Durchläufe, stabilisieren allein aber keine vollständige Bereichserkennung. Die geometrische Möbelprüfung liefert für die fünf unterstützten Blöcke den stärksten und reproduzierbaren Beleg.

Ein zusätzlicher Vergleich mit je einem Lauf von Luna und Sol ergab keinen belastbaren Modellgewinner: Luna lieferte Bereiche, der Sol-Bereichsschritt schlug fehl; sein separater Maßschritt war erfolgreich. Fehlgeschlagene Requests liefern hier keine vollständigen Usage-Daten. Aus diesem kleinen Versuch werden weder allgemeine Qualitäts- noch vollständige Kostenbehauptungen abgeleitet. Der Standard bleibt Luna mit unabhängig nutzbaren klassischen Ergebnissen.

### Noch experimentell: regionales OCR

PyMuPDF-Rendering, Entfernung ausschließlich bekannter langer Maßlinien und Tesseract auf drei manuell ausgewählten Außenmaßketten lesen 29/30 geprüfte Vorkommen wert- und positionsrichtig. Das umfasst oben 12/13, unten 13/13 und links 4/4. In diesen Ausschnitten wurden keine zusätzlichen akzeptierten Dezimalmaßtexte gefunden. Ein oberes `6.00` bleibt durch ein Lüftersymbol verdeckt. Höhere Auflösung allein beseitigt diesen Fehler nicht.

Die gelesenen Werte umfassen `6.00`, `72.00`, `11.60`, `17.83`, `8.58` und `38.00`; ihre Einheit bleibt unbestimmt. Zwölf Teilwerte `6.00` passen zum Gesamtwert `72.00`; die vertikale Summe `38.01` gegenüber `38.00` wird als Rundungsabweichung protokolliert.

**Dieser OCR-Versuch ist keine Produktionsfunktion und keine dokumentweite Precision.** Die Ausschnitte wurden für den Vergleich manuell festgelegt. Der nächste Maßqualitätsschritt ist ein optionaler OCR-Adapter mit automatisch aus nativen Maßlinien abgeleiteten Ausschnitten, eigenständiger Einheitenprüfung und Bewertung auf weiteren Plänen. Tesseract und PyMuPDF werden dadurch nicht zu neuen Pflichtabhängigkeiten der Anwendung.

## Reproduzierbare Prüfung

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run evaluate -- /pfad/obora.pdf tests/fixtures/obora-reference.json /tmp/obora-evaluation.json
npm run evaluate:areas -- /tmp/analysis.json tests/fixtures/burdelak-areas-reference-atomic.json /tmp/burdelak-evaluation.json
```

Die Browserprüfung verwendet echte PDF-Uploads und den lokalen Analyse-Endpunkt. Zusätzlich werden Rendering, Zoom über Markierungen, Verwerfen/Rückgängig, manuelles Zeichnen/Löschen, Maßhervorhebung, gemeinsame Wünsche, JSON-Export, mobiles Layout und Neustart geprüft. Eine gesonderte Fehlerprüfung simuliert einen HTML-413 des Hostings, prüft erhaltene native Bereiche und Wiederholen sowie den Wechsel zum gedrehten Obora-Plan.

209 Tests, TypeScript, ESLint und der finale Produktionsbuild bestehen. Der Browserlauf hat keine Console- oder JavaScript-Fehler. Alle 149.003 Vektorlinien, fünf Musterbelege, Layer-Audit und tatsächliche API-Usage bleiben im JSON-Export erhalten. Die neue Kurvenextraktion erhält die nativen Linien und Texte beider Testpläne unverändert; in einem gespeicherten schlechten Maßdurchlauf verwirft der Positionsfilter weiterhin 17/26 nicht ausreichend belegte Boxen und erhält alle 29 unabhängig korrekt positionierten OCR-Boxen.

Die Grenzen bleiben ausdrücklich: unterstützte Doppelreihen-Symbolfamilie, unvollständige Abkalbe-/Separationskonturen, variable zusätzliche KI-Flächen, gezeichnete Maßketten und nicht eindeutig belegte Einheiten. Die Prüfung ersetzt keine Fachplanerfreigabe.
