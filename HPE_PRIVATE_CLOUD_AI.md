# HPE Private Cloud AI – Quellenregister für den Sprachagenten

Geprüft am 24. September 2026. Dies ist ein kuratierter Ausgangspunkt, **kein vollständig eingelesener Dokumentbestand**. Die geprüften Kernaussagen sind inzwischen als lokale Wissenssuche in `src/hpe-knowledge.mjs` an die Client-Delegation angeschlossen; ein erfolgreiches vollständiges Fachgespräch ist noch nicht nachgewiesen. Gesprächsregeln: [HPE_AGENT_PLAN.md](HPE_AGENT_PLAN.md).

## Angegebene Quellen und Prüfstand

| ID | Quelle | Verwendung und tatsächlicher Prüfstand |
| --- | --- | --- |
| HPE-AT | [Österreichische Produktseite](https://www.hpe.com/at/de/products/private-cloud-ai.html) | Gelesen; deutsche Positionierung, Nutzenargumente und FAQ. Marketingaussagen sind keine individuellen Leistungszusagen. |
| HPE-EU | [Europäische Produktseite](https://www.hpe.com/emea_europe/en/products/private-cloud-ai.html) | Gelesen; englische Produktübersicht und FAQ. Für regionales Wording mit HPE-AT abgleichen. |
| HPE-QS | [QuickSpecs a50009216enw](https://www.hpe.com/us/en/collaterals/collateral.a50009216enw.html) | Überblick, Konfigurationstabelle und Änderungshistorie geprüft; angezeigte Fassung V11, 6. Juli 2026. Nicht mit älteren Konfigurationen vermischen. |
| HPE-SERVICE | [Servicebeschreibung a50010051enw](https://www.hpe.com/psnow/doc/a50010051enw) | Verlinktes fünfseitiges PDF V3 gelesen; Connected/Air-gapped, Voraussetzungen, Support und Verantwortlichkeiten. Keine allgemeine Marketingbroschüre. |
| HPE-DEV | [Developer Portal](https://developer.hpe.com/platform/hpe-private-cloud-ai/home/) | Einstiegsseite gelesen; Entwicklerüberblick und Demo-Verzeichnis. Verlinkte Videos nicht ausgewertet. |
| HPE-MANUALS | [Support-Handbuchverzeichnis](https://support.hpe.com/connect/s/product?language=en_US&kmpmoid=1014847366&tab=manuals) | Im Browser geprüft. Sichtbar waren unter anderem Administration Guide und Compatibility Matrix für 2026.07.1 sowie Release Notes. Diese verlinkten Dokumente wurden noch nicht vollständig gelesen. |
| HPE-ADMIN-15 | [Angegebener Handbuchabschnitt](https://support.hpe.com/hpesc/public/docDisplay?docId=sd00006503en_us&page=GUID-AAE4C121-A282-4DA5-A9F0-2619019F6F1C.html&docLocale=en_US) | Im Browser als „Overview of the HPE Private Cloud AI engineered system“, Administration Guide 1.5, Versionsauswahl v1.5.0 identifiziert. Einzelner Abschnitt und Inhaltsverzeichnis geprüft; kein Nachweis für Vollständigkeit oder aktuelle Version. |

## Erste freigegebene Kernaussagen

- **Einordnung:** HPE Private Cloud AI verbindet HPE- und NVIDIA-Technologie für KI-Anwendungen im eigenen Rechenzentrum. Die QuickSpecs nennen insbesondere Inferenz, Retrieval-Augmented Generation und Fine-Tuning. Beleg: HPE-QS, Überblick.
- **Produktpositionierung:** Die österreichische und europäische Produktseite beschreiben Entwicklung, Orchestrierung und Betrieb von KI-Agenten sowie geregelten Zugriff auf Unternehmensdaten und Tools. Daraus folgt keine automatische Eignung jedes Modells oder jeder Kundenanwendung. Belege: HPE-AT und HPE-EU, FAQ.
- **Software:** Das Developer Portal nennt NVIDIA AI Enterprise einschließlich NIM und kuratierte Open-Source-Werkzeuge. Tatsächliche Versionen und Nutzungsrechte sind gesondert zu prüfen. Beleg: HPE-DEV, Einleitung.
- **Betriebsvarianten:** Die Servicebeschreibung unterscheidet Connected und Air-gapped. Merkmale und Anforderungen sind variantenabhängig. „Private Cloud“ allein belegt keinen vollständig getrennten Betrieb. Beleg: HPE-SERVICE V3, Abschnitte 1–3.
- **Verantwortung:** Die Servicebeschreibung enthält Aufgaben des Kunden, etwa Datensicherung und Sicherheitsmaßnahmen, sowie Aufgaben von HPE. Deshalb nicht pauschal behaupten, HPE übernehme den gesamten Betrieb. Beleg: HPE-SERVICE V3, Abschnitt 7.
- **Leistungsumfang:** Nutzungsdauer, Softwarelizenzen, Support und zulässige Änderungen sind vertrags- und konfigurationsabhängig. Keine verbindliche individuelle Zusage ohne Prüfung. Beleg: HPE-SERVICE V3, Abschnitte 1, 4 und 5.

## Erkannte Versionskonflikte und Grenzen

1. Das Developer Portal beschreibt ein Developer-System mit zwei H100 NVL GPUs und 32 TB Speicher. Die QuickSpecs V11 nennen in ihrer Familientabelle für das Developer-System zwei RTX Pro 6000 GPUs und 22 TB internen Speicher. Diese Angaben dürfen nicht zu einer gemeinsamen Konfiguration zusammengeführt werden. Für eine konkrete Antwort Generation und Angebot klären; für die referenzierte V11-Konfiguration die V11-Tabelle verwenden.
2. Der ausdrücklich angegebene Administration-Link gehört zu Version 1.5. Im aktuellen Handbuchverzeichnis sind auch Dokumente zu 2026.07.1 sichtbar. Betriebsanweisungen müssen zur installierten Version passen; der ältere Link ist kein pauschaler Beleg für den aktuellen Stand.
3. Prozentuale Einsparungen, Bereitstellungszeiten und Durchsatzvergleiche auf Produktseiten sind kontextabhängige Herstellerangaben. Ohne zugehörige Studie, Voraussetzungen und Vergleichsbasis keine Übertragung auf den Gesprächspartner.
4. Kein individuell geprüftes Angebot, verbindlicher Preis, Liefertermin oder kundenspezifisches Sizing liegt vor. Ebenso keine pauschale Zusage rechtlicher Konformität oder Datenresidenz machen.

## Vor fachlicher Freigabe noch einzulesen

- Passende Administration Guides, Release Notes und Firmware-/Software-Kompatibilitätsmatrix aus HPE-MANUALS.
- Für Hardwarefragen die vollständigen Tabellen einschließlich Fußnoten der zutreffenden QuickSpecs-Version; insbesondere beim Export die Spaltenzuordnung visuell kontrollieren.
- Für Air-gapped-Fragen die zugehörigen Installations- und Upgrade-Anleitungen; Connected-Annahmen nicht übertragen.
- Für Demo-Fragen die konkret verwendeten Tutorials oder Videos, jeweils mit Datum, Version und Umfang.

Eine Quelle wird erst als fachlich freigegeben markiert, wenn ihr Inhalt tatsächlich gelesen, versioniert und mit Prüffragen kontrolliert wurde. Erreichbarkeit oder ein Titel allein reichen nicht.
