# Referenzprüfung, Methodenvergleich und Grenzen

Stand: 2026-10-05. Der Bericht gilt für den beigefügten Beispielplan, nicht für beliebige Stallpläne.

## Unabhängige Referenz

`tests/fixtures/obora-reference.json` wurde aus einer visuellen Prüfung des Originalplans erstellt, bevor die Produktionsdetektion ausgewertet wurde. Die PDF selbst ist nicht im Repository. Ihr SHA-256 wird vor jeder Evaluation geprüft.

- Eine um 270° rotierte Vektorseite, sichtbare Größe 1843 × 1191 PDF-Punkte.
- 194 geprüfte Maßvorkommen: 158 Planmaße, 18 Öffnungsbreiten, 18 Öffnungshöhen; 79 unterschiedliche Werte.
- 26 manuell zugeordnete Referenzketten und 18 unabhängig vermessene Maßlinien.
- 44 ausgeschlossene Nichtmaßangaben, darunter Raumkennziffern, Höhenkoten, Datum und technische Angaben.
- 16 visuell gelesene Räume; Raumgeometrien sind grobe Referenzen, keine exakte Segmentierungs-Ground-Truth.

Zentimeter sind durch den gedruckten Maßstab **1:100** und Vektorlängen belegt: Ein 600er Feld misst 170,04 pt und entspricht 5,999 m; 4224 entspricht 42,236 m. Teilmaßsummen wie **2994 + 1230 = 4224** bestätigen die Geometrie.

## Maßerkennung

| Methode | Korrekt | Fehlend | False Positives |
|---|---:|---:|---:|
| Ursprüngliche Regex auf exakten Referenztextboxen | 0 | 194 | 6 |
| Text + Vektorgeometrie + Maßstab | 159 | 35 | 0 |
| Zusätzlich geometrisch gestützte Öffnungsannotation | 194 | 0 | 0 |

Der ursprüngliche Browserablauf lieferte sieben falsche Einträge aufgrund zusätzlicher räumlicher Duplikate; Höhenkoten und ein Volumen wurden als Längen behandelt. Die Referenzbaseline nutzt exakte rotierte Textboxen und hat sechs False Positives. Beide Baselines erkennen kein echtes Referenzmaß.

Die finale positionsbezogene Evaluation ergibt:

| Metrik | Ergebnis |
|---|---:|
| Werte-/Positions-Precision | 100 % |
| Werte-/Positions-Recall | 100 % |
| Einheitenkorrektheit | 100 % (cm) |
| Maßtypenkorrektheit | 100 % |
| Mittlere Textbox-IoU | 0,875 |
| Mittlerer Textcenterfehler, unabhängiger Prüfer | 0,533 PDF-Punkte |
| Referenzierte Maßlinien | 18/18 |
| Maximaler Endpunktfehler | 0,000875 PDF-Punkte |
| Maßketten-Paar-Precision | 100 % |
| Maßketten-Paar-Recall | 86,93 % |

Korrekt erkannt werden unter anderem **14 × 600 cm**, Gesamtmaße **4224 / 4212 / 4172 cm**, Wandstärken **6 / 12 / 24 cm** und **90 / 205 cm**-Öffnungsangaben. Kein geprüftes Maß fehlt; keine False Positives im Referenzumfang. Die obere Fenstermaßkette wird wegen unterschiedlicher geometrischer Schienen in mehrere Gruppen getrennt. Alle Werte sind vorhanden, die Kettengruppierung ist noch unvollständig.

Die Produktion baut 27 zusammenhängende Ketten und 49 rechnerisch/geometrisch geprüfte Teilmaß→Gesamtmaß-Beziehungen auf. 158 geometrisch belegte Planmaße werden vorbereitet; 36 schwächer belegte Öffnungsangaben bleiben zur Ausnahmeprüfung. Ein hoher Einzelplan-Recall ist kein Anlass, schwächere Evidenz als sicher auszugeben.

Die reine strukturelle CLI-Analyse dauert hier etwa **0,7–0,9 Sekunden** einschließlich PDF-Extraktion, ohne Rendering und ohne API-Kosten.

## Bereiche: echter API-Lauf

Der erste erfolgreiche Browserlauf mit **GPT-6 Luna** lieferte in **19,6 Sekunden** neun Hauptbereiche: fünf Liegeboxenbereiche, zwei Laufgänge, einen Futtergang und einen Abkalbebereich. Alle neun damaligen Kategorien der Raumreferenz (Räume 7–15) waren richtig klassifiziert; Isolation 16 fehlte noch als Kategorie.

Nach Erweiterung um Tierbuchten, Isolation, Tränken und Bürsten findet ein zweiter realer Browserlauf in **25,1 Sekunden** alle **zehn Hauptbereiche 7–16**, einschließlich Isolation. Rohklassifikation: 9/10 korrekt; Raum 12 „korytarz paszowy“ wurde als Laufgang ausgegeben. Die zusätzliche deterministische Interpretation eindeutiger Labels korrigiert diesen Widerspruch im aufgezeichneten echten Ergebnis zu `feeding_area`, ohne eine Box oder einen Wert zu erfinden: **10/10 korrekt nach Normalisierung**. Das ist ein Regressionstest auf diesem Referenzplan, keine allgemeine Erkennungsquote.

Hilfsräume 1–5 und Melkhalle 6 gehören nicht zu diesem Produktumfang. Von allen 16 referenzierten Räumen werden deshalb zehn erfasst. Tore, Tränken und Bürsten sind nicht als Ground Truth annotiert; der aktuelle Modelllauf enthält hierfür keine Vorschläge und behauptet fehlende Ausstattung nicht als erkannt.

Die Geometrie bleibt deutlich schwächer als die Klassifikation:

- Mittlere Bounding-Box-IoU im zweiten Lauf: **0,649**; neun von zehn ≥ 0,5. Footprint-IoU: **0,641**.
- Laufgang 9 deckt nur etwa **36 %** des umlaufenden Gangs ab; die Rechteckform kann dessen U-Form nicht abbilden.
- Laufgang 13 reicht in benachbarte Buchten hinein; Abkalbung 15 und Isolation 16 decken nur etwa **61 % / 65 %** ihrer Referenzfläche ab.
- Das Modell meldet bei diesen Buchten trotzdem 0,97 Confidence. Deshalb bleiben **alle KI-Boxen prüfbare Vorschläge**. Eine Modell-Confidence allein bestätigt keine Geometrie mehr. Nutzer können Vorschläge gesammelt übernehmen oder gezielt korrigieren.

Diese Boxen sind keine verlässlichen finalen Planflächen. Nutzer können sie im Plan verschieben, skalieren, verwerfen oder neu markieren. Präzise Polygonflächen und Aussparungen sind der nächste notwendige Geometrieschritt.

## OCR-Experiment

Die Raumtabelle besteht aus gezeichneten Buchstabenpfaden: **0/16 Raumlabels** sind als PDF-Text vorhanden. Ein gezielt gerenderter 3×-Ausschnitt mit Tesseract (Englisch, PSM6) liest **15/16 Labels exakt**, alle 16 semantisch verständlich. Die native OCR dauert etwa 0,3–0,6 Sekunden.

OCR-Zahlen sind empfindlich gegenüber Auflösung und Vorverarbeitung: Je nach Variante stimmen nur 8–16 der 16 Flächenwerte. Ein heller Ganzseitenplan benötigt Kontrastvorverarbeitung, die andere Zeichnungsziffern verschlechtert. OCR wurde deshalb als Experiment für fehlende Beschriftungen untersucht und ersetzt keine nativen Maßzahlen. Generische Ausschnittserkennung und Browser-Worker-Leistung sind noch nicht geprüft; OCR ist noch nicht in der Produktionspipeline.

## Prüfung und verbleibende Grenzen

Automatisierte Regressionstests prüfen unter anderem Einheitenkonflikte, unbekannte Einheiten, gedrehte Texte, CropBox, Superskripte, getrennte Einheiten, Ketten, Höhenrollen, Teilergebnisse, Modellfallback, Review und historische Annotationen. Hinzu kommen Gruppenvorgaben, Bereichsausnahmen, bedingte Fragezweige, ehrliche Ungewissheit, Kopfzahlen mit korrektem Umfang, Antwortprovenienz, Geräte-False-Positives und sichere druckbare Exporte. TypeScript, ESLint und Produktionsbuild werden gemeinsam geprüft.

Playwright prüft Upload, Loading, Rendering, Zoom/Fit, Maßtext/-linie, Bereichsauswahl, Übernehmen/Verwerfen, Verschieben/Skalieren mit Audit und Escape, manuelle Markierung, Fragen, Korrekturaudit, Review, Export und Neustart. Weitere Durchläufe prüfen verspätete Ergebnisse, Reset während Parsing, beschädigte PDFs, mehrseitige Pläne und mobile Darstellung. Ein echter API-Lauf prüft den Upload bis zu den Luna-Bereichen; kontrollierte API-Antworten dienen den reproduzierbaren Randfalltests.

Die neue Wunschstrecke wird zusätzlich gegen aufgezeichnete erfolgreiche Luna-Ergebnisse geprüft: fünf Liegeboxenbereiche mit vier gemeinsamen Latexwünschen und einer Wasserbett-Ausnahme, gemeinsame Projekt-Tiergruppe, Zusatzwünsche für Tränken/Bürsten/Tore ohne Planposition, Heiztechnik- und Stromzweige, lesbare HTML-Übersicht, JSON 1.3, sekundäre Maßkorrektur und 390-Pixel-Ansicht. Die 36 technischen Maßausnahmen blockieren keine vollständig erfassten Wünsche; sie bleiben im Datensatz offen. Ein Nutzerbericht ist keine fertige Stallplanung und verschickt noch keine Anfrage.

Verbleibend:

- Ein realer Referenzplan liefert keine Generalisierungsquote. Zusätzliche unabhängige Vektor-, Misch- und Rasterpläne fehlen.
- Keine vollständige Auswertung von Clip-Pfaden, sichtbaren CAD-Layern, Transparenz oder Kurven.
- Maßrollen und Teilmaßsummen sind belegt; eine verlässliche Zuordnung `Maß → Bereich.width` fehlt.
- Mischseiten benötigen regionale Analyse. Visuelle Bereiche sind derzeit auf vier Seiten begrenzt; die Abdeckung wird ehrlich angezeigt.
- Raster-Maße sind durch kontrollierte Tests abgesichert, aber nicht gegen einen echten Scan evaluiert.
- Confidence-Werte sind technische Scores und noch keine empirisch kalibrierten Wahrscheinlichkeiten.

Der nächste Qualitätssprung besteht aus Polygonflächen plus Zuordnung über Maßbegrenzungen und einer größeren unabhängigen Testmenge. Der historische Dataset Builder verlangt explizite Planerannotationen und hält Vorhersagen getrennt von finalen Systemen. Es findet kein Training statt.
