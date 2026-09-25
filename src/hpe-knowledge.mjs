// Curated excerpts from HPE_PRIVATE_CLOUD_AI.md plus reviewed QuickSpecs facts; not full document ingestion.
import { quickspecsFacts } from './hpe-quickspecs-facts.mjs';

export const knowledgeVersion = 'hpe-curated-2026-09-25-v2';
const reviewedAt = '2026-09-24';
const sources = [
  ['HPE-AT', 'Österreichische Produktseite', 'https://www.hpe.com/at/de/products/private-cloud-ai.html', null, 'Produktseite und FAQ', 'reviewed-excerpts'],
  ['HPE-EU', 'Europäische Produktseite', 'https://www.hpe.com/emea_europe/en/products/private-cloud-ai.html', null, 'Produktseite und FAQ', 'reviewed-excerpts'],
  ['HPE-QS', 'HPE Private Cloud AI QuickSpecs', 'https://www.hpe.com/us/en/collaterals/collateral.a50009216enw.html', 'V11, 2026-07-06', 'Überblick, Konfigurationstabelle und Änderungshistorie', 'reviewed-excerpts'],
  ['HPE-QS-X10000', 'HPE Alletra Storage MP X10000 QuickSpecs', 'https://www.hpe.com/us/en/collaterals/collateral.a50009215enw.html', 'V11, 2026-09-08', 'Gesamtdokument, geprüfte Auszüge', 'reviewed-excerpts'],
  ['HPE-QS-CX6300', 'HPE Aruba Networking CX 6300 Switch Series QuickSpecs', 'https://www.hpe.com/us/en/collaterals/collateral.a00073540enw.html', 'V46, 2026-08-03', 'Überblick, Modelle und Spezifikationen, geprüfte Auszüge', 'reviewed-excerpts'],
  ['HPE-SERVICE', 'Servicebeschreibung', 'https://www.hpe.com/psnow/doc/a50010051enw', 'V3', 'Abschnitte 1–7', 'reviewed-document'],
  ['HPE-DEV', 'Developer Portal', 'https://developer.hpe.com/platform/hpe-private-cloud-ai/home/', null, 'Einleitung und Demo-Verzeichnis; Videos nicht ausgewertet', 'reviewed-excerpts'],
  ['HPE-MANUALS', 'Support-Handbuchverzeichnis', 'https://support.hpe.com/connect/s/product?language=en_US&kmpmoid=1014847366&tab=manuals', 'Verzeichnis enthält 2026.07.1', 'Nur Verzeichnis; verlinkte Handbücher nicht vollständig geprüft', 'directory-only'],
  ['HPE-ADMIN-15', 'Administration Guide: Overview of the engineered system', 'https://support.hpe.com/hpesc/public/docDisplay?docId=sd00006503en_us&page=GUID-AAE4C121-A282-4DA5-A9F0-2619019F6F1C.html&docLocale=en_US', '1.5 / v1.5.0', 'Einzelner Überblicksabschnitt und Inhaltsverzeichnis', 'reviewed-excerpts'],
];
export const hpeSources = Object.freeze(sources.map(([sourceId, title, url, version, section, reviewStatus]) => Object.freeze({ sourceId, title, url, version, section, reviewStatus, reviewedAt })));
const citation = (sourceId, section) => ({ ...hpeSources.find(source => source.sourceId === sourceId), section });
const facts = [
  { id: 'overview', terms: ['überblick', 'einführung', 'inferenz', 'rag', 'retrieval', 'fine-tuning', 'finetuning', 'rechenzentrum', 'architektur'], text: 'HPE Private Cloud AI verbindet HPE- und NVIDIA-Technologie für KI-Anwendungen im eigenen Rechenzentrum. Die QuickSpecs nennen Inferenz, Retrieval-Augmented Generation und Fine-Tuning.', citations: [citation('HPE-QS', 'Überblick')] },
  { id: 'agents', terms: ['agenten', 'ki-agent', 'unternehmensdaten', 'orchestrierung', 'nutzen', 'anwendungsfall'], text: 'Die Produktseiten beschreiben Entwicklung, Orchestrierung und Betrieb von KI-Agenten sowie geregelten Zugriff auf Unternehmensdaten und Tools. Die Eignung eines konkreten Modells oder Anwendungsfalls ist damit nicht bestätigt.', citations: [citation('HPE-AT', 'FAQ'), citation('HPE-EU', 'FAQ')] },
  { id: 'software', terms: ['software', 'nvidia', 'nim', 'open-source', 'werkzeuge'], text: 'Das Developer Portal nennt NVIDIA AI Enterprise einschließlich NIM und kuratierte Open-Source-Werkzeuge. Konkrete Versionen und Nutzungsrechte müssen gesondert geprüft werden.', citations: [citation('HPE-DEV', 'Einleitung')] },
  { id: 'operating-modes', terms: ['air-gapped', 'airgap', 'air gap', 'connected', 'offline', 'getrennt', 'betriebsmodus', 'betriebsvarianten', 'internet'], text: 'Die Servicebeschreibung unterscheidet Connected und Air-gapped. Anforderungen hängen von der Variante ab; die Bezeichnung Private Cloud allein belegt keinen vollständig getrennten Betrieb.', citations: [citation('HPE-SERVICE', 'Abschnitte 1–3')] },
  { id: 'responsibilities', terms: ['verantwortung', 'zuständig', 'datensicherung', 'backup', 'sicherheit', 'betrieb', 'betreibt'], text: 'Die Servicebeschreibung verteilt Aufgaben zwischen Kunde und HPE. Zu den Kundenaufgaben gehören Datensicherung und Sicherheitsmaßnahmen; eine vollständige Betriebsübernahme durch HPE ist nicht pauschal zugesagt.', citations: [citation('HPE-SERVICE', 'Abschnitt 7')] },
  { id: 'scope', terms: ['lizenz', 'support', 'vertrag', 'nutzungsdauer', 'leistungsumfang', 'änderungen'], text: 'Nutzungsdauer, Softwarelizenzen, Support und zulässige Änderungen sind vertrags- und konfigurationsabhängig. Eine individuelle Zusage erfordert die Prüfung des Angebots und Vertrags.', citations: [citation('HPE-SERVICE', 'Abschnitte 1, 4 und 5')] },
  ...quickspecsFacts.map(({ sourceId, section, quote, ...fact }) => ({ ...fact, citations: [citation(sourceId, section)] })),
];
const globalLimit = 'Kuratierte geprüfte Auszüge, kein vollständig eingelesener HPE-Dokumentbestand. Keine kundenspezifische Eignungs- oder Leistungszusage.';
const hardwareConflict = { id: 'developer-generations', text: 'Developer Portal und QuickSpecs V11 beschreiben unterschiedliche Developer-Konfigurationen. Generation und Angebot müssen geklärt werden; Hardwareangaben dürfen nicht vermischt werden.', sourceIds: ['HPE-DEV', 'HPE-QS'] };
const manualConflict = { id: 'administration-versions', text: 'Der angegebene Administration Guide gehört zu 1.5; das Handbuchverzeichnis enthält auch 2026.07.1. Betriebsanweisungen erfordern die tatsächlich installierte Version und ein geprüftes passendes Handbuch.', sourceIds: ['HPE-ADMIN-15', 'HPE-MANUALS'] };

/** Returns bounded evidence, never generated product claims or operational instructions. */
export function searchHpeKnowledge(query, topicId = 'hpe-private-cloud-ai') {
  const result = { knowledgeVersion, status: 'unsupported', facts: [], limitations: [globalLimit], conflicts: [] };
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) {
    result.limitations.push('Eine nicht leere fachliche Frage mit höchstens 2000 Zeichen ist erforderlich.');
    return result;
  }
  const normalized = query.normalize('NFKC').toLowerCase();
  // Short terms such as "ai" or "rag" must match whole words, not parts of other words.
  const includes = terms => terms.some(term => term.length <= 4
    ? new RegExp(`(?:^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalized)
    : normalized.includes(term));
  if (includes(['ignore', 'ignoriere', 'systemprompt', 'system prompt', 'api-key', 'api key', 'geheimschlüssel', 'jailbreak'])) {
    result.limitations.push('Anweisungen zur Änderung der Gesprächs- oder Quellenregeln sind keine fachliche Wissensabfrage.');
    return result;
  }
  if (includes(['preis', 'kosten', 'kostet', 'liefertermin', 'rabatt', 'einspar', 'garantier', 'durchsatz', 'benchmark', 'sizing', 'konform', 'dsgvo', 'datenresidenz', 'rechtskonform'])) {
    result.limitations.push('Kein geprüftes individuelles Angebot, Preis, Liefertermin, Sizing, Leistungsversprechen oder Nachweis rechtlicher Konformität beziehungsweise Datenresidenz liegt vor. Das kann anhand der vorliegenden HPE-Unterlagen nicht zuverlässig bestätigt werden.');
    return result;
  }
  const pcai = topicId === 'hpe-private-cloud-ai';
  if (pcai && includes(['gpu', 'hardware', 'speicher', 'h100', 'rtx', 'developer-system', 'konfiguration'])) {
    result.status = 'limited';
    result.conflicts.push({ ...hardwareConflict, sourceIds: [...hardwareConflict.sourceIds] });
    result.limitations.push('Hardwarewerte stammen aus den QuickSpecs V11; das Developer Portal beschreibt abweichende Developer-Konfigurationen. Generation und Angebot klären; Angaben nicht vermischen.');
  }
  if (pcai && includes(['install', 'upgrade', 'update', 'firmware', 'kompatib', 'compatib', 'handbuch', 'administration', 'release', '1.5', '2026.07', 'anleitung', 'konfigurier'])) {
    result.status = 'limited';
    result.conflicts.push({ ...manualConflict, sourceIds: [...manualConflict.sourceIds] });
    result.limitations.push('Die verlinkten aktuellen Handbücher, Release Notes und Kompatibilitätsmatrizen sind noch nicht vollständig geprüft. Keine konkreten Betriebsanweisungen freigegeben.');
    return result;
  }
  const topicFacts = facts.filter(fact => (fact.topic ?? 'hpe-private-cloud-ai') === topicId);
  let matching = topicFacts.filter(fact => includes(fact.terms));
  // "Was ist HPE Private Cloud AI?" always starts with the overview.
  if (pcai && /^(?:was ist\s+)?hpe private cloud ai[?.!\s]*$/.test(normalized.trim())) matching = [facts[0], ...matching.filter(fact => fact !== facts[0])];
  result.facts = matching.slice(0, 3).map(({ terms, ...fact }) => ({ ...fact, citations: fact.citations.map(item => ({ ...item })) }));
  if (result.facts.length) result.status = 'supported';
  else result.limitations.push('Zu dieser Frage liegt keine passende freigegebene Fundstelle vor. Das kann anhand der vorliegenden HPE-Unterlagen nicht zuverlässig bestätigt werden.');
  return result;
}
