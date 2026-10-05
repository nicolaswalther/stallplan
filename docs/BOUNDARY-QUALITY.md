# Deterministische Vektorgrenzen: Entwicklungsprüfung

**Historische Rechteck-Iteration.** Die folgenden Messungen dokumentieren den bisherigen Ansatz. Die aktuelle Produktion ergänzt diesen durch native Raumkonturen mit Polygonen und Löchern; der U-Laufgang ist damit vollständig dargestellt. Wiederholte Modelltests, einschließlich einer aufgedeckten und korrigierten Futtergang-Zuordnung, stehen in [AREA-AB-EVALUATION.md](AREA-AB-EVALUATION.md). Alte Hinweise auf fehlende Polygonunterstützung gelten für die hier dokumentierten früheren Versionen.

Quelle: echtes Kunden-PDF `obora mariusz-przyziemie(1).pdf`, SHA256 `85c80c8338ddd03ce975a9bb52da8c2e9da5f63d8168258ee6543985ee9ff02e`. 16.894 direkt aus PDF.js extrahierte Linien. Keine Bildschätzung oder handcodierten Planpositionen im Algorithmus.

Referenz: unabhängig und vorab visuell geprüfte, grobe Raumflächen. Vorher: aufgezeichneter echter Luna-Output, anschließend deterministisch normalisierte Klassifikation des zweiten realen Luna-Laufs. Identische zehn Bereiche vor/nach Nachbearbeitung. Die Referenz bildet Raumumrisse ab, keine pixelgenaue Segmentierung einzelner Liegeboxenteile.

| Methode | Mittlere Rechteck-IoU | Mittlere Flächen-IoU |
| --- | ---: | ---: |
| Luna-Koordinaten | 0,6491 | 0,6410 |
| Erste Liniennähe, mindestens 72% Kantenabdeckung | 0,8369 | 0,8208 |
| Konservative durchgehende Grenzen, mindestens 85%, Muster-Unterdrückung | 0,8328 | 0,8255 |
| Plus vollständig belegte Schließung rechteckiger Überhänge (Produktionsmethode) | 0,8679 | 0,8606 |

Produktionsmethode: lokale Korrektur der Rechteckseiten an durchgehenden gemalten PDF-Linien; kurze Trenner, Schraffuren und wiederholte Module ausgeschlossen. Schmale gefüllte Wandrechtecke können durch ihre beiden parallelen Seiten bestätigt werden, einzelne Linien ohne Strich nicht. Rechtecküberhänge werden nur bei vier bestätigten Seiten gekürzt; eine vorhandene Seite bleibt verankert. Box-Zentrum, Änderungen und Größenverhältnisse sind begrenzt. Das behebt die Ausdehnung des Laufgangs13 in Abkalbung/Isolation, ohne eine innenliegende Liegeboxeninsel zur Laufgangfläche zu erklären.

| Raum | Vorher Rechteck-IoU | Nachher Rechteck-IoU |
| --- | ---: | ---: |
| 7 | 0,7522 | 0,9776 |
| 8 | 0,7016 | 0,9851 |
| 9 | 0,3656 | 0,3870 |
| 10 | 0,8611 | 0,9188 |
| 11 | 0,5869 | 0,7045 |
| 12 | 0,7558 | 0,9423 |
| 13 | 0,5644 | 0,9657 |
| 14 | 0,6537 | 0,8649 |
| 15 | 0,6072 | 0,9611 |
| 16 | 0,6424 | 0,9716 |

Alle zehn groben Boxen verbessern sich. Neun von zehn Raumflächen erreichen weiterhin Flächen-IoU >=0,5. Raum9 bleibt mit 0,3140 Flächen-IoU schlecht: nichtrechteckiger U-förmiger Verkehrsbereich mit innenliegenden Liegeboxeninseln. Die Methodik erstellt keine erfundenen Polygone. Raum11 bleibt teilweise ungenau, weil seine Grenze zur angrenzenden Liegeboxenreihe kein eindeutig gemalter Raumrand ist. Semantische Modell-Confidence und Reviewstatus werden nicht erhöht; manuell korrigierte/gelöschte Geometrie, kleine Geräte und Rasterseiten bleiben unangetastet.

Laufzeit: ca. 10–25ms für die zehn Bereiche inklusive Indexaufbau über 16.894 Linien; reiner lokaler Rechenschritt ohne zusätzlichen API-Aufruf. PDF-Lifecycle unverändert.

Tests: elf gezielte synthetische Geometrietests (belegte vier Seiten, Audit/Confidence, kurze Trenner/Schraffuren, Rasterseiten/Symbole, Kundengeometrie, Einzel-/Konstruktionslinien, gefüllte Rechtecke, Grenzwerte, kompakte Quellen, vollständige Schließung, Verweigerung bei fehlender Wand und Liegeboxeninsel, vertikale Orientierung). Visuell geprüft: der lokale Vorher/Nachher-Screenshot zeigt echte PDF-Ausschnitte mit Vorher/Nachher-Koordinaten.

Grenzen: ein anspruchsvoller Referenzplan, keine allgemeine Genauigkeitsgarantie. Auch gezeichnete Maßlinien können in anderen Zeichnungskonventionen ähnliche Muster bilden; weitere unabhängige Referenzpläne bleiben notwendig. Nächster Sprung: Vektorflächen/Polygone mit Löchern, explizite Abgrenzung von Wänden, Fressgittern und Maßlinien, weitere unabhängige Kundenpläne.

## Neue echte Luna-Ausführung dieser Arbeitsrunde

Ein neuer echter API-Lauf (HTTP 200, etwa 24 s für die Anfrage) liefert zehn Bereiche und 194 deterministische Maße. Hier können deutsche Labels die Raumnummer weglassen. Die Zuordnung erfolgt deshalb mit dem Hungarian-Algorithmus: höchstmögliche IoU der ursprünglichen Modellboxen, eindeutige 1:1-Zuordnung, nur kompatible Bereichsarten. Dieselbe Zuordnung wird anschließend für die Nachbearbeitung verwendet. Die ursprünglichen Boxen stammen aus `boundaryRefinement.originalBbox`; die neue API-Ausführung wird nicht als derselbe Replay-Benchmark ausgegeben.

| Neue Ausführung | Mittlere Rechteck-IoU | Mittlere Flächen-IoU | Flächen-IoU >=0,5 |
| --- | ---: | ---: | ---: |
| Ursprüngliche Luna-Boxen | 0,6123 | 0,6221 | 7/10 |
| Erste Vektor-Nachbearbeitung | 0,8235 | 0,8345 | 9/10 |
| Mit belegter Korrektur schmaler Buchten | 0,8440 | 0,8551 | 9/10 |

Der neue Test legte eine konkrete Schwäche offen: Bei schmalen Buchten war die horizontale Suchdistanz allein 8 % der Modellbreite. Die rechte Wand der Isolationsbucht lag etwa 35 PDF-Punkte entfernt, die Suche erlaubte nur 11 Punkte. Die Suchdistanz berücksichtigt jetzt das Seitenverhältnis und bleibt auf 35 % der schmalen Breite begrenzt. Eine Grenze zählt weiterhin nur mit mindestens 85 % durchgehender Linienabdeckung; Größen-/Muster-/Audit-Grenzen gelten unverändert. Isolation 16 verbessert sich dadurch von 0,7663 auf 0,9716 IoU; keine der neun anderen Boxen verschlechtert sich. Ein zusätzlicher unabhängiger synthetischer Test deckt dieses Problem ab: nun zwölf Geometrietests.

Die Nachbearbeitung der neu aufgezeichneten API-Boxen erfolgte lokal, ohne einen weiteren API-Aufruf. `live-analysis.json` bleibt als tatsächlicher Originalablauf unverändert; das korrigierte Ergebnis steht in `live-refined-v2.json`. Der alte Replay-Test bleibt bei 0,8679 / 0,8606. Beim neuen Lauf bleibt U-Laufgang 9 unvollständig: Flächen-IoU 0,3043 und 31 % Referenzflächenabdeckung, obwohl die obere Teilfläche präzise liegt. Die Confidence einzelner gefundener Linien darf deshalb nicht als Confidence einer vollständigen Raumkontur verstanden werden. Polygone mit Aussparungen sind noch nicht implementiert.
