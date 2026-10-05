# Mit 100 Stallplänen die Qualität gezielt verbessern

100 PDFs allein trainieren das System nicht. Sie liefern zunächst eine bessere Stichprobe realer Zeichnungskonventionen. Erst geprüfte Referenzen und dokumentierte Korrekturen erlauben, Verfahren zu vergleichen und Regeln gezielt zu verbessern. Die aktuelle Anwendung führt kein Fine-Tuning durch.

## 1. Dokumente inventarisieren und Referenzen trennen

Speichere Kundendokumente in der vorgesehenen Unternehmensablage. Ein Manifest enthält Projekt-ID, Dokument-ID, SHA-256, Seitenzahl, Dokumenttyp, Sprache, Zeichnungsbüro/-familie, Planversion, Original-/finaler-Plan-Beziehung und den erlaubten Nutzungsumfang. Zugangsdaten und personenbezogene Angaben gehören nicht in Benchmarklogs. Abgeleitete Referenzen können bei Bedarf anonymisiert exportiert werden.

Identische Dateien werden nach Hash dedupliziert. Originalplan, ausgeplanter PATURA-Plan, Ausschnitte und weitere Versionen eines Projekts bleiben zusammen. Ähnliche Vorlagen desselben Zeichnungsbüros werden gekennzeichnet, damit ein Test nicht nur dieselbe Zeichnungsfamilie wiederholt.

Stratifiziere die Sammlung mindestens nach Vektor/Raster/Mischform, Sprache, Planqualität, einfacher/komplexer Geometrie und Tier-/Nutzungsgruppen. Eine Sammlung ausschließlich sauberer Liegeboxenpläne zeigt nicht, wie gut Kälberbuchten, offene Gruppenhaltung oder schwierige Scans funktionieren.

## 2. Unabhängige Ground Truth erstellen

Ein fachkundiger Prüfer markiert die relevanten Bereiche und ihre Nutzung, bevor er die neue Vorhersage bewertet. Bei unklaren Plänen darf die Referenz „unklar“ heißen; erzwungene Gewissheit erzeugt falsche Trainings- und Testdaten.

Pro Bereich erfassen:

- stabile Referenz-ID, Seitenreferenz, Typ und gegebenenfalls Untertyp/Tiergruppe;
- tatsächliche Kontur als Polygon mit Löchern beziehungsweise MultiPolygon, zusätzlich abgeleitete Bounding Box;
- Originalbeschriftung und Quelle: native Texte, lesbare Bild-/Pfadbeschriftung, Tabelle/Legende, Einrichtungsmuster;
- Beziehungen von Raumtabellenkennziffern zum markierten Bereich;
- sicher vorhanden / unklar / nicht relevant, Prüfer und Datum.

Liegeboxenbügel, Liegeboxenreihe und umschließender Raum sind unterschiedliche Annotationsebenen. Wähle die gewünschte Ebene vor dem Benchmark und halte sie über alle Pläne konsistent. Ein umlaufender Gang darf seine Liegeboxeninseln nicht als Gangfläche enthalten. Kleine Tränken-/Bürstensymbole werden gesondert und nur bei tatsächlich identifizierbaren Belegen markiert.

Maße werden pro **Vorkommen** annotiert: Wert, Einheit oder `unknown`, Typ, Seite, Textposition, Maßlinie/Begrenzungen, Ketten-ID und gegebenenfalls Bereichsbezug. Identische 600er Werte an unterschiedlichen Stellen sind verschiedene Referenzobjekte. Annotiere außerdem kritische Nichtmaße wie DJP, Höhenkoten, Fläche, Volumen, Datum und Raumnummer. Das verhindert einen scheinbar hohen Recall durch das Ausgeben jeder Zahl.

Überprüfe zunächst etwa 10–15 vielfältige Pläne sorgfältig. Lasse schwierige Fälle durch einen zweiten Fachprüfer bewerten und protokolliere gelöste sowie ungelöste Unterschiede. Danach kann die übrige Sammlung priorisiert annotiert werden. Eine zweite Person muss nicht jeden unstrittigen Bereich doppelt erfassen; ihre Prüfung soll die unsicheren Fälle und Taxonomiegrenzen klären.

Die bestehende Funktion `buildHistoricalSample` in `lib/evaluation/dataset.ts` verknüpft Vorhersage-Handoff und explizite Planerannotationen mittels Dokumenthashes. Sie speichert finale Systeme und Entscheidungen getrennt von Vorhersagen. Vorhergesagte Polygone mit Löchern, Originalbezeichnungen und Konturquellen bleiben erhalten; Planer können eine davon getrennte `finalFootprint` annotieren. Für vollständige Kontur-/Erkennungsevaluation benötigt der historische Datensatz zusätzlich die hier beschriebenen unabhängigen Bereichs- und Maßreferenzen; er ersetzt sie nicht.

## 3. Feste Entwicklungs-, Validierungs- und Testgruppen

Bei 100 unabhängigen Projekten ist beispielsweise folgende erste Aufteilung sinnvoll:

| Teilmenge | Pläne | Verwendung |
| --- | ---: | --- |
| Entwicklung | 60 | Fehleranalyse, neue Extraktions-/Geometrieregeln, Promptvarianten, geeignete Beispiele |
| Validierung | 20 | Auswahl von Methode, Modell, Schwellenwerten und Kosten-/Qualitätstradeoff |
| Unangetasteter Test | 20 | Prüfung nach eingefrorener Methodenauswahl; keine Prompt-/Regelentwicklung daran |

Die Zahlen sind eine Startaufteilung, kein statistischer Beweis ausreichender Daten. Bei verbundenen Dokumenten wird nach **Projekt** gesplittet; 100 Dateien können deutlich weniger als 100 unabhängige Projekte sein. Verteile Sprachen, Dokumenttypen und schwierige Fälle möglichst auf alle Teilmengen. Zusätzlich kann eine bisher ungesehene Zeichnungsfamilie separat als Übertragbarkeitstest dienen.

Original-/finale Planpaare und synthetische Ableitungen dürfen niemals verschiedene Teilmengen belegen. Entwicklungsbeispiele dürfen später in Prompts oder Retrieval-Kontext verwendet werden; Validierungs-/Testreferenzen nicht. Wenn auf Fehler des Testsets reagiert wird, ist es kein unangetasteter Test mehr. Versioniere es dann als bekanntes Regressionsset und reserviere neue unabhängige Projekte für die nächste Abschlussprüfung.

## 4. A/B-Protokoll und Wiederholungen

Friere PDF-Dateien, Referenzen und Auswertungsregeln vor einem Vergleich ein. Speichere pro Run Dokumenthash, Pipeline-/Prompt-/Schemaversion, Modellkonfiguration, tatsächliches Modell, Extraktions-/Renderparameter, Cachezustand, Latenz, Fehler und vollständige Usage. Bewahre rohe Providerantwort und normalisiertes Ergebnis getrennt auf. Ein lokales Replay derselben Antwort ist kein neuer unabhängiger KI-Lauf.

Sinnvolle Vergleichsreihen:

1. aktuelle Pipeline mit Luna;
2. gleiche Pipeline und gleicher Input mit Sol;
3. Luna mit zusätzlich zuverlässig extrahierten Beschriftungen/Tabellen und stabilen Regionskandidaten;
4. beste Semantikvariante plus belegte geometrische Zuordnung;
5. gezieltes stärkeres Modell ausschließlich für die verbleibenden Konflikte.

Ändere in einem einzelnen Vergleich möglichst eine Stellschraube. Ein stärkeres Modell plus andere Auflösung plus neues OCR plus anderer Prompt beantwortet nicht, welche Änderung geholfen hat. Alle Fehlversuche werden protokolliert; ein erfolgreicher Run darf nicht stellvertretend für schwankende Wiederholungen gezeigt werden.

Auf einer kleinen, vielfältigen Stabilitätsgruppe können zunächst fünf frische Durchläufe je Variante laufen. Der aktuell verfügbare einzelne Beispielplan eignet sich dafür, Schwankungen sichtbar zu machen; daraus folgt keine allgemeine Erfolgsquote. Nach Auswahl günstigerer Varianten wiederhole den Vergleich auf weiteren unabhängigen Plänen. Lokale Antwortcaches werden im Wiederholungstest umgangen; das Produkt kann gespeicherte Ergebnisse weiterhin wiederverwenden. Ein Provider-Promptcache bleibt gesondert protokolliert und ersetzt keine frische Modellausgabe.

Verbrauch und Laufzeit der Wiederholungen werden separat summiert. Lege vor kostenpflichtigen Experimenten Requestanzahl und Budget fest. Vergleiche nicht nur Mittelwerte: Berichte schlechteste Fälle, Streuung und Häufigkeit wiederkehrender Fehler wie Fressbereich→Laufgang oder zusätzliche Gangflächen.

## 5. Auswertung ohne versteckte Klassifikationsfehler

Bereiche erhalten eine eindeutige 1:1-Zuordnung zur Referenz nach geometrischer Lage/Überlappung; diese Zuordnung wird für die Klassifikationsprüfung nicht auf bereits passende Kategorien beschränkt. Danach wird geprüft, ob der Typ stimmt. Nicht zuordenbare Vorhersagen sind zusätzliche Instanzen; nicht zugeordnete Referenzen fehlen. Definiere Mindestüberlappung und Umgang mit Teilflächen vorab. Berichte bei Split-/Merge-Fällen auch Flächenabdeckung, damit eine in drei Teile zerlegte Gangfläche verständlich bewertet werden kann.

| Metrik | Was sie beantwortet |
| --- | --- |
| Instanz-Precision / -Recall | Welche behaupteten Bereiche stimmen, welche tatsächlichen fehlen? |
| Typkorrektheit / Confusion Matrix | Wird beispielsweise ein Fressbereich als Laufgang verwechselt? |
| Polygon-/Flächen-IoU | Wie genau stimmt die tatsächliche Fläche einschließlich Aussparungen? |
| Referenzflächenabdeckung | Wird ein vollständiger Gang erfasst oder nur ein kleiner Teil? |
| zusätzliche / fehlende Bereiche | Werden Bereiche erfunden oder übersehen? |
| Wiederholungsstabilität | Wie häufig verändern identische Eingaben Nutzung, Anzahl oder Kontur? |
| Maßwert-/Einheiten-/Typkorrektheit | Sind technische Zahlen richtig interpretiert? |
| Maßposition / Kettenzuordnung | Ist das richtige Vorkommen und sein Zusammenhang erkannt? |
| manuelle Korrekturrate / Bearbeitungszeit | Spart der Assistent dem Nutzer und Planer tatsächlich Arbeit? |
| Kosten / P50-P95-Latenz / Fehlerquote | Ist die Qualitätsverbesserung wirtschaftlich und zuverlässig? |

Reportiere Ergebnisse je Dokumenttyp, Sprache und Nutzungsgruppe sowie als aggregierte Werte. Eine häufige Liegeboxenklasse darf seltene, falsch erkannte Abkalbe-/Isolationsflächen nicht im Mittel verdecken. Confidence-Kalibrierung kommt erst mit genügend fachlich geprüften Fällen; zuvor sind Zahlen technische Scores.

Vor jeder Freigabe: kein Rückschritt bei deterministischen Maßregressionen; keine Verdeckung zusätzlicher Fehlfunde; belegter Verbesserungsgewinn bei den zuvor problematischen Klassen; ehrliche Anzeige geometrisch unvollständiger Bereiche. Numerische Qualitätsziele werden mit dem Fachteam anhand der Baseline und Fehlerkosten festgelegt, bevor auf sie optimiert wird. Ein vorab gewählter Akzeptanzrahmen verhindert, nachträglich nur die günstige Metrik zu berichten.

## 6. Was aus der Sammlung gelernt werden kann

**Ohne Modelltraining:** bessere Text-/Tabellenerkennung, Wörterbücher und eindeutige Labelklassen, Erkennung wiederkehrender Geometrien, nachweisbare Ausschlussregeln für Nichtmaße, stabilere Regionskandidaten, bessere Schwellenwerte und besser gewählte kurze Fragen. Änderungen müssen auf Validierung und unabhängigen Plänen bestehen; keine Koordinatenregeln für einen einzelnen Plan.

**Mit kuratierten Beispielen:** Ein semantischer Request kann wenige relevante beschriftete Beispiele aus dem Entwicklungsset erhalten. Retrieval sucht passende Zeichnungskonventionen oder Systementscheidungen, ersetzt jedoch keine aktuellen Dokumentbelege. Historische geometrische Koordinaten dürfen nicht ungeprüft auf einen neuen Plan übertragen werden. Der Test bleibt frei von diesen Beispielen.

**Mit Planerpaaren:** ursprünglicher Kundenplan und ausgeplanter PATURA-Plan zeigen Entscheidungen, fehlende Informationen und Korrekturen. Finale Produktwahl bleibt fachlich annotiert; sie ist keine freie Produktempfehlung des Modells. Rohwünsche, Gruppen-/Bereichsantworten und Projekt-Tieranzahlen behalten ihren tatsächlichen Umfang.

**Später mit Training:** Fine-Tuning, spezialisierte Symbolerkennung oder Segmentierung können sinnvoll werden, wenn die Baseline, ein stabiles Labelschema, genügend geprüfte Beispiele und ein unabhängiger Test vorhanden sind. 100 große Pläne sind weder automatisch ausreichend noch automatisch ungeeignet; entscheidend sind Vielfalt, annotierte Instanzen, Fehlerarten und Zielaufgabe. Beginne kein Training nur wegen der Zahl der PDFs.

## 7. Ordner-/Manifestbeispiel

### Bereits nutzbarer Benchmark im Repository

`scripts/benchmark-areas.ts` nimmt einen normalisierten `AnalysisRequest` als JSON einschließlich tatsächlicher Seitenbilder, Text-/Vektorobjekte und gegebenenfalls hochauflösender `semanticDetails`. Er ruft die echte Produktionspipeline auf. Er erzeugt keine fehlenden Renderdaten; der Request muss aus dem echten Import stammen. Eingabebilder und API-Schlüssel werden nicht in die Ausgabe kopiert. Die Original-PDF bleibt separat referenziert; Rohantwort bedeutet hier Provider-Ausgabetext und Usage, nicht kopierte Eingaben oder HTTP-Header.

```bash
# Zuerst ohne Provideranfrage Parameter, Grenzen und Hashes prüfen:
npx tsx scripts/benchmark-areas.ts /authorized/request.json \
  --source /authorized/original.pdf --out /authorized/runs/comparison-01 \
  --models gpt-6-luna,gpt-6.1-sol --repeats 3 --dry-run

# Dann frische Providerantworten erzeugen; dieser Befehl verursacht API-Kosten:
npx tsx scripts/benchmark-areas.ts /authorized/request.json \
  --source /authorized/original.pdf --out /authorized/runs/comparison-01 \
  --models gpt-6-luna,gpt-6.1-sol --repeats 3

# Unabhängige Referenz und erzeugtes Manifest auswerten:
npx tsx scripts/evaluate-areas.ts /authorized/runs/comparison-01/runs.json \
  /authorized/annotations/areas-reference.json /authorized/runs/comparison-01/metrics.json
```

Ein vorhandener Dokumenthash kann mit `--source-sha256` statt `--source` übergeben werden. Der Betreiber ist dann für die richtige Hashzuordnung verantwortlich. In verwalteten Node-Umgebungen mit HTTP-Proxy wird gegebenenfalls `NODE_USE_ENV_PROXY=1` gemäß deren Laufzeitkonfiguration benötigt. Der CLI liest `OPENAI_API_KEY` beziehungsweise die ignorierte `.env.local`; der Schlüssel wird nie als Argument übergeben.

Grenzen: höchstens zwei vorgegebene Modelle und fünf Wiederholungen je Modell; sequentielle Analyseläufe. Ein Rastermaßzweig und ein tatsächlich benötigter Modellfallback können zusätzliche Providerrequests erzeugen. Ein vorhandenes Ausgabeverzeichnis mit gleichnamigen Ergebnissen wird vor bezahlten Requests abgelehnt. Teilergebnisse/Providerfehler werden als solche gespeichert; ein erfolgloser Bereichsrun macht den CLI-Exitstatus ungleich null.

Ausgaben enthalten Originaldokumenthash, normalisierten Eingabehash, Hashes aller Analyse-/Geometriemodule, Promptquelldatei-Hash, Gitrevision mit Hinweis auf uncommittete Änderungen sowie den tatsächlichen Requesthash. Damit bleiben Änderungen der Geometrie auch dann unterscheidbar, wenn der semantische Prompt identisch ist. `runs.json` eignet sich direkt für die Auswertung; einzelne Run-Dateien bleiben separat erhalten.

### Aktueller Referenzstand

Die Produktionspipeline verwendet jetzt automatisch gefundene, erneut hochauflösend gerenderte Vektorbeschriftungsdetails und exakte native Raumkennzeichen. Sechs geometrische Komponenten je finalem Referenzlauf werden als Polygone einschließlich Aussparungen übernommen. In drei frischen finalen Runs werden alle zehn annotierten Hauptbereiche richtig klassifiziert; der U-Gang bleibt über diese Runs geometrisch gleich. Zwei kleine Buchten schwanken in einem Lauf deutlich, deshalb wird Konturqualität weiterhin je Bereich bewertet. Tore/Tränken/Bürsten sind im Beispiel nicht vollständig annotiert und werden in dieser Referenzprüfung als nicht bewertete Kategorien getrennt ausgewiesen. Dieser Stand ersetzt weder zusätzliche Pläne noch unabhängige Geräteannotation.

Eine vorherige Zwischenvariante platzierte den Fressbereich zweimal zu weit oben. Die anschließende Zuordnungskorrektur wurde zunächst auf genau diesen gespeicherten Antworten isoliert geprüft; nur die betroffene Raumzuordnung änderte sich und erhielt einen Konflikthinweis. Drei anschließende frische Runs prüfen die endgültige Methode. Replay-Korrektur und frische Modellstabilität sind verschiedene Belege und werden nicht vermischt.

```text
plan-dataset/
  manifest.jsonl
  documents/           # autorisierte Ablage oder referenzierte Objekt-IDs
  annotations/         # fachlich geprüfte Bereiche, Maße und Nichtmaße
  splits/v1.json       # Projekt-IDs: development / validation / test
  runs/<run-id>/
    config.json
    raw-responses/
    normalized-results/
    metrics.json
    failures.json
  planner-pairs/       # unabhängige finale Systeme und Entscheidungen
```

Dateien können in einer Datenbank/Objektablage liegen; entscheidend sind stabile Identitäten, versionierte Referenzen und reproduzierbare Runs. Ein Ordner reicht für den ersten Benchmark. Eine Datenbank wird sinnvoll, wenn mehrere Prüfer annotieren, Projekte nachträglich korrigiert werden oder Analyse-/Planerrückfluss dauerhaft verwaltet werden soll.

Empfohlener erster Unternehmensschritt: 10–15 vielfältige Projekte annotieren, Klassen und Koordinatenkonvention mit dem Fachteam abgleichen, denselben A/B-Befehl auf Luna/Sol und strukturell verbesserter Variante ausführen, danach die übrigen Projekte aufteilen und priorisiert prüfen. Der Nutzen liegt in überprüfbaren Verbesserungen des Systems; das Einwerfen ungeprüfter PDFs allein erzeugt keinen Lernschritt.
