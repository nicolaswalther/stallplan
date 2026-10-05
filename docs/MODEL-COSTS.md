# Modellkosten: tatsächliche Usage statt Schätzung nach PDF-Größe

Preisstand: **5. Oktober 2026**. Die Zahlen gelten für OpenAI Standard-Verarbeitung in USD. Es wird kein USD/EUR-Wechselkurs angenommen. Steuer, Unternehmensgateway-Aufschläge und eigene Infrastruktur sind nicht enthalten; die Anbieterabrechnung ist maßgeblich.

## Offiziell veröffentlichte Raten

| Modell | normale Eingabe | Cache-Lesen | Cache-Schreiben | Ausgabe |
| --- | ---: | ---: | ---: | ---: |
| `gpt-6-luna` | $0,10 | $0,01 | $0,125 | $0,50 |
| `gpt-6.1-sol` | $2,00 | $0,10 | $2,50 | $10,00 |

Alle Tabellenwerte gelten **pro 1 Million Tokens**. Quellen:

- [Offizielle Preistabelle](https://developers.openai.com/api/docs/pricing).
- [GPT-6 Luna: Modell und Pricing](https://platform.openai.com/docs/models/gpt-6-luna).
- [GPT-6.1 Sol: Modell und Pricing](https://platform.openai.com/docs/models/gpt-6.1-sol).
- [Prompt-Caching: Usage und Kostenformel](https://developers.openai.com/api/docs/guides/prompt-caching).
- [Vision: Bilder werden in abrechenbare Input-Tokens überführt](https://developers.openai.com/api/docs/guides/images-vision).

Die veröffentlichten Modellseiten nennen zudem Batch/Flex mit 50 % reduzierten Standardraten, Fast-Verarbeitung mit Faktor 2 und gegebenenfalls 10 % Aufschlag für regionale Verarbeitung. Bei mehr als 272.000 Eingabe-Tokens gelten höhere Langkontext-Raten. Diese Sonderfälle werden in den folgenden Standardwerten nicht verwendet. Modellzugang und tatsächlicher Verarbeitungstarif müssen im Unternehmensaccount geprüft werden.

## Fünf frische Basisdurchläufe am gleichen Beispielplan

Die Runs verwenden identische bestehende Bereichsanalyse-Eingaben des Referenzplans `obora mariusz-przyziemie(1).pdf`. Jeder Run ist eine neue Providerantwort; es wurde keine lokale Antwort als neuer KI-Run gezählt. Die API meldet jeweils **6.753 Eingabe-Tokens einschließlich Bildinput**. Der erste Request je Modell schreibt 6.750 davon in den Providercache, weitere gleichartige Requests lesen 6.750 aus diesem Cache.

| Run | Eingabe | Cache schreiben / lesen | Ausgabe, inkl. Reasoning | Requestdauer | berechnet USD | US-Cent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Luna 1 | 6.753 | 6.750 / 0 | 1.776 | 23,4 s | $0,00173205 | 0,173205 |
| Luna 2 | 6.753 | 0 / 6.750 | 2.292 | 20,7 s | $0,00121380 | 0,121380 |
| Luna 3 | 6.753 | 0 / 6.750 | 1.621 | 18,0 s | $0,00087830 | 0,087830 |
| Sol 1 | 6.753 | 6.750 / 0 | 2.898 | 52,3 s | $0,04586100 | 4,586100 |
| Sol 2 | 6.753 | 0 / 6.750 | 2.797 | 51,4 s | $0,02865100 | 2,865100 |

Die fünf Basisrequests ergeben zusammen **$0,07833615**, entsprechend **7,833615 US-Cent**. Das ist die Summe dieses begrenzten Basisvergleichs, nicht die Gesamtkosten aller weiteren Experimente.

Bei den gemessenen Sol-Ausgaben liegt ein einzelner Basisrequest somit ungefähr bei **3–5 US-Cent**. Das ist kein pauschaler Preis pro PDF und kein garantierter 5-Euro-Cent-Deckel. Mehr Seiten, zusätzliche hochauflösende Ausschnitte, längere Ausgaben oder höhere Reasoning-Einstellung verändern die Usage. Ein wärmer Providercache ist bei einem anderen Plan oder nach Ablauf der Cache-Lebensdauer nicht garantiert. Sol ist in diesen Basisruns außerdem langsamer als Luna; bessere Qualität muss separat gemessen werden.

## Berechnung

### Finale verbesserte Produktionsmethode

Nach Integration echter hochauflösender Beschriftungsdetails und konservativer Vektorkonturen wurden drei weitere frische finale Luna-Runs ausgewertet. Diese haben jeweils 9.236 Eingabe-Tokens, davon 9.233 Cache-Lesetokens; der Providercache war zu diesem Zeitpunkt warm.

| Finaler Run | Ausgabe, inkl. Reasoning | gemessene Gesamtlaufzeit der Pipeline | berechnet USD | US-Cent |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1.688 | 21,3 s | $0,00093663 | 0,093663 |
| 2 | 2.004 | 18,8 s | $0,00109463 | 0,109463 |
| 3 | 2.074 | 19,3 s | $0,00112963 | 0,112963 |

Durchschnitt: **$0,00105363**, entsprechend **0,105363 US-Cent**. Diese Laufzeiten enthalten lokale Geometrieverarbeitung; die eigentliche API dauert im Mittel ungefähr 17,9 Sekunden. Zum Vergleich: Der erste vorherige Request mit derselben erweiterten Eingabe und kaltem Cache kostete $0,001997425, ungefähr **0,20 US-Cent**. Cachezustand und Outputzahl gehören deshalb immer zum Preisvergleich.

Die finale Variante wurde hier mit Luna wiederholt geprüft. Aus den Sol-Basisrequests folgt kein gemessener Sol-Preis für die erweiterte finale Eingabe. Eine pauschale Kostenübertragung würde die zusätzlichen Bild-/Kontexttokens ignorieren.

Die API-Eingabezahl umfasst normale Eingabe, Cache-Lesen und Cache-Schreiben. Diese Teilmengen werden getrennt berechnet:

```text
I = usage.input_tokens
C = usage.input_tokens_details.cached_tokens
W = usage.input_tokens_details.cache_write_tokens
O = usage.output_tokens

Kosten USD = ((I - C - W) × Inputrate
              + C × Cache-Leserate
              + W × Cache-Schreibrate
              + O × Outputrate) / 1.000.000
```

Beispiel Sol 1: `((6753−0−6750)×2 + 6750×2,50 + 2898×10) / 1.000.000 = $0,045861`.

`output_tokens_details.reasoning_tokens` ist eine Aufschlüsselung der Ausgabe und wird nicht noch einmal addiert. Ein vorhandener Bildinput wird über die tatsächlich gemeldeten Eingabe-Tokens berücksichtigt; seine Pixelzahl wird nicht zusätzlich zu derselben Usage berechnet. Eine reine Bildkostenabschätzung ist kein Ersatz für die Usage der gesamten Anfrage.

Bei fehlender oder unbekannter Usage ist der Preis **unbekannt**, nicht null. Unbekannte Modelle oder Tarife erhalten keine erfundene Standardrate. Pro Run bleiben Roh-Usage, tatsächlich zurückgegebenes Modell und datierte Preisquelle erhalten, damit sich Schätzungen nach Preisänderungen erneut berechnen lassen.

## Was „eine Analyse“ umfasst

Für diesen Vektorplan stammen die 194 Maße aus der deterministischen Pipeline. Es gibt dafür keinen separaten Modellrequest. Die kostenpflichtige Bereichsanalyse ergänzt Nutzungen und Beschriftungen. Bei Raster-/Mischdokumenten kann zusätzlich eine spezialisierte Rastermaß-Anfrage entstehen; bei mehreren Seiten, Wiederholungen oder Modellfallbacks kann ein Analyselauf mehrere kostenpflichtige Requests enthalten.

Der sichtbare Analysepreis muss daher erfolgreiche und fehlgeschlagene kostenpflichtige Teilrequests, gegebenenfalls Fallbacks und gezielte Nachanalysen umfassen, soweit deren Usage verfügbar ist. Requestfehler ohne gemeldete Usage bleiben als unbekannte Kosten gekennzeichnet. Die Useroberfläche muss diese technischen Daten nicht ständig anzeigen; sie gehören in Audit, technische Details und den Entwicklungsbenchmark.

Eine lokale Speicherung fertiger automatischer Ergebnisse spart erneute Providerrequests vollständig. Sie stabilisiert zugleich die Nutzerergebnisse bei unveränderter Eingabe. Sie verbessert jedoch keine falsche Erkennung. Im A/B-Benchmark werden lokale Cachetreffer von frischen Providerantworten getrennt, damit wiederholte gleiche Ergebnisse nicht fälschlich als Modellstabilität gewertet werden.
