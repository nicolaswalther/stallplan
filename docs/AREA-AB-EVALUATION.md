# Wiederholte Bereichstests: Obora-Referenzplan

## Versuchsaufbau

Am 5. Oktober 2026 wurden mehrere **echte API-Anfragen** mit demselben
Dokument durchgeführt. Die Modellantworten, tatsächliche Modellnamen,
Request-Hashes, Laufzeiten und Token-Usage wurden vor weiterer Auswertung
aufgezeichnet. Die geometrischen Nachbearbeitungen sind davon getrennte,
kostenfreie Wiedergaben derselben Antworten.

Der Dokument-Fingerprint ist
`85c80c8338ddd03ce975a9bb52da8c2e9da5f63d8168258ee6543985ee9ff02e`.
Die unabhängige Referenz steht in
`tests/fixtures/obora-areas-reference.json`. Sie wurde durch visuelle Prüfung
vor diesen Versuchen erstellt und für die A/B-Auswertung unverändert
übernommen. Ihre Geometrien sind **grobe Raumflächen**, keine pixelgenau
abgenommenen Segmentierungen.

Bewertet werden die zehn Hauptflächen 7–16: fünf Liegeboxenflächen, zwei
Laufgänge, ein Fressbereich, eine Abkalbefläche und eine Isolationsfläche.
Nebenräume 1–5 und die Melkhalle 6 sind ausdrücklich außerhalb dieses
Tests. Für Tore, Tränken und Bürsten fehlen vollständige unabhängige
Annotationen; entsprechende Vorschläge werden separat als **unbewertet**
geführt. Ihre Richtigkeit lässt sich aus dieser Referenz nicht ableiten.

Raum 9 ist ein zusammenhängender Laufgang mit nicht rechteckigem Umriss
und zwei ausgesparten Liegeboxeninseln. Die Referenz enthält dafür einen
Polygonumriss und Aussparungen. Eine große Box über Liegeboxen ist deshalb
kein geometrisch korrektes Ergebnis, auch wenn sie den Gang vollständig
einschließt.

## Auswertung

`lib/evaluation/areas.ts` ordnet Ergebnisse und Referenzen räumlich mit
einem maximalen, eindeutigen Hungarian-Matching zu. Die Zuordnung verwendet
die Boxüberlappung auf derselben Seite, **ohne Klassen, Confidence,
Beschriftungen oder Raumnummern**. Dadurch bleiben beispielsweise
Fressbereich/Laufgang-Verwechslungen sichtbar.

- Räumliche Diagnose-Zuordnung: Box-IoU mindestens 0,10. Diese niedrige
  Schwelle erlaubt es, unvollständig erkannte Bereiche als solche zu zeigen.
- Klassen-Recall: richtiger Typ unter diesen räumlichen Zuordnungen,
  bezogen auf alle zehn Referenzflächen. Fehlende Bereiche zählen mit.
- Strenger Erkennungs-Recall: richtiger Typ **und** Footprint-IoU mindestens
  0,50. Aussparungen werden geometrisch berücksichtigt.
- Mittlere Footprint-IoU: alle zehn Referenzflächen; fehlende Bereiche
  zählen als null. Ein Mittelwert ausschließlich über erkannte Flächen
  würde die Qualität bei Auslassungen überschätzen.
- Zusätzlich: Flächenabdeckung, Präzision der markierten Fläche,
  Verwechslungsmatrix, falsche oder fehlende Erkennungen, Doppelungen und
  Stabilität je Referenzfläche über die Wiederholungen.

Footprint-Vergleiche integrieren die tatsächlichen Polygonflächen mit
geraden Kanten einschließlich Aussparungen und überlappender Teilflächen.
Sie verwenden keine grobe Pixelabtastung. Anwendungspolygone werden über
einen expliziten Adapter übergeben; das Evaluationsmodul errät keine
Koordinatenkonvention.

## A: Ausgangsanalyse

Methode A verwendet das vollständige Seitenbild, den vorhandenen nativen
PDF-Text und die bisherige geometrische Verfeinerung der Boxgrenzen.
Luna wurde dreimal, Sol zweimal mit identischen Eingaben je Modell
aufgerufen. Die Reihenfolge und verwendeten Request-Hashes wurden
aufgezeichnet.

| Modell | Durchläufe | Klassen-Recall | Strenger Recall je Lauf | Mittlere Footprint-IoU |
|---|---:|---:|---|---:|
| GPT-6 Luna | 3 | 96,7 % | 90 / 90 / 80 % | 0,8070 |
| GPT-6.1 Sol | 2 | 100 % | 90 / 90 % | 0,8636 |

Luna ließ in einem Lauf die kleine Liegeboxenfläche 7 aus. In einem
anderen Lauf entstand ein zusätzlicher Liegeboxenvorschlag. Der Fressbereich
wurde in diesen drei Aufrufen richtig klassifiziert, aber seine geometrische
Qualität variierte: Footprint-IoU 0,942 / 0,942 / 0,682.

Laufgang 9 wurde von Luna in allen drei Läufen auf ungefähr ein Drittel
seiner Fläche verkürzt: Footprint-IoU etwa 0,304. Sol erreichte dafür nur
0,342 / 0,345 und etwa 47 % Flächenabdeckung. Der Modellwechsel allein
löste die nicht rechteckige Geometrie nicht.

Die klassische Vektorverfeinerung war wirksam: Lunas mittlere
Footprint-IoU stieg gegenüber den unverfeinerten Modellboxen von 0,6197
auf 0,8070; bei Sol von 0,7961 auf 0,8636. Der strenge Recall blieb dabei
unverändert. Die Verbesserung betraf somit die Genauigkeit bereits
erkannter Flächen, nicht die fehlende Vollständigkeit von Laufgang 9.

## B: Lesbare PDF-Beschriftungen und direkte Raumanker

Methode B ergänzt die identische Ausgangsanalyse um einen automatisch aus
kurzen PDF-Vektoren gefundenen, hochauflösend gerenderten
Beschriftungsausschnitt und die **exakten nativen Positionen** der
Raumkennzeichen im Grundriss. Der Ausschnitt wird aus dem tatsächlichen
Dokument erzeugt. Weder Referenzklassen noch Referenzkoordinaten werden
dem Modell mitgeteilt.

| Modell | Durchläufe | Klassen-Recall | Strenger Recall je Lauf | Mittlere Footprint-IoU |
|---|---:|---:|---|---:|
| GPT-6 Luna | 3 | 100 % | 90 / 90 / 90 % | 0,8393 |
| GPT-6.1 Sol | 2 | 100 % | 90 / 100 % | 0,8938 |

Alle drei Luna-Aufrufe erkannten die zehn Hauptflächen mit passenden
Klassen. Die fehlende Liegeboxenfläche trat in diesen Wiederholungen nicht
mehr auf. Die ungeeignete Laufganggeometrie blieb jedoch bestehen:
Footprint-IoU 0,435 / 0,304 / 0,314. Seine Flächenabdeckung betrug
83 / 31 / 40 %, die Präzision der markierten Fläche nur 48 / 96 / 60 %.
Eine ausgedehnte Box über den Liegeboxen ist also weiterhin problematisch.

Sol lieferte für Laufgang 9 Footprint-IoU 0,345 / 0,597. Ein Lauf war
deutlich besser, die Unterschiede zwischen den Wiederholungen blieben
groß. Daraus folgt keine zuverlässige automatische Konturerkennung.

Auch bei Methode B verbesserten PDF-Vektorgrenzen die Boxen: Luna
0,6581 → 0,8393, Sol 0,8592 → 0,8938. Textidentität und geometrische
Umgrenzung sind getrennte Qualitätsprobleme und müssen getrennt behandelt
werden.

## C: Klassische Konturen aus PDF-Geometrie

Methode C verarbeitet dieselben fünf aufgezeichneten Antworten von B
weiter, ohne zusätzliche API-Anfrage. Ein ausschließlich auf nativen
PDF-Linien arbeitender Detektor sucht geschlossene freie Komponenten um
direkte Raumkennzeichen. Er unterdrückt wiederholte Schraffuren, prüft
Wandunterstützung und verwirft zum Seitenrand offene oder von mehreren
Raumankern belegte Komponenten. Die räumliche Auflösung ist ein
PDF-Punkt; das Verfahren ist eine nachvollziehbare geometrische
Näherung, keine exakte CAD-Flächentopologie.

Die Erkennung bekommt weder Referenznummernlisten noch Raumklassen oder
Referenzgeometrien. Im Beispiel entstehen sechs Kandidaten 7, 8, 9,
12, 13 und 14. Die anderen vier Räume bestehen die strenge
Komponentenprüfung nicht und behalten ihre bisherigen Boxen.

Ein Kandidat wird nur auf einen semantischen Bereich angewendet, wenn
dessen Originalbeschriftung eine eindeutige Raumnummer enthält, der
exakte native PDF-Anker mit Textobjekt-ID, Text und Koordinaten
übereinstimmt und die bisherige Markierung diesen Anker einschließt.
Mehrdeutige Nummernzuordnungen werden verworfen. Typ und semantische
Confidence bleiben unverändert; die Geometrie erhält eigene Provenienz.

| Modell | Aufgezeichnete B-Läufe | Strenger Recall je Lauf | Mittlere Footprint-IoU |
|---|---:|---|---:|
| GPT-6 Luna + Konturen | 3 | 100 / 100 / 100 % | 0,9070 |
| GPT-6.1 Sol + Konturen | 2 | 100 / 100 % | 0,9309 |

Laufgang 9 erreicht in allen fünf kostenlosen Nachbearbeitungen
Footprint-IoU **0,9586**, Flächenabdeckung **97,3 %** und Präzision der
markierten Fläche **98,5 %**. Sein Umriss bleibt einschließlich der
ausgenommenen Liegeboxen über alle fünf Antworten gleich. Die
U-Gang-Schwäche der unterschiedlichen Modellboxen wird damit in diesem
Referenzplan durch die klassische Geometrie gelöst.

Nicht jede andere Fläche wird dadurch genauer. Der native freie Raum
kann von der grob abgegrenzten Nutzungsfläche abweichen. Die folgende
Tabelle zeigt sämtliche Hauptflächen von Luna vor und nach der Kontur,
einschließlich kleiner Verschlechterungen und unveränderter Fälle.

| Raum / Funktion | B: mittlere IoU (Spanne) | C: mittlere IoU (Spanne) |
|---|---:|---:|
| 7 / Liegeboxen | 0,900 (0,892–0,904) | 0,877 (stabil) |
| 8 / Liegeboxen | 0,929 (0,901–0,985) | 0,937 (stabil) |
| 9 / Laufgang | 0,351 (0,304–0,435) | 0,959 (stabil) |
| 10 / Liegeboxen | 0,880 (0,863–0,908) | unverändert |
| 11 / Liegeboxen | 0,824 (0,721–0,911) | unverändert |
| 12 / Fressbereich | 0,942 (stabil) | 0,953 (stabil) |
| 13 / Laufgang | 0,966 (stabil) | 0,956 (stabil) |
| 14 / Liegeboxen | 0,871 (0,865–0,883) | 0,954 (stabil) |
| 15 / Abkalbung | 0,860 (0,658–0,961) | unverändert |
| 16 / Isolation | 0,870 (0,666–0,972) | unverändert |

Bei Sol sinken einzelne zuvor sehr gut passende grobe Raumextent-Boxen
ebenfalls leicht: Raum 7 von im Mittel 0,924 auf 0,877 und Raum 8 von
0,985 auf 0,937. Die Gesamtverbesserung wird deshalb nicht als
„jede Fläche besser“ dargestellt. Eine vollständige Fachannotation
der gewünschten funktionalen Nutzungsgrenzen bleibt notwendig.

Die strenge Präzision der zehn Hauptflächen beträgt bei C in allen
fünf Nachbearbeitungen ebenfalls 100 %. Dies gilt ausschließlich für
diesen begrenzten Hauptflächen-Test. Unbewertete kleine Einrichtungen
sind darin nicht enthalten. Modellboxen der vier nicht zugeordneten
Räume variieren weiterhin; Rasterpläne oder Pläne ohne eindeutige
native Raumkennzeichen benötigen andere Konturverfahren.

## D: Drei frische Aufrufe der integrierten Pipeline

Nach der Integration wurden drei weitere echte Luna-Aufrufe mit der
aktuellen Produktionspipeline durchgeführt. Diese Ergebnisse ersetzen
keine der zuvor gespeicherten Antworten. Alle drei Anfragen verwendeten
denselben Input-Hash
`3f40ff20a957fcde3818410275c59b253db72424a57ba7829a0dfac8bb2f5cad`.

Diese Prüfung zeigte eine zusätzliche Schwäche, die beim erfolgreichen
kostenfreien C-Vergleich nicht aufgetreten war: Der Fressbereich wurde
in den ersten beiden neuen Antworten richtig benannt, aber seine
Modellbox lag oberhalb der tatsächlichen Fläche. Die reale native
Raumnummer 12 lag außerhalb dieser Box. Der bisherige strenge
Zuordnungswächter verweigerte deshalb die Anwendung der korrekten
nativen Kontur; eine falsche Modellbox blieb sichtbar.

| D-Lauf | Strenge Präzision / Recall | Mittlere IoU aller Hauptflächen | Angewendete Konturen | Fehler |
|---|---:|---:|---:|---|
| Luna 1 | 90 / 90 % | 0,7749 | 5 | Fressbereich räumlich falsch; Raum 12 fehlt |
| Luna 2 | 90 / 90 % | 0,7835 | 5 | Fressbereich räumlich falsch; Raum 12 fehlt |
| Luna 3 | 100 / 100 % | 0,8720 | 6 | Keine strengen Hauptflächen-Fehlfunde |

Über alle drei frischen D-Läufe beträgt die mittlere Footprint-IoU
**0,8101**, der mittlere strenge Recall **93,3 %**. Die erfolgreichen
10/10-Ergebnisse der aufgezeichneten C-Antworten dürfen also nicht auf
diese neuen Anfragen übertragen werden. Der Hauptflächen-Test zeigt
zwei zusätzliche falsch lokalisierte Fressbereichsvorschläge und zwei
fehlende Referenzzuordnungen. Die Typen der räumlich zugeordneten
Bereiche sind richtig; es handelt sich hier um einen Positionsfehler,
nicht um eine Fressbereich/Laufgang-Klassenverwechslung.

| Raum / Funktion | D: mittlere IoU aller drei Läufe | Spanne |
|---|---:|---:|
| 7 / Liegeboxen | 0,8766 | stabil |
| 8 / Liegeboxen | 0,9370 | stabil |
| 9 / Laufgang | 0,9586 | stabil |
| 10 / Liegeboxen | 0,8996 | 0,8586–0,9704 |
| 11 / Liegeboxen | 0,9047 | 0,8704–0,9665 |
| 12 / Fressbereich | 0,3177 | 0–0,9532; zwei fehlende Zuordnungen zählen als null |
| 13 / Laufgang | 0,9561 | stabil |
| 14 / Liegeboxen | 0,9539 | stabil |
| 15 / Abkalbung | 0,6447 | 0,6044–0,6649 |
| 16 / Isolation | 0,6525 | 0,6118–0,6728 |

Der U-Laufgang erreicht in allen drei frischen D-Läufen weiterhin
IoU **0,958616**, Abdeckung **97,3007 %** und Markierungspräzision
**98,4805 %**. Die native Kontur dieses Bereichs ist damit tatsächlich
auch gegenüber neuen Modellantworten stabil. Abkalbung und Isolation
zeigen hingegen nur etwa zwei Drittel Flächenabdeckung; diese
unkorrigierten Boxen bleiben eine geometrische Schwäche.

Die Entscheidung, eine Kontur ausschließlich bei bereits richtig
positionierter Modellbox anzuwenden, muss folglich geprüft werden:
Ein eindeutig belegter Raum-Identifier und seine tatsächliche native
PDF-Geometrie können eine stärkere Quelle als geschätzte
Bildkoordinaten sein. Positionskonflikte brauchen eine explizite
Provenienz und gezielte Nutzerprüfung; eine hohe Modell-Confidence
allein belegt keine richtige Markierung.

### Tatsächlicher Aufwand von D

Jeder D-Aufruf enthält **9.236 Input-Tokens** einschließlich Bilder.
Der API-Schritt und die Gesamtpipeline-Zeit sind getrennt aufgezeichnet.
Die Preiswerte verwenden die datierten Standardraten und tatsächlichen
Cache-Teilzahlen, nicht eine Annahme pro PDF.

| D-Lauf | Output-Tokens | API-Schritt | Gesamtpipeline | Geschätzte USD |
|---|---:|---:|---:|---:|
| Luna 1 | 1.686 | 18,156 s | 22,927 s | $0,001997425 |
| Luna 2 | 2.116 | 18,720 s | 19,496 s | $0,001150630 |
| Luna 3 | 1.790 | 17,769 s | 18,411 s | $0,000987630 |

Mittelwerte: **18,215 s API**, **20,278 s Gesamtpipeline**,
**1.864 Output-Tokens**, **$0,001378562 pro Lauf**, entsprechend
**0,137856 US-Cent**. Alle drei D-Anfragen zusammen ergeben
**$0,004135685**. Der erste Request schreibt 9.233 Input-Tokens in
den Cache; die beiden Wiederholungen lesen diese Anzahl. Der
Zusatzaufwand gegenüber Methode B beinhaltet den integrierten
Prompt-/Kontextstand und darf nicht ausschließlich dem Crop
zugeschrieben werden.

## E: Identifier-Auflösung und abschließende frische Aufrufe

Die Konfliktbehandlung verwendet jetzt die eindeutige gelesene
Original-Raumnummer, ihre unmissverständliche Funktionsbezeichnung, den
einzigartigen nativen Anker und dessen eindeutig eingeschlossene
Vektorkomponente. Eine abweichende Modellbox darf dabei korrigiert
werden, wenn zusätzlich ein automatisch erzeugter Beschriftungsausschnitt
vorliegt und das semantische Ergebnis ausreichend sicher ist.
Originalbox und Konflikt bleiben im Audit erhalten. Ein solcher
Konflikt ist gezielt zu prüfen und wird nicht mit unauffälligen
Bereichen gesammelt übernommen. Mehrdeutige Identifier, Kundenkorrekturen
und angrenzende Einrichtungen werden nicht als Raumkontur umgedeutet.

Zuerst wurden **dieselben fehlerhaften D-Antworten kostenlos** durch
die korrigierte Zuordnung geschickt. Genau die beiden falsch liegenden
Fressbereichsboxen wurden anhand Raum 12 korrigiert; die dritte Antwort
blieb unverändert. Beide Korrekturen behalten
`contourProvenance.modelBoxConflict=true`. Der strenge Recall und die
Präzision steigen damit bei allen drei D-Wiedergaben auf 100 %; die
mittlere IoU steigt von 0,8101 auf **0,8737**. Diese kontrollierte
Nachbearbeitung belegt die Wirkung der Korrektur, ohne eine bessere
neue Modellantwort dafür auszugeben.

Anschließend folgten **drei weitere echte Luna-API-Aufrufe** der
korrigierten integrierten Pipeline mit dem gleichen Modellinput wie D.
Die neuen Antworten lagen bereits um die richtigen nativen Anker;
in diesen drei Antworten war deshalb kein Konflikt-Override nötig.
Die vier verbleibenden Modellboxen variierten weiterhin.

| Frischer E-Lauf | Strenge Präzision / Recall | Mittlere IoU aller Hauptflächen | Angewendete Konturen |
|---|---:|---:|---:|
| Luna 1 | 100 / 100 % | 0,9437 | 6 |
| Luna 2 | 100 / 100 % | 0,9406 | 6 |
| Luna 3 | 100 / 100 % | 0,8685 | 6 |

Die abschließenden frischen Läufe erkennen jeweils zehn Hauptflächen
mit richtigen Typen und Footprint-IoU ≥ 0,50, ohne Hauptflächen-Fehlfunde
oder Auslassungen. Die mittlere Footprint-IoU beträgt **0,9176**.
Laufgang 9 behält in allen drei Läufen IoU **0,958616**,
Abdeckung **97,3007 %** und Markierungspräzision **98,4805 %**.
Der Fressbereich liegt nun in allen drei Läufen auf der stabilen nativen
Kontur mit IoU **0,953241**.

| Raum / Funktion | E: mittlere IoU | Spanne |
|---|---:|---:|
| 7 / Liegeboxen | 0,8766 | stabil |
| 8 / Liegeboxen | 0,9370 | stabil |
| 9 / Laufgang | 0,9586 | stabil |
| 10 / Liegeboxen | 0,9188 | 0,9025–0,9351 |
| 11 / Liegeboxen | 0,9188 | 0,9044–0,9333 |
| 12 / Fressbereich | 0,9532 | stabil |
| 13 / Laufgang | 0,9561 | stabil |
| 14 / Liegeboxen | 0,9539 | stabil |
| 15 / Abkalbung | 0,8467 | 0,6178–0,9611 |
| 16 / Isolation | 0,8562 | 0,6253–0,9716 |

Die strenge 0,50-Schwelle verdeckt keine der dokumentierten Schwächen:
Im dritten E-Lauf decken Abkalbung und Isolation nur etwa **62–63 %**
der Referenzfläche ab. Ihre nativen Komponenten konnten nicht eindeutig
isoliert werden; diese zwei Nutzungen bleiben geometrisch unsicher.
Auch die zwei mittleren Liegeboxenreihen 10 und 11 verwenden weiterhin
unterschiedliche Modellboxen. Für die sechs mit einem eindeutigen
PDF-Identifier verbundenen Konturen entsteht dagegen dieselbe Geometrie
aus derselben Quelldatei. Weitere unabhängige Pläne müssen zeigen,
welcher Anteil anderer Dokumente diese Voraussetzungen erfüllt.

### Usage und Kosten der abschließenden E-Läufe

| E-Lauf | Input / Output-Tokens | API-Schritt | Gesamtpipeline | Geschätzte USD |
|---|---:|---:|---:|---:|
| Luna 1 | 9.236 / 1.688 | 17,022 s | 21,339 s | $0,000936630 |
| Luna 2 | 9.236 / 2.004 | 18,112 s | 18,757 s | $0,001094630 |
| Luna 3 | 9.236 / 2.074 | 18,578 s | 19,291 s | $0,001129630 |

Mittelwerte: **17,904 s API**, **19,796 s Gesamtpipeline**,
**1.922 Output-Tokens**, **$0,00105363 pro Lauf** beziehungsweise
**0,105363 US-Cent**. Alle drei E-Requests lesen 9.233 Input-Tokens
aus dem Providercache. Dies ist keine Zusage eines Cachetreffers für
einen neuen Kundenplan. Alle drei E-Anfragen zusammen kosten nach
den datierten Standardraten **$0,00316089**.

### Gesamter begrenzter API-Vergleich

| Gruppe | Echte Providerantworten | Usage-basierter Preis in USD |
|---|---:|---:|
| A: Ausgangsanalyse | 5 | $0,078336150 |
| B: Ausschnitt und native Anker | 5 | $0,084260715 |
| D: erste integrierte Pipeline, einschließlich Fehlerläufe | 3 | $0,004135685 |
| E: korrigierte integrierte Pipeline | 3 | $0,003160890 |
| **Gesamt** | **16** | **$0,169893440** |

Die Aufzeichnungen enthalten 16 unterschiedliche Provider-Response-IDs
und insgesamt **132.131 Input-Tokens** sowie **34.655 Output-Tokens**.
Der Betrag entspricht **16,989344 US-Cent** für diesen begrenzten
Vergleich. Fehlgeschlagene Qualitätsläufe wurden mitgezählt, kostenlose
Geometrie-Nachbearbeitungen dagegen nicht als neue Providerantworten
oder erneut bezahlte Requests. Diese Zahlen sind eine datierte
Usage-basierte Schätzung; die tatsächliche Anbieterabrechnung bleibt
maßgeblich.

## Tatsächlicher Browser-Upload nach der Integration

Ein zusätzlicher echter PDF-Upload im Browser löste genau einen weiteren
API-Aufruf aus und erhielt HTTP 200. Es wurden zehn Hauptflächen und
sechs native Konturen angezeigt; die getrennte PDF-Schicht lieferte
194 Maße. Die unabhängige Bereichsauswertung dieses Browserergebnisses
ergibt strenge Präzision und Recall **100 %**, keine Hauptflächen-Fehlfunde
oder Auslassungen und mittlere Footprint-IoU **0,8712**.

Laufgang 9 und Fressbereich behalten ihre stabilen nativen Geometrien
mit IoU 0,958616 beziehungsweise 0,953241. Abkalbung und Isolation
bleiben in dieser Antwort teilweise markiert: IoU 0,637994 und
0,645687. Der Browserlauf wird deshalb separat dokumentiert und nicht
zur Verschönerung der abschließenden E-Kohorte verwendet.

Der tatsächliche API-Schritt dauerte **19,307 s**; vom Upload bis zur
fertigen Analyse vergingen im Browser **29,441 s**. Usage: **9.236 Input-
und 2.142 Output-Tokens**, davon 9.233 Input-Tokens aus dem Cache.
Der berechnete Preis beträgt **$0,00116363**. Mit diesem siebzehnten
echten Request ergibt der gesamte begrenzte Vergleich **$0,17105707**,
entsprechend **17,105707 US-Cent**. Der Browser-Response enthält keine
Provider-Response-ID oder Source-/Input-Hashes; solche Metadaten werden
nicht aus früheren Anfragen erfunden.

Der Browser prüfte insbesondere den richtigen Treffer außerhalb der
ausgesparten Liegeboxeninsel sowie die Platzierung des Fressbereichs.
Es gab keine Laufzeit- oder Konsolenfehler. Zusätzlich bestanden vier
Browserabläufe für Planbedienung, gemeinsame Wünsche und Ausnahmen,
späte Fakten-/Provenienzänderungen sowie Maßkorrektur und Export.
**163 Tests**, TypeScript und ESLint bestanden vor dem abschließenden
Produktionsbuild.

Alle A/B/C/D/E-Aggregate, Einzellauf- und Raumkennzahlen, die 16
nachgewiesenen unterschiedlichen Benchmark-Requests sowie der
separate siebzehnte Browserrequest stehen im
[bereinigten maschinenlesbaren Ergebnis](evaluations/obora-areas-2026-10-05.json).
Es enthält Usage, Kosten, Zeitgrenzen und vorhandene Code-/Input-Hashes,
aber keine PDF-Datei, Bilder, vollständigen Modellantworten,
Provider-IDs oder Zugangsdaten. Das abschließende frische E-Mittel
von 0,9176 bleibt als maßgebliche abschließende Kohorte separat markiert.

## Tatsächlich gemessener Aufwand

Die Zeiten betreffen jeweils den vollständigen Bereichs-API-Schritt des
Testläufers; sie sind keine garantierte Produktlatenz.

| Methode / Modell | Mittelwert Zeit | Input-Tokens | Output-Tokens |
|---|---:|---:|---:|
| A / Luna | 20,69 s | 6.753 | 1.896 |
| A / Sol | 51,86 s | 6.753 | 2.848 |
| B / Luna | 19,05 s | 8.590 | 2.051 |
| B / Sol | 50,21 s | 8.590 | 2.880 |

Der zusätzliche Beschriftungsausschnitt erhöhte den Input in diesem Plan
um 1.837 Tokens. Sol benötigte in diesen Versuchen etwa zweieinhalbmal
so lange wie Luna. Einige Wiederholungen nutzten den Prompt-Cache;
Input-, Cache-Lese- und Cache-Schreib-Tokens sind in den Aufzeichnungen
getrennt enthalten. Kosten sind daher anhand der tatsächlichen Usage
und der jeweiligen Preisannahme zu berechnen, nicht durch einen pauschalen
Betrag pro Modell. Aktuelle Preisquellen und Grenzen einer Schätzung
stehen in `docs/MODEL-COSTS.md`.

## Zusätzlich gefundener Normalisierungsfehler

In einem ursprünglichen Sol-Ergebnis hieß ein korrekt als `gate`
klassifiziertes Objekt „Äußeres Tor der Isolationsbucht 16“. Der alte
Beschriftungsnormalisierer änderte es aufgrund des Wortes
„Isolationsbucht“ fälschlich zu `isolation`. Diese zusätzliche falsche
Bereichsklasse kam aus dem Anwendungscode.

Der Fehler wurde mit einer allgemeinen Beschriftungsregel korrigiert
und mit einem Regressionstest abgesichert. Eine kostenlose Wiederholung
der gespeicherten Originalantwort durch den korrigierten Normalisierer
und dieselbe Vektorverfeinerung hob die strenge Hauptflächen-Präzision
dieses Sol-Laufs von 81,8 % auf 90 %. Der Recall blieb 90 %. Historische
API-Antwort, ursprünglich ausgeliefertes Ergebnis und korrigierte
Wiedergabe bleiben getrennt dokumentiert; es war kein zusätzlicher
Modellaufruf.

## Wiederholen und erweitern

Die CLI akzeptiert eine aufgezeichnete Analyse mit `areas` oder einen
Manifest mit `runs`. Jeder Lauf enthält `id`, `model`, `areas`, optional
`durationMs` beziehungsweise `latencyMs`, `usage` und Metadaten.
`footprint` verwendet ausschließlich das dokumentierte normalisierte
Format `{parts:[{outer:[{x,y}],holes:[[...]]}]}`.

```sh
npx tsx scripts/evaluate-areas.ts runs.json tests/fixtures/obora-areas-reference.json evaluation.json
```

Die CLI führt selbst keine API-Anfragen aus. Bei einem angegebenen
Dokument-Hash prüft sie dessen Übereinstimmung mit der Referenz; sie
behauptet keine unabhängige Prüfung der Quelldatei allein aufgrund
dieser Metadaten.

Die Ergebnisse sind ein wiederholter Einzelfalltest, keine allgemeine
Genauigkeit von 90 oder 100 %. Insbesondere verändert die Optimierung
am selben Dokument die Aussagekraft nicht zu einem unabhängigen
Testsatz. Für belastbare Entscheidungen sind weitere von Fachplanern
annotierte Dokumente, eine Trennung von Entwicklungs- und Testplänen
und vollständige Annotationen der kleinen Einrichtungen notwendig.
