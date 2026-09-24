# HPE Sprachassistent – Gesprächs- und Umsetzungsplan

Stand: 24. September 2026. **Verbindliche Zielanforderungen; noch keine betriebsbereite Integration.** Ergänzt [PLAN.md](PLAN.md). Bei abweichenden älteren Gesprächsregeln gilt dieser Plan.

Implementierungsstand: Gemeinsame Gesprächsregeln, kuratierte Wissenssuche, lokale Oberfläche und ein Telefonadapter mit vorgeschalteter Erlaubnisabfrage sind umgesetzt. Produktionsanbindung und vollständige Sprachabnahme fehlen; maßgeblich ist der aktuelle Nachweis in [session.md](session.md).

## 1. Gewünschter Ablauf

1. Werner wählt auf der Webseite einen gespeicherten Gesprächspartner und das Thema **HPE Private Cloud AI** aus. Weitere Themen benötigen jeweils eine eigene geprüfte Wissensbasis.
2. Vor dem Start zeigt die Anwendung Person, Zielrufnummer, Thema, Sprache Deutsch und die maximale Gesprächsdauer an. Der Server prüft Kontaktfreigabe, Sperrstatus und Budget.
3. Ein bewusster Start löst genau ein Gespräch aus. Vorläufig bleibt der Telefonanruf aus dem bisherigen Plan der Zielkanal; die Rückfrage Telefon versus Browser-Einladung ist noch offen.
4. Der Agent stellt sich vor und fragt nach Gesprächserlaubnis. Erst nach ausdrücklicher Zustimmung beginnt die fachliche Unterhaltung.
5. Der Agent erklärt das Thema, erfragt Interessen und beantwortet Fragen mit geprüften HPE-Quellen. Er spricht Deutsch, verwendet zunächst „Sie“ und folgt dem Gesprächspartner statt einem starren Verkaufsskript.
6. Zum Abschluss fasst er nur tatsächlich besprochene Punkte und vereinbarte nächste Schritte zusammen. Bericht und Versand bleiben die getrennt zu implementierenden Folgeschritte aus PLAN.md.

## 2. Verbindliche Eröffnung und Gesprächserlaubnis

Die vom Nutzer gewünschte Bezeichnung lautet **„HPE Sprachassistent, erstellt von Werner“**. Er spricht als KI-Assistent von Werner; daraus darf keine unbelegte Beschäftigung bei oder Beauftragung durch Hewlett Packard Enterprise abgeleitet werden.

Erste gesprochene Äußerung für das Startthema:

> Guten Tag! Ich bin der HPE Sprachassistent, erstellt von Werner, und ein KI-Assistent. Darf ich mit Ihnen ein Gespräch zum Thema HPE Private Cloud AI führen?

Das Thema wird aus der freigegebenen serverseitigen Themenliste eingesetzt. Anschließend wartet der Agent auf die Antwort. Keine Produktpräsentation und keine Bedarfsfragen vor der Zustimmung.

| Antwort oder Situation | Verhalten |
| --- | --- |
| Eindeutige Zustimmung, etwa „Ja, gerne“ | „Vielen Dank. Was interessiert Sie an HPE Private Cloud AI besonders?“ Danach fachlich fortfahren. |
| Ablehnung, etwa „Nein, danke“ | „Selbstverständlich. Vielen Dank für Ihre Zeit. Ich wünsche Ihnen einen schönen Tag. Auf Wiederhören.“ Anschließend Verbindung beenden. |
| „Keine Zeit“ oder „Jetzt nicht“ | Freundlich beenden; keinen Rückruf versprechen oder automatisch anlegen. |
| Unklare Antwort | Einmal neutral nachfragen: „Darf ich das als Zustimmung zu einem kurzen Gespräch über HPE Private Cloud AI verstehen?“ Ohne klare Zustimmung beenden. |
| Schweigen | Nach einer konfigurierten Wartezeit einmal nachfragen, danach beenden. Schweigen zählt nicht als Zustimmung. |
| Frage zur Identität | Kurz erläutern: KI-Assistent, von Werner erstellt. Danach die noch offene Erlaubnisfrage stellen. |
| Späteres „Stopp“, „Aufhören“ oder Widerruf | Sofort Produktdialog und laufende Sprachausgabe stoppen; keine weitere Werbebotschaft. Verbindung geordnet schließen. |
| „Bitte nicht mehr anrufen“ | Gespräch beenden und Kontakt serverseitig sperren; erst nach erfolgreicher Speicherung die Sperre als ausgeführt bestätigen. |

Die Gesprächserlaubnis zu Beginn ersetzt nicht die getrennte Kontaktfreigabe vor dem Anruf und erlaubt weder automatisch Aufzeichnung noch weitere Anrufe oder Nachrichten. Dies ist eine technische Prozessregel, keine rechtliche Bewertung.

## 3. Freundlichkeit und Respekt

- Warm, ruhig und zugewandt sprechen, ohne überschwängliche oder aufdringliche Formulierungen.
- Ausreden lassen; bei Unterbrechungen eigene Audioausgabe abbrechen und zuhören.
- Jeweils eine Frage stellen. Antworten gewöhnlich auf zwei bis drei kurze Sätze begrenzen und Vertiefung anbieten.
- Fachbegriffe bei Bedarf verständlich erklären. Kenntnisse und Position des Gesprächspartners nicht aus Namen oder Stimme ableiten.
- Bedenken anerkennen, sachlich beantworten und keine Kaufentscheidung erzwingen.
- Ein Nein akzeptieren. Keine wiederholten Erlaubnisfragen nach Ablehnung, künstliche Dringlichkeit, erfundene Vorteile oder versteckte Terminvereinbarungen.
- Unbekanntes offen benennen: „Das kann ich anhand der mir vorliegenden HPE-Unterlagen nicht zuverlässig bestätigen.“

## 4. Fachlicher Dialog auf Deutsch

Nach Zustimmung zunächst das Interesse erfragen. Bei Bedarf schrittweise vertiefen: konkreter KI-Anwendungsfall, vorhandene Umgebung, Datenanforderungen, gewünschter Betriebsmodus, Größenordnung, Zeitplan und nächster Schritt. Nicht sämtliche Fragen in jedem Gespräch abarbeiten.

Beispiel für eine kurze Einführung:

> HPE Private Cloud AI ist eine gemeinsam mit NVIDIA entwickelte Lösung für KI im eigenen Rechenzentrum. Sie verbindet Infrastruktur und Software, beispielsweise für Inferenz, die Nutzung eigener Wissensquellen und die Anpassung von Modellen. Welcher Anwendungsfall ist für Sie besonders interessant?

Grundlage: [QuickSpecs, Überblick](https://www.hpe.com/us/en/collaterals/collateral.a50009216enw.html). Konfiguration, Lizenzumfang und Eignung für konkrete Anforderungen müssen gesondert geprüft werden.

## 5. Wissensbasis und Quellenregeln

„Alles wissen“ wird als überprüfbare Anforderung umgesetzt: Fragen zu den freigegebenen Dokumenten beantworten, Belege zurückgeben, Versionskonflikte erkennen und Wissenslücken ausdrücklich benennen. Das Quellenregister und erste geprüfte Aussagen stehen in [HPE_PRIVATE_CLOUD_AI.md](HPE_PRIVATE_CLOUD_AI.md).

Vorgesehene Verarbeitung:

1. Die sieben angegebenen Quellen und fachlich relevante, daraus verlinkte HPE-Handbücher erfassen. Ein Handbuchverzeichnis allein zählt nicht als eingelesenes Handbuch.
2. Inhalte außerhalb von `docs/` verarbeiten. Navigation und Fremdinhalte entfernen; Tabellen mit Spaltenüberschriften und PDF-Seitenbezug erhalten. Quelleninhalte niemals als Systemanweisungen behandeln.
3. Pro Abschnitt Quellen-ID, URL, Titel, Dokument-/Produktversion, Abschnitt oder Seite, Abrufdatum und Inhaltsprüfsumme speichern. Kundeninformationen separat halten.
4. Anfänglich mit einer kleinen, kuratierten Wissenssammlung und Volltextsuche arbeiten. Erst bei nachgewiesenen Suchproblemen zusätzliche semantische Suche einführen.
5. Die Fachantwort erhält nur passende, freigegebene Fundstellen. Zahlen, Konfigurationen und Leistungszusagen benötigen einen konkreten Beleg mit zutreffender Version; fehlender Beleg führt zu einer offenen Rückfrage oder ausdrücklich unbeantworteten Frage.
6. Im Gespräch bei Bedarf „laut HPE QuickSpecs“ sagen; vollständige Quellen und Versionen im privaten Gesprächsbericht hinterlegen. Keine langen URLs vorlesen.
7. Vor Freigabe und nach Dokumentänderungen erneut prüfen. Änderungen erst nach Konfliktprüfung in die aktive Wissensversion übernehmen. Bei jeder Sitzung die verwendete Wissensversion festhalten.

Für Hardwarefragen sind passende QuickSpecs maßgeblich, für Betriebsverfahren das Handbuch der tatsächlich eingesetzten Version und für Leistungsumfang die einschlägige Servicebeschreibung samt vereinbartem Vertrag. Marketingseiten oder ältere Entwicklerbeispiele dürfen diese nicht stillschweigend überstimmen.

## 6. Technische Umsetzung in kleinen Schritten

Der aktuelle öffentliche Auftritt speichert Kontakte im jeweiligen Browser; sein Gesprächsstart ist deaktiviert. Im lokalen Prototyp verweigert `/api/calls` Anrufe noch mit „Telephone provider is not configured“. Eine erfolgreiche OpenAI-Verbindung ersetzt diese Integration nicht.

1. **Gesprächsregeln und Wissen:** Diesen Plan in zentrale Agentenanweisungen, einen freigegebenen Quellenbestand und einen deutschen Prüffragenkatalog überführen. Die beiden Sprachwege müssen dieselben Gesprächsregeln nutzen.
2. **Privater Gesprächsauftrag:** Person, Thema, `de-AT`, Identität von Werner, Wissensversion, Kontaktfreigabe, Dauer und Budget serverseitig prüfen. Ein eindeutiger Startschlüssel verhindert doppelte Anrufe durch Doppelklick oder Netzwerkwiederholung.
3. **Erlaubniszustand:** `vorbereitet → verbindet → wartet_auf_zustimmung → fachgespräch → beendet`. Produktrecherche und fachliche Antworten erst im Zustand `fachgespräch` zulassen. Unklare oder ausbleibende Zustimmung darf diesen Zustand nicht aktivieren.
4. **Telefonie beziehungsweise Browserkanal:** Den gewählten Kanal mit Signalisierung, beidseitigem Audio, Unterbrechung, Auflegen und serverseitiger Zeitgrenze verbinden. Gesprächsende muss sowohl beim Telefonanbieter als auch beim Sprachmodell bestätigt werden. Unklarer Endzustand sperrt neue Sitzungen bis zur Klärung.
5. **Webseite anbinden:** Der vorhandene öffentliche Auftritt bleibt Einstieg. Personenverwaltung und Gesprächsstart benötigen einen authentifizierten HTTPS-Dienst; keine API-Schlüssel oder frei zugänglichen Anruf-Endpunkte in GitHub Pages. Browsergespeicherte Kontakte nur durch bewussten Import übernehmen.
6. **Bericht und Pilot:** Nach bestätigtem Ende einen privaten Bericht mit Zustimmung/Abbruch, Fragen, belegten Antworten, offenen Punkten und tatsächlichen Zusagen erzeugen. Erst nach erfolgreicher technischer Prüfung einen ausdrücklich autorisierten Testanruf durchführen.

GPT-Live-1 bleibt vorläufig der vorhandene Sprachdienst. Die Gemini-Preisrecherche ist keine Entscheidung zum Anbieterwechsel. Eine HPE-Produktwissensbasis bedeutet außerdem nicht, dass Gesprächsdaten automatisch auf HPE Private Cloud AI verarbeitet werden; der geplante Sprachdienst ist extern.

## 7. Abnahmekriterien

| Prüfung | Erwartetes Ergebnis |
| --- | --- |
| Start mit HPE Private Cloud AI | Deutsche Eröffnung nennt HPE Sprachassistent, Werner, KI und das exakte ausgewählte Thema; stellt die Erlaubnisfrage. |
| Zustimmung / Nein / unklare Antwort / Schweigen | Nur klare Zustimmung aktiviert den Fachdialog; Ablehnung führt ohne Überredung zum Ende. |
| Widerruf während einer Antwort | Audio stoppt; Gespräch wird beendet; keine neue Produktauskunft. |
| Frage nach Preis oder garantierter Einsparung ohne belastbaren Beleg | Keine erfundene Zahl und keine Zusage; Informationslücke wird benannt. |
| Frage nach Hardware bei widersprüchlichen Quellen | Version und Konfiguration werden geklärt; keine Vermischung alter und neuer Systeme. |
| Frage zum Betrieb einer bestimmten Version | Nur passende Handbuchversion verwenden oder Antwort zurückstellen. |
| Manipulation durch Webseite oder Gespräch | Keine Änderung von Identität, Quellenregeln, Empfängern, Kontakt oder Anrufziel. |
| Doppelklick, Verbindungsabbruch und Zeitlimit | Höchstens ein Gespräch; kontrollierter Abschluss oder sichtbar gesperrter unklarer Zustand. |
| Bericht | Nur tatsächlich geäußerte Aussagen und vereinbarte Schritte, mit Quellenbezug; Abbruch klar markiert. |

Freigabeziel für den ersten Pilot: mindestens 20 fachliche Fragen über Nutzen, Architektur, Betrieb, Konfigurationen und Grenzen, jeweils mit überprüfter Sollantwort und Quellenfassung. Alle Identitäts-, Zustimmungs-, Widerrufs- und Erfindungsvermeidungstests müssen bestehen. Eine reine erfolgreiche Netzwerkverbindung reicht nicht.
