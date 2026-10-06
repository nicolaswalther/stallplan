# Umsetzungsauftrag für die bestehende Unternehmenspipeline

Diese Vorlage ist für das Entwicklungssystem gedacht, das den Assistenten später in die bestehende PATURA-Pipeline integriert. Sie beschreibt überprüfbares Verhalten und Schnittstellen; sie setzt weder den aktuellen Frontend-Stack noch einen bestimmten Modellanbieter voraus. Beim Kopieren den gesamten Auftrag übernehmen und die Unternehmensschnittstellen am Ende ergänzen.

## Kopierbarer Auftrag

Entwickle ein technisches Plananalysesystem mit optionaler KI-Unterstützung für die Vorarbeit der professionellen PATURA-Stallplanung. Arbeite direkt in unserem bestehenden Unternehmensprojekt, prüfe zuerst dessen Architektur und nutze vorhandene Upload-, Dokument-, Authentifizierungs-, Projekt- und Planungsschnittstellen. Implementiere und teste ausführbaren Code; liefere nicht nur eine Beschreibung.

Das System übernimmt vorhandene Informationen aus Kundenplänen und bereitet Wünsche und technische Daten für unser Stallplanungsteam auf. Der Fachplaner bleibt für die eigentliche Planung, Produktfreigabe und Bemessung verantwortlich. Erzeuge keinen autonomen fertigen Stallplan und keine frei erfundenen Produkt- oder Artikelvorschläge.

### 1. Produktablauf

1. Landwirt oder Händler lädt einen Plan hoch.
2. Analyse startet automatisch. Dokumentseiten und Dokumenttyp werden erkannt.
3. Text und Vektorgeometrie werden strukturell extrahiert. Maßkandidaten und Einheiten werden unabhängig von der Bereichsklassifikation analysiert.
4. Semantische Verfahren ergänzen Nutzungen und schwer lesbare Beschriftungen. Vorhandene native Informationen haben Vorrang.
5. Ergebnisse werden in ein normalisiertes Planmodell überführt. Semantische Sicherheit und geometrische Vollständigkeit bleiben getrennte Eigenschaften.
6. Der Nutzer sieht den Plan mit zurückhaltenden Markierungen und korrigiert überwiegend Ausnahmen. Er kann Bereiche verschieben, skalieren, ergänzen und löschen; gelöschte Bereiche erscheinen nicht weiter in der aktiven Liste.
7. Der Nutzer beantwortet wenige fachliche Fragen je Projekt und Bereichsgruppe. Gemeinsame Antworten gelten beispielsweise für alle Liegeboxen; einzelne Bereiche können abweichen.
8. Ein strukturierter Handoff mit Quellen, offenen Punkten und Audit-Trail wird an unsere Planungspipeline übergeben. Eine lesbare deutsche Übersicht ergänzt den Datensatz.

Die UI besitzt drei Hauptschritte: **Plan prüfen → Wünsche → Übersicht**. Der Plan dominiert während der Prüfung. Während der Wünsche erhält der Fragebogen mehr Platz; mobil kann der Plan eingeklappt werden. Technische Maße, rohe Evidenz und JSON bleiben erreichbar, stehen aber nicht im primären Nutzerablauf. Keine dauerhafte Anzeige „Analyse fertig“, keine doppelte Dateinamenleiste, keine künstlichen Analyse-/Übernahme-/Weiter-Schritte.

### 2. Technische Leitentscheidungen

Prüfe bei jeder Information zuerst: Ist sie direkt im Dokument enthalten? Kann sie strukturell gelesen oder geometrisch bestimmt werden? Nutze vorhandene PDF-/CAD-Strukturen, Mathematik und etablierte Geometrieverfahren vor OCR oder generativer KI. Vision darf weder vorhandene Textkoordinaten noch native Maßzahlen oder PDF-Linien durch Schätzungen ersetzen.

Trenne mindestens diese Module mit stabilen, testbaren Eingangs-/Ausgangstypen:

- Dokumentimport und Seitenklassifikation.
- Text-/Vektorextraktion und Rendering.
- Maße, Einheiten und Maßketten.
- Beschriftungen, Raumtabellen und deren Zuordnung zur Zeichnung.
- Nutzungs-/Symbolklassifikation.
- Bereichsgeometrie und Qualitätsbewertung.
- Ergebnisfusion und Quellenvalidierung.
- versionierte PATURA-Fachregeln und Fragen.
- Korrekturen, Handoff, Datensammlung und Evaluation.

Eine OCR-Seite ist kein Anlass, vorhandene native Zahlen erneut durch Vision zu lesen. Ein KI-Fehler darf erfolgreiche deterministische Ergebnisse nicht verwerfen. Analyseschritte dürfen parallel laufen, sobald ihre Eingänge vollständig sind. Teilfehler und tatsächlich bearbeitete Seiten werden nachvollziehbar angezeigt.

Wenn PDF.js eingesetzt wird, übernimm den funktionierenden Legacy-Lifecycle: passender Legacy-Build und Worker, `PDFDocumentLoadingTask`, `loadingTask.promise`, `page.cleanup()` und abschließend `loadingTask.destroy()`. Rufe nicht `pdf.destroy()` auf. Extrahiere Operator-/Pfaddaten vor dem Rendern, falls Rendering deren Buffer verändert. Verifiziere Rotation, CropBox, Transformationen und mehrseitige Dokumente mit tatsächlichen PDFs.

### 3. Dokument- und Bereichsanalyse

Unterscheide Vektor-PDF, Raster-/Scan-PDF und Mischform anhand tatsächlich vorhandener Text-, Vektor- und Bildobjekte. Speichere die Erkennungssignale. Für Vektor-PDFs nutze native Linien und Textpositionen. Rasterseiten benötigen Rendering und gegebenenfalls OCR. Mischformen können regional unterschiedliche Verfahren brauchen.

Als interne funktionale Kategorien verwende zunächst `feeding_area`, `cubicles`, `alley`, `calving`, `pens`, `isolation`, `gate`, `drinker`, `brush`, `unknown`. Die Taxonomie ist versionierbar und kann fachlich erweitert werden. Hilfsräume und Melkhalle dürfen nicht als Liegeboxen oder Fressbereiche ausgegeben werden. Eine Melkstelle begründet keine unbelegte PATURA-Melktechnikempfehlung.

Definiere die Begriffe eindeutig:

- `feeding_area`: Fressbereich/Futtertisch einschließlich ausdrücklich bezeichnetem Futtergang; nicht automatisch ein Tierlaufgang.
- `cubicles`: tatsächliche Liegeboxenreihen mit wiederkehrenden Boxeneinrichtungen; offene Tierbuchten sind keine Liegeboxen.
- `alley`: Tier-, Treib- oder ausdrücklich bezeichnete Verkehrsfläche. Ein U-förmiger Gang mit Inseln ist keine ausgefüllte Rechteckfläche.
- `calving` und `isolation`: unterschiedliche Nutzungen, wenn Beschriftungen oder eindeutige Hinweise sie trennen.
- `pens`: offene Gruppen-, Jungvieh- oder Kälberbuchten; Tiergruppe separat speichern.
- `gate`: konkrete Öffnungsgeometrie mit Tor-/Türsymbol oder ausdrücklicher Beschriftung. Eine beliebige Wandlücke beweist kein Torsystem.
- `drinker` und `brush`: ein konkreter kleiner Gegenstand, keine umschließende Raumfläche. Farbe allein ist kein Nachweis.

Beschriftungen können native PDF-Texte, gezeichnete Buchstabenpfade oder Rasterbilder sein. Eine fehlende native Raumbezeichnung bedeutet nicht, dass der Plan keine Beschriftung besitzt. Die aktuelle Implementierung findet dicht angeordnete kurze Vektorzüge automatisch und rendert die vermuteten Beschriftungsbereiche erneut aus dem echten PDF in hoher Auflösung; ein vergrößertes bestehendes JPEG genügt nicht. Innerhalb der ersten vier Seiten werden höchstens zwei Details je Seite vorbereitet und höchstens vier Details insgesamt im bestehenden semantischen Request verwendet. Die Beschriftung wird dadurch für Vision lesbar, ohne eine zweite verpflichtende KI-Anfrage. OCR bleibt eine getrennt evaluierbare Alternative, keine Voraussetzung dieser Methode. Überführe gelesene Zeilen in separate Beobachtungen mit Originaltext, Position, Seite und Qualität. Erfasse Tabellenraumkennziffern als Kennziffern, nicht als Maße.

Zuordnungsschritte müssen explizit sein: Tabellenzeile → gelesene Raumkennung → Raumkennung im Grundriss → tatsächliche Nutzungsfläche. Eine Tabellenzeile allein darf keine Position im Grundriss erzeugen. Widersprechen Tabellenbeschriftung und Einrichtungsinterpretation einander, speichere den Konflikt und führe den Fall zur Prüfung. Eindeutige Beschriftungen wie polnisch `korytarz paszowy` dürfen nicht zwischen Futtergang und Tierlaufgang wechseln.

Trenne **Klassifikation** und **Kontur**: Ein richtig erkanntes Liegeboxenmuster kann eine ungenaue Box haben; eine passende Wandkontur beweist keine Nutzung. Verwende geometrische Kandidaten und stabile Referenzen, statt das Modell sämtliche Koordinaten frei erfinden zu lassen. Bei Vektorplänen können kontinuierliche gemalte Linien Grenzen stützen; unterdrücke Schraffuren, Maßlinien und kurze wiederholte Boxentrenner. Korrigiere nur begrenzte, tatsächlich belegte Änderungen. Erhalte Originalgeometrie und verwendete Linien-IDs.

Übernimm die bereits umgesetzten Rechtecke und `AreaFootprint.parts` mit Außenringen und Löchern. Die generische Vektormethode bildet geschlossene Freiraumkomponenten aus strukturellen Linien und direkt ausgelesenen Raumkennzeichen. Nur eine Komponente mit genau einem gültigen Anker wird zugeordnet; randverbundene, mehrdeutige oder ungeeignete Komponenten werden verworfen. Ein tatsächlich gelesener nummerierter Nutzungsname muss eindeutig zur Kategorie passen. Keine planbezogenen Koordinaten und keine erwartete Raumanzahl fest verdrahten. Wenn zwei Vorschläge dieselbe Raumkennung behaupten, darf die Kontur nicht einfach beiden zugewiesen werden.

Wenn eine geschätzte Modellbox dem unabhängig belegten Raumanker widerspricht, kann die tatsächliche Kontur Vorrang erhalten: dafür sind eine starke semantische Beobachtung und ein wirklich vorhandener hochauflösender Beschriftungsausschnitt erforderlich. Die Abweichung bleibt als `modelBoxConflict` sichtbar und benötigt Prüfung; die KI-Box bleibt im Audit erhalten. Ohne diese zweiten Dokumentbelege bleibt eine entfernte Modellbox unangetastet. Polygone einschließlich Löchern werden angezeigt, exportiert und bei manuellem Verschieben/Skalieren samt Audit korrekt transformiert. Sammelübernahme benötigt getrennte belegte Kriterien für Nutzung und Geometrie. Eine hohe selbst angegebene Modell-Confidence ist keine ausreichend kalibrierte Freigabe.

Übernimm außerdem die am zweiten CAD-Testplan geprüften Verfahren aus [Burdelak: Analyseprüfung](BURDELAK-INVESTIGATION.md): verlustfreie begrenzte Request-Kompression, separate Bereichsrenderings ausschließlich ohne ausdrücklich benannte Schraffurlayer und native Doppel-Liegeboxenprüfung aus Endkappen, Stirnkanten und regelmäßigen beidseitigen Trennstäben. Erhalte `patternProvenance` mit tatsächlichen PDF-Quellen; KI-Sammelflächen dürfen belegte Komponenten und Zwischenpassagen nicht überschreiben. Andere Symbolfamilien werden nicht allein aufgrund ähnlicher Rechteckgrößen übernommen. Ein Textpositionsfilter muss echte Raster- und Kurvenpfade sowie unvollständige Extraktion berücksichtigen; fehlende gerade Segmente beweisen keine fehlenden Ziffern. Das dort beschriebene regionale OCR ist ein evaluierter Versuch und noch keine Produktionsfunktion.

Berücksichtige die sechs weiteren Dokumentfamilien aus [Korpusprüfung](CORPUS-INVESTIGATION.md) und [Referenzmanifest](../tests/fixtures/corpus/manifest.json). Ein Vektorplan kann sämtliche Ziffern als gezeichnete Pfade enthalten; fehlende Rasterbilder schließen eine ergänzende OCR/Bildanalyse deshalb nicht aus. Vorhandene native Zahlen und Koordinaten bleiben geschützt. Verbinde unmittelbar anschließende CAD-Maßsegmente mit ihren tatsächlichen Endpunkten und erhalte alle Quellobjekte. Bestimme gemischte Einheiten je Maß; unterschiedliche Zahlenschreibweisen benötigen mehrere unabhängige geometrische Belege. Echte Maßketten dürfen nicht wegen großer Schrift als Achsnummern gelöscht werden. Transport-, Pixel- und Seitenbudgets gelten unabhängig von Dokumentnamen oder erwarteten Anzahlen.

Breite Blätter benötigen begrenzte überlappende Ausschnitte aus der ursprünglichen PDF, keine Vergrößerung eines kleinen JPEGs. Ergebnisse bleiben in globalen Seitenkoordinaten; Ausschnitte und deren Überlappung erzeugen keine zusätzlichen Flächen. Eindeutige native Funktionsbeschriftungen dürfen Modellwidersprüche begrenzen, ohne Polygonlöcher oder Nutzerkorrekturen zu überschreiben. Halte Gebäudetitel, Einrichtungsflächen, Gänge, Keller und Schnitte getrennt. Die Korpusläufe zeigen weiterhin starke Modellschwankungen bei einzelnen Grundrissen; ihre Teilreferenzen sind Entwicklungsdaten und kein allgemeiner Genauigkeitsnachweis. Zwei Sol-Versuche überschritten das derzeitige 55-Sekunden-Limit ohne Antwort/Usage. Plane Modell- und Laufzeitvergleiche ausdrücklich mit, statt daraus eine ungemessene Qualitäts- oder Kostenannahme abzuleiten.

### 4. Maße und Einheiten

Erkenne Längenmaße auch ohne angehängtes `mm`, `cm` oder `m`. Nutze Textorientierung, Textgröße, Position, Maßlinie, Maßhilfslinien/-begrenzungen, Nachbarwerte, Teilmaßsummen und wiederkehrende Module. Speichere native Zahlen und deren ursprüngliche Textobjekte. Unterscheide planare Länge, Öffnungsbreite und Öffnungshöhe.

Eine Einheit kann explizit sein oder aus belegten geometrischen Zusammenhängen folgen. Maßstab allein oder ein plausibel klingender Wert genügt nicht. Prüfe konkurrierende Einheiten gegen reale Vektorstrecken, mehrere Maßketten und Teil-/Gesamtsummen. Bei widersprüchlichen oder schwachen Belegen bleibt die Einheit `unknown`; keine automatische Umrechnung in eine vermeintliche reale Länge.

Klassifiziere und schließe unter anderem Raum-/Achsenkennziffern, Daten, Zeichnungsnummern, Tierbestände, Vieheinheiten, Flächen, Volumen, Höhenkoten, Adressen und Maßstabangaben aus. `94 DJP` ist keine Kopfzahl und kein Maß, `2500 m³` keine Länge, `1:100` kein Maßobjekt, `0,00 = 136,6 m n.p.m.` eine Höhenreferenz.

Eine Maßkorrektur speichert Originalwert, Originaleinheit, korrigierten Wert und Zeitstempel mit Quelle `customer`. Kein Nutzer muss jedes zuverlässig belegte Maß einzeln bestätigen. Maße sind eine technische Datenschicht und keine regelmäßigen Fragen im Wunschfragebogen. Verknüpfe später `Measurement → describes → Area.width/length` nur bei tatsächlichem Bezug durch Maßbegrenzungen; bloße räumliche Nähe reicht nicht.

### 5. Normalisiertes Modell und Provenienz

Mindestens diese Objekte sind erforderlich:

```text
Project
  Documents → Pages → TextObjects / GeometryObjects / LabelObservations
  Areas
  Measurements / DimensionChains
  Relationships
  DetectedFacts
  PlanningPreferences → Project / Group / AreaOverride
  Questions / EffectiveAnswers
  PlanningHandoff / Audit
```

Alle automatisch ermittelten fachlich relevanten Werte besitzen Quelle, Belege, Seitenreferenz, technische Scores und gegebenenfalls Reviewstatus. Scores für Textauslesung, Geometriebezug, Kettenstruktur, Einheit und Semantik bleiben getrennt. Führe keine Scheingenauigkeit als statistische Wahrscheinlichkeit aus, solange Scores nicht empirisch kalibriert sind.

Die aktuelle Referenzimplementierung verwendet Handoff **1.4** in `lib/types.ts`. Übernimm dessen Bedeutung und scope-sichere Antwortauflösung; erweitere es bei Polygonen, OCR-Beobachtungen oder Analyseläufen versioniert. Quelle `ai` bleibt eine Modellbeobachtung, nicht Ground Truth. Deutsche Benutzertexte sind von fremdsprachigen Originalzitaten getrennt.

Kundenkorrekturen werden von verspäteten automatischen Antworten nicht überschrieben. Bewusst geleerte Felder bleiben leer. Entfernte Bereiche behalten einen Audit-Tombstone; aktive Ansicht und Wunschgruppen enthalten sie nicht. Rückgängig stellt ihren vorherigen Zustand wieder her. Ein ähnlich positionierter späterer Modellvorschlag darf einen gelöschten oder manuell korrigierten Bereich nicht erneut aktivieren.

### 6. Tierangaben, kurze Wünsche und Fachlogik

Tierart, Tiergruppe und Tieranzahl dürfen vorbelegt werden, wenn sie ausdrücklich dokumentiert und nicht widersprüchlich sind. Liegeboxen allein beweisen keine Milchkühe. Vieheinheiten, Kapazitäten oder eine lokale Zahl in einer Kälberbucht sind keine gesamte Projekt-Tieranzahl. Speichere den Umfang als Projekt-/Gruppen-/Bereichsangabe. Ziehe nicht mehr belegte automatische Vorbelegungen zurück; bewusste Kundenantworten bleiben erhalten.

Frage Projektinformationen einmal, Gruppenvorgaben je funktionaler Gruppe und Bereichsabweichungen nur auf Wunsch. Antwortauflösung: Projekt → Gruppenvorgabe → explizite Bereichsausnahme. Die gesamte Projekt-Tieranzahl wird nicht in jeden Bereich vererbt oder wiederholt aufsummiert. Inaktive bedingte Fragezweige fehlen in den wirksamen Antworten; Rohantworten können für den Audit erhalten bleiben.

Beschränke den primären Fragebogen auf zwei bis drei verständliche Entscheidungen je Gruppe, beispielsweise Liegefläche, gewünschte Fixierfunktion, Nutzung, flexible Teilung oder Frostschutz. Technische Maße werden nicht abgefragt. „Noch offen / beraten lassen“ ist zulässig und bedeutet eine Aufgabe für das Planungsteam. Zusatzwünsche für Tränken, Bürsten und Torsysteme können ohne erfundene Planposition hinzugefügt werden.

Tränken-Frostschutz fragt zunächst Bedarf, dann vorhandene Infrastruktur. Umlauf-/Ringleitung und Einzelheizung/Transformator sind verschiedene Systeme. Daraus folgt keine automatische Elektro-/Wasserbemessung. Tore unterscheiden inneren Tierdurchgang und Außenabschluss/Windschutz. Liegeflächen können vorhandene Ausstattung, Latexmatratze, Wasserbett, Noppenmatratze oder Einstreunutzung betreffen; Einstreu ist eine Nutzungspräferenz und keine behauptete PATURA-Produktfamilie.

Implementiere PATURA-Systemfamilien und Entscheidungspunkte als explizite, versionierte Regeln mit offiziellen Quellen und Fachfreigabe. Aktuelle Quellen und Fragen stehen in `docs/PATURA-RESEARCH.md` und `lib/rules.ts`. Ein LLM darf keine Artikel, Eignungen oder Preise erfinden. Verwende später unsere echte Wissensbasis und katalogisierten Freigaben über einen getrennten Adapter.

### 7. Modellwahl, Kosten und Reproduzierbarkeit

Vergleiche `gpt-6-luna` und `gpt-6.1-sol` bei identischen Dokumenten und klar dokumentierten Requestvarianten. Unterstütze `OPENAI_MODEL` beziehungsweise die entsprechende Unternehmenskonfiguration. Ein Modellwechsel allein gilt nicht als Qualitätsnachweis. Vergleiche ebenfalls bessere Beschriftungsextraktion, Kandidatenbildung und Geometriezuordnung. Ändere bei einem A/B-Vergleich möglichst eine Stellschraube.

Pro kostenpflichtigem Request speichere tatsächlich zurückgegebenes Modell, Anbieter-Request-/Response-ID, Prompt-/Schema-/Pipelineversion, Eingabehash, Bildauflösung, Reasoning-Einstellung, Laufzeit und vollständige `usage`. `output_tokens` enthält Reasoning-Tokens; deren Detailzahl darf nicht zusätzlich berechnet werden. Unterscheide normale Eingabe, Cache-Lesen und Cache-Schreiben. Verwende eine datierte Preisquelle und kennzeichne Schätzungen; Anbieterabrechnung ist maßgeblich. Kosten, unbekannte Tokenabrechnung, Fehler und Trunkierung werden nicht als erfolgreiche Qualitätsresultate ausgegeben.

Verhindere unbemerkte mehrfache teure Wiederholungen. Cache nach Dokumentinhalt plus Parser-/Prompt-/Schema-/Modell-/Pipelineversion; ein Dateiname allein ist kein Cache-Key. Trenne gespeicherte automatische Analyse und spätere Kundenkorrekturen. Eine explizite Entwicklungs-Neuanalyse darf den Cache umgehen, damit Modellstreuung messbar bleibt. Das Anwenderprodukt soll bei unveränderter Eingabe eine stabile gespeicherte Analyse verwenden. Cache-Auslieferung ist kein neuer unabhängiger A/B-Durchlauf.

Modellfallback erfolgt nur bei tatsächlicher Nichtverfügbarkeit/Zugangsproblemen des gewünschten Modells; nicht bei ungültigem JSON, Quota, Authentifizierung oder jedem beliebigen Fehler. Speichere das tatsächlich verwendete Modell und dessen Verbrauch. Ein Fallback darf deterministische Analyse nicht blockieren.

### 8. Qualitätsprüfung und Testdaten

Baue die Evaluation vor weiteren Modellversprechen auf. Verwende unabhängig annotierte Referenzen, nicht die eigenen Vorhersagen. Gleiche Original- und finale Planpaare sowie Versionen eines Kundenprojekts gehören in denselben Datensplit. Details stehen in `docs/DATASET-QUALITY-WORKFLOW.md`.

Für Bereiche getrennt messen: Instanz-Precision/-Recall, richtige Kategorie, Rechteck-/Polygon-IoU, Referenzflächenabdeckung, zusätzliche erfundene Bereiche, fehlende Bereiche und Wiederholungsstabilität. Ordne Vorhersagen zunächst nach Geometrie 1:1 zu und bewerte dann die Kategorie; eine falsche Kategorie darf nicht aus der Klassifikationsbewertung verschwinden. Ein U-Gang mit einer richtigen oberen Teilbox gilt nicht als vollständig erkannt.

Für Maße messen: richtiger Wert, Einheit, Typ, Position, Kettenzuordnung, Bereichsbezug, False Positives und fehlende Vorkommen. Wiederholte gleiche Zahlen werden nach Position bewertet, nicht nur nach Menge unterschiedlicher Werte. Zusätzlich Kosten, P50/P95-Latenz, Fehler-/Fallbackrate, manuelle Korrekturen und reale Vorbereitungszeit erfassen.

Der anspruchsvolle Referenzplan `obora mariusz-przyziemie(1).pdf` besitzt SHA-256 `85c80c8338ddd03ce975a9bb52da8c2e9da5f63d8168258ee6543985ee9ff02e`. Die bestehende Maßerkennung erreicht dort 194/194 geprüfte Vorkommen. Drei frische finale Luna-Durchläufe mit Beschriftungsdetails, direkten Raumkennzeichen und Vektorkonturen erfassen die zehn annotierten Hauptbereiche mit richtiger Kategorie; sechs Konturen je Lauf kommen aus der Vektormethode. Der U-Gang erreicht gegen die grobe unabhängige Referenz ungefähr 0,959 Flächen-IoU. Die durchschnittliche Flächen-IoU aller Hauptbereiche beträgt ungefähr 0,918; zwei kleine Buchten bleiben in einem der drei Läufe deutlich ungenauer. Dieser Einzelplan ist ein Regressionstest, kein Beleg allgemeiner Qualität. Tore, Tränken und Bürsten sind hier nicht vollständig als Referenz annotiert und begründen keine allgemeine Aussage „keine False Positives“. Produktionsregeln dürfen weder dessen Koordinaten noch erwartete Raumanzahl oder manuell abgegriffene Beschriftungen fest verdrahten.

Nach größeren Änderungen TypeScript beziehungsweise entsprechende Sprachprüfungen, Linter, Build, Runtime und Browser prüfen. Teste Upload, Teilergebnisse bei KI-Ausfall, mehrseitige/gedrehte/beschädigte PDFs, Zoom auch über Markierungen, Bereichskorrektur/Löschen/Rückgängig, Gruppenwünsche/Bereichsausnahmen, Maßkorrektur, Export, Neustart und mobile Darstellung. Screenshots kritisch prüfen und Console-/Netzwerk-/Serverfehler auswerten. Dokumentiere verbleibende Fehler konkret.

### 9. Lieferergebnis und Integrationspunkte

Liefere lauffähige, modular implementierte Änderungen in unserer Pipeline; migrationsfähige Typen; getestete Unternehmensadapter; deutsche Oberfläche; nachvollziehbaren Handoff; reproduzierbare Benchmarkbefehle und einen Vorher-/Nachher-Bericht einschließlich aller Fehlschläge. Dokumentiere Umgebungsvariablen und Deploymentanforderungen ohne Zugangsdaten. Halte PDF-Dateien und Kundendaten in unseren dafür vorgesehenen Speichern, nicht ungeprüft in einem Quellcode-Repository.

Prüfe und verbinde folgende bestehende Unternehmensschnittstellen:

| Schnittstelle | Vor Integration konkret feststellen |
| --- | --- |
| Upload / Dokumentablage | Dateireferenz, Zugriffsprüfung, Dokumenthash, erlaubte Größen/Typen, Aufbewahrung |
| Projekt-/Kundenmodell | Projekt-ID, Händler-/Landwirtkontext, Versionen, vorhandene bekannte Tierangaben |
| Analysejob / Queue | Status, Teilresultate, Abbruch, erneuter Versuch, Idempotenz und Cache |
| Geometrie-/CAD-Pipeline | Koordinatensystem, Einheiten, Polygone/Aussparungen, vorhandene CAD-Objekte |
| Modellgateway | verfügbare Vision-Modelle, Datenregion, Requests, Usage, Budgetgrenzen |
| PATURA-Wissensbasis | freigegebene Taxonomie, Regeln, Systemfamilien und Katalogversion |
| Stallplaner-Handoff | vorhandenes Zielschema, offene Punkte, Audit und Korrektur-Rückfluss |
| Evaluation / Annotation | Dokumentpaare, Prüfer, Referenzen, Versions-/Split-Verwaltung |

Fehlende Adapterinformationen sind zunächst technische Integrationsaufgaben. Behalte die vorhandene Unternehmensarchitektur bei, soweit sie die Anforderungen erfüllt. Frage nur bei fehlendem Zugang, unvermeidbaren grundlegenden Produktentscheidungen oder nicht technisch ableitbarer PATURA-Fachfreigabe nach. Arbeite ansonsten implementierend, testend und messend weiter.

## Referenz im aktuellen Repository

- Modell/Handoff: `lib/types.ts`, `lib/plan/request.ts`.
- Strukturelle Analyse: `lib/pdf/*`, `lib/analysis/measurements.ts`, `lib/analysis/unit-detection.ts`, `lib/geometry/*`.
- Semantik/Fusion: `lib/ai/*`, `lib/analysis/areas.ts`, `lib/analysis/pipeline.ts`.
- Wünsche/Fachlogik: `lib/rules.ts`, `lib/domain/*`, `components/planning-wishes.tsx`.
- Human-in-the-loop: `lib/plan/review.ts`, `lib/plan/area-review.ts`.
- Historische Annotation: `lib/evaluation/dataset.ts`; diese Funktion baut Daten, trainiert kein Modell.
- Nachvollziehbare Grenzen: `docs/EVALUATION.md`, `docs/BOUNDARY-QUALITY.md`.
- Reproduzierbare frische Runs: `scripts/benchmark-areas.ts`; Zuordnung und Bewertung: `scripts/evaluate-areas.ts`.

Die Vorlage enthält neben vorhandenem Verhalten auch Zielanforderungen wie eigenständiges regionales OCR, kalibrierte Confidence und unternehmensweite Analyse-Caches. Diese sind nicht als bereits vollständig umgesetzt zu verstehen. Hochauflösende Vektorbeschriftungsdetails, direkte Raumanker, konservative Raumkonturen mit Löchern, Polygonanzeige/-export und gemessene API-Usage sind dagegen Teil des aktuellen implementierten Stands.
