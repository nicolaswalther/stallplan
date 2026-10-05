# Bedienung, Kontrast und gezielte Bereichsprüfung

## Änderungen dieser Iteration

- Gemeinsame Farbwerte für lesbare Sekundärtexte und erkennbare Eingabefelder. Auswahlfelder zeigen einen dunklen grünen Hintergrund und ein Häkchen; Tastaturfokus besitzt eine deutliche 3-Pixel-Kontur.
- Wünsche: eine kompakte Abschnittsnavigation statt wiederholter Einleitungen, größere Antworten und Weiter/Zurück-Aktionen. Die Aktionszeile bleibt im scrollenden Desktop-Fragebogen sichtbar.
- Einzelabweichungen erscheinen bei mehreren gleichartigen Bereichen. Bei nur einem Bereich genügen die Gruppenvorgaben; bereits gespeicherte Einzelabweichungen bleiben trotzdem erreichbar.
- Auf kleinen Bildschirmen ist der Plan während der Wünsche zunächst eingeklappt. „Plan anzeigen“ blendet ihn ein. Die Desktopansicht behält Plan und Fragen nebeneinander.
- Einseitige PDFs benötigen keine deaktivierten Vor-/Zurück-Seitenknöpfe. „Bereich vergrößern“ passt die ausgewählte Markierung in den verfügbaren Planraum ein; „Seite einpassen“ kehrt zur Übersicht zurück.
- Nach der Sammelübernahme werden verbleibende Vorschläge ausgewählt und eingeblendet. Die Prüfung nennt den konkreten offenen Punkt: Position, Nutzung, Umrandung oder gesamter Gangverlauf.

## Geometrie ist ein eigenes Prüfsignal

`assessAreaBoundary` untersucht die **aktuelle** Box unabhängig von der Modell-Confidence und den bereits verschobenen Seiten. Eine unveränderte, exakt auf Linien liegende Seite zählt ebenfalls. Durchgehende bemalte Linien oder belegte gefüllte Wände müssen mindestens 85 % der jeweiligen Seite abdecken und höchstens drei PDF-Punkte entfernt liegen. Kurze Trenner und wiederholte Schraffuren sind weiterhin ausgeschlossen.

Die Sammelübernahme verlangt einen bekannten Bereich mit mindestens 0,8 semantischer Confidence und vier belegten Seiten. Gänge bleiben gezielt zu prüfen: Auch ein gut belegtes Rechteck beweist nicht, dass ein U-förmiger Gang vollständig erfasst wurde. Fehlende Vektordaten werden nicht als positiver Beleg behandelt. Manuelle Geometriekorrekturen löschen eine veraltete Seitenbewertung; die Korrekturhistorie bleibt erhalten.

`boundaryAssessment` enthält Methode, belegte Seiten und Linien-IDs im technischen Handoff. Das ist ein Geometriebeleg, keine kalibrierte Wahrscheinlichkeit und kein Nachweis vollständiger Raumsegmentierung.

## Referenz und Vergleich

Verwendet wurde die bereits aufgezeichnete echte Luna-Antwort des Obora-Plans, mit der produktiven deutschen Normalisierung und Vektornachbearbeitung. Diese Iteration benötigt **keinen neuen Modellaufruf**. Der PDF-Upload, das native Parsing und die Browserbedienung wurden erneut tatsächlich ausgeführt; die semantische HTTP-Antwort wurde für wiederholbare UI-Tests eingespielt.

| Prüfung | Ergebnis |
| --- | --- |
| Vorherige Sammelregel, nur Typ/Confidence | 9 von 10 Vorschlägen, einschließlich unvollständigem U-Gang |
| Neue Regel mit unabhängigem Seitenbeleg | 5 gemeinsam übernehmbar, 5 gezielt zu prüfen |
| U-Gang mit nur oberem Teilstück | Von Sammelübernahme ausgeschlossen; konkreter Verlaufshinweis |
| Native Referenzmaße, erneut aus echter PDF gelesen | 194/194 korrekt nach Wert und Position; 0 Fehlfunde, 0 falsche Einheiten |
| Sekundärtext auf Weiß, gemessene Browserfarben | 6,19:1 |
| Gewählte Antwort, Weiß auf Grün (stabiler Zustand) | 7,29:1 |
| Eingaberand gegen Weiß | 3,76:1 |

Die konservativere Sammelregel erhöht die Zahl der kurzen Prüfungen. Sie verbessert die Auswahl der automatisch zusammen übernommenen Vorschläge, **nicht** die unveränderte Flächen-IoU (0,8551 auf der groben Referenz dieser Antwort). Zwei fast richtige Liegeboxenrechtecke besitzen nur drei belegte Seiten. Ein rechteckiger Gang wird ebenfalls geprüft. Das ist der bewusste Preis dafür, fehlende Konturbelege nicht durch hohe Modell-Confidence zu ersetzen.

## Verifikation

119 automatisierte Tests einschließlich neuer Prüfungen für unveränderte Rechtecke, fehlende Seiten, Scans, unvollständige Gänge und veraltete Geometriebelege. TypeScript, ESLint und Produktionsbuild geprüft.

Playwright prüft Desktop und 390-Pixel-Mobilansicht: realer PDF-Upload, Rendering, Seitennavigation, Mausrad/Fit, Bereichsvergrößerung, Sammelübernahme mit gezielter Folgeauswahl, Verschieben/Skalieren/Escape, manuelles Zeichnen/Löschen/Rückgängig, Schrittwechsel, gemeinsame Vorgaben und Einzelabweichungen, bedingte Heizfragen, mobile Planeinblendung, Tastaturfokus, Kontrastwerte, Maßkorrektur, HTML-/JSON-Export, Neustart und Fehlerfälle. Ein simulierter 503 lässt alle 194 nativen Maße nutzbar. Verspätete widersprüchliche Analyse überschreibt keine Kundeneingaben. Gesunde Abläufe erzeugen keine Browserfehler; absichtlich ausgelöste Fehlermeldungen werden getrennt protokolliert.

Nächster Qualitätsgewinn bleibt die Segmentierung zusammenhängender Flächen mit Aussparungen und eine größere unabhängige Referenzmenge. Die neue Prüfsteuerung macht diese Lücke sichtbar, ersetzt ihre Lösung aber nicht.
