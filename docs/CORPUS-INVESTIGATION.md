# Sechs zusätzliche Stallpläne: Import, Maße und Bereichsqualität

Stand: 2026-10-06. Implementierung: `16d9a35cbfb40ae06b2cbab2093706b8ece56a13`. Die ursprünglichen PDFs bleiben außerhalb des Repositorys. [Referenzmanifest](../tests/fixtures/corpus/manifest.json), [Wiederholungsanleitung](CORPUS-REFERENCES.md) und [gemessene Ergebnisse](evaluations/corpus-2026-10-06.json) verbinden die Prüfungen über SHA-256.

## Konkrete Änderungen

- **Rzut importiert vollständig:** 180.145 native Linien überschritten bisher die Schema-Grenze 150.000, obwohl 4 MiB komprimiert/64 MiB entpackt eingehalten wurden. Das Schema erlaubt jetzt 350.000 Linien pro Seite; Transportbudgets bleiben erhalten. Keine Linien werden abgeschnitten.
- **Maßlinien aus echten PDF-Segmenten:** kurze unmittelbar anschließende CAD-Endstücke werden mit dem Hauptsegment verbunden. Originalobjekte, beteiligte IDs und tatsächliche Endpunkte bleiben erhalten. Minimale CAD-Rotation langer Gesamtmaßlinien wird mathematisch berücksichtigt.
- **Lokale Einheiten:** Dezimalmeter und ganze Zentimeter können auf demselben Blatt vorkommen. Mindestens drei unabhängige passende Rails derselben Zahlenschreibweise müssen die lokale Einheit belegen. Lettische ausdrücklich erklärte Maßketten-mm werden getrennt von Höhen-m gelesen. Unbewiesene Einheiten bleiben unknown.
- **Zahlenklassifikation:** konsekutive Achsreihen, Raum-ID-Blöcke und symbolische Zufallstreffer werden ausgeschlossen. Echte konsekutive Maße bleiben trotz größerer Schrift erhalten, wenn ihre eigene unabhängige Maßgeometrie stimmt.
- **Outlined Text:** Flexicubicles und Rzut enthalten gezeichnete Maßziffern statt nutzbarer PDF-Textobjekte. Sie erhalten jetzt eine getrennte konservative Bildmaßanalyse. Vorhandene native Zahlen werden per Positionsschutz nicht ersetzt.
- **Breite Grundrisse:** ab Seitenverhältnis 2,4 entstehen bis zu vier überlappende Bereichsausschnitte direkt aus der nativen PDF, je höchstens 1800 px/2 Mio. Pixel. Globale Koordinaten bleiben verbindlich. Beim geprüften Produktionsplan ist der sichtbare Gesamtplan byte-identisch zum bisherigen Rendering; die Maßanalyse verwendet weiter das Originalbild.
- **Semantik und Konflikte:** ungarische/lettische Begriffe, getrennte Futtergänge, Tierbuchten und Gebäudekontext werden gezielter behandelt. Eindeutige native Mist-/Futtergangbelege begrenzen widersprüchliche KI-Liegeboxenmarkierungen. Polygonlöcher und Nutzerkorrekturen bleiben geschützt. Platzangaben wie 2X16db werden nicht als Tierbestand übernommen.

Die Änderungen liegen hauptsächlich in `lib/analysis/{measurements,unit-detection,areas,area-consistency,project-facts}.ts`, `lib/geometry/dimension-lines.ts`, `lib/pdf/analysis-tiles.ts`, `lib/pdf-client.ts`, `lib/ai/{areas,context,measurements}.ts`, `lib/plan/request.ts` und dem Transport/Export der Workbench. Neue Details bleiben im technischen Audit; es gibt keinen zusätzlichen Bedienungsschritt.

## Gemessene native Maße

Bewertet werden Zahlenwert und Position, anschließend die Einheit. Die Referenzen wurden vor der Produktionsauswertung aus den Original-PDFs gebildet.

| Teilreferenz | Vorher korrekt | Jetzt korrekt | Jetzt korrekte Einheit |
|---|---:|---:|---:|
| Latvia |12/49|43/49|43/43 mm|
| Szekszárd Abkalben |39/39, Einheit unknown|39/39|39/39 m|
| Szekszárd Produktion |44/47, Einheit unknown|47/47|47/47 m|

Latvia erkennt jetzt unter anderem 5900, 5925, 41325 und 17700 mm sowie zahlreiche Innenmaße. Noch fehlen 200, 300, 430, 300, 430 und 650 mm. Keine zusätzlichen Längen-False-Positives im geprüften Umfang; die mittlere Textbox-IoU beträgt 0,875. Eine vorher falsch zugeordnete 3000-mm-Linie von 7,32 pt wird jetzt mit der tatsächlichen verbundenen 84,96-pt-Rail belegt.

Der Produktionsplan erkennt die zuvor fehlenden Gesamt-/Teilmaße 228,96/117,38/111,48 m. Die Abkalbe-Achskette 171,00 m und das äußere 171,39-m-Gesamtmaß haben unterschiedliche Bezugspunkte. Lokale 10/15/20 cm-Wandmaße wurden zusätzlich direkt im Original geprüft. Die insgesamt 170/173 ungarischen Kandidaten sind **nicht vollständig als Ground Truth annotiert**; aus 39/47 Referenztreffern folgt keine dokumentweite 100%-Precision.

Die Kombination aus PDF-Text, nativen Maßlinien, Endmarkierungen und lokalem Maßstab ist hier die beste belegte Methode. Die Ziffern werden nicht von einem Modell geschätzt. Bildmaße bei Flex/Rzut/Kacprzak bleiben separat zu prüfende Vorschläge; es gibt dafür noch keine vollständige positionsbezogene Referenz.

## Bereiche: beide letzten Läufe ausweisen

Ein Treffer benötigt die richtige Klasse und mindestens 0,5 Flächen-IoU. Alle Angaben gelten ausschließlich für die groben Hauptflächen der Teilreferenzen, einschließlich deren Ausschlüsse. Wiederholte Modellaufrufe sind keine neuen unabhängigen Pläne.

| Plan | Baseline korrekt | Letzter Lauf A | Wiederholung B | Fehlmarkierungen A/B |
|---|---:|---:|---:|---:|
| Latvia |0/6|5/6|4/6|0/1|
| Flexicubicles |10/13|10/13|8/13|2/1|
| Rzut |Importfehler|8/16|8/16|4/1|
| Szekszárd Abkalben |5/12|12/12|12/12|4/1|
| Szekszárd Produktion |2/31|14/31|26/31|26/7|
| Kacprzak |1/11|11/11|11/11|0/0|

Die handgezeichneten zehn Tierbuchten werden jetzt als Flächen erkannt; vorher wurden fast ausschließlich ihre Tore ausgegeben. Im Abkalbeplan helfen die nativen Nutzungsnamen und getrennten Geometrien deutlich. **Der Produktionsplan bleibt stark schwankend**, obwohl die zusätzliche Auflösung und klassische Belege helfen. Ein Zwischenlauf erreichte 25/31, ist aber kein Grund, nur diesen guten Lauf zu berichten. Flexicubicles verbessert sich bei der Flächenvollständigkeit nicht zuverlässig; Futtertisch und Gänge fehlen oder werden zu grob markiert. Rzut fehlen insbesondere spezielle Nebenbuchten und Teile der Erschließung.

Ein zusätzliches Sol-Experiment verwendete denselben Produktionsrequest zweimal. Beide Anfragen überschritten das bestehende 55-s-SDK-Limit. Es gab keine Antwort oder Usage; tatsächliches Modell und Kosten sind unbekannt. Die deterministische Fallbackausgabe ist **kein Sol-Qualitätsergebnis**. Der Standard bleibt Luna und `OPENAI_MODEL` bleibt verfügbar.

## Tests und technische Grenzen

244 Tests, TypeScript, ESLint und Produktionsbuild bestanden.26 echte Browseruploads in vier Runden; im letzten vollständigen Lauf alle sechs neuen sowie Obora und Burdelak mitHTTP 200 und ohne JavaScript-/Consolefehler. Diese Zahlen zählen Uploads, nicht einzelne parallele Modellschritte.

Die zusätzliche Bedienungsprüfung nutzt eine zuvor aufgezeichnete echte Rzut-API-Antwort, um UI-Aktionen getrennt reproduzierbar zu prüfen: Zoom über Markierung, Verwerfen/Rückgängig, manuelles Markieren/Löschen, Maßauswahl, gruppierte Wünsche, JSON-Export mit allen 180.145 Linien, mobiles Layout und Neustart. Die echten API-/Uploadprüfungen erfolgten separat. Obora behält 194/194 nativeMaße ohneFP/FN; Burdelak behält fünf native Liegeboxenmuster und null native Maß-FPs. Dessen ergänzende Bildmaße bleiben unvollständig und schwankend.

Offen sind insbesondere:

- native vollständige Liegeboxen-/Buchtenflächen statt modellabhängiger Sammelrechtecke; Grenzconfidence ist noch nicht auf einem unabhängigen Korpus kalibriert;
- gezielte OCR/Geometriezuordnung für gezeichnete Maßziffern und verschobene kurze Maßtexte;
- ein konservativer Fallback-Randfall: eine native nackte Achs-/Raumnummer kann Bildmaße auf einer sonst outlined Vektorseite noch sperren;
- mehrere Maßstäbe auf einer Seite sowie Summen gemischterm/cm-Ketten;
- nur die ersten vier Seiten erhalten visuelle Analyse; Detailbudget insgesamt vierBilder.

Der nächste größte Qualitätssprung ist eine allgemeine Extraktion geschlossener nativer Polygon-/Füllflächen mit wiederkehrenden Einrichtungsmustern und expliziten Beschriftungsankern. Farbe allein darf keine Nutzung bestimmen. Dazu gezielte OCR für Outline-Beschriftungen und anschließend Evaluation auf zusätzlichen zurückgehaltenen Plänen. Diese Runde liefert Referenzdaten und getestete Algorithmusverbesserungen; kein eigenes Modell wurde trainiert.
