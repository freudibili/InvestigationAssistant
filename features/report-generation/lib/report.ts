import "server-only";

import type { InvestigationAnalysis, Reproche } from "@/features/investigation-analysis/types";
import {
  reportDraftSchema,
  type ReportDraft,
  type ReportLanguage,
  type ReportSection,
} from "@/features/report-generation/validation";
import type { Case, CaseDocument } from "@/lib/types";

export class ReportGenerationError extends Error {
  readonly userMessage: string;
  readonly detail?: string;

  constructor(
    userMessage: string,
    options: { detail?: string; cause?: unknown } = {}
  ) {
    super(userMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = "ReportGenerationError";
    this.userMessage = userMessage;
    this.detail = options.detail;
  }
}

export type ReportGenerationStep = {
  index: number;
  label: string;
};

export const REPORT_GENERATION_STEPS: ReportGenerationStep[] = [
  { index: 0, label: "Build framework sections" },
  { index: 1, label: "Format allegations" },
  { index: 2, label: "Format global assessment" },
  { index: 3, label: "Remove dashboard-only content" },
  { index: 4, label: "Check draft" },
  { index: 5, label: "Save draft" },
];

export interface ReportGenerationInput {
  investigationCase: Case;
  documents: CaseDocument[];
  analysis: InvestigationAnalysis;
}

export async function generateReportDraft(
  input: ReportGenerationInput,
  options: {
    language?: ReportLanguage;
    onStep?: (step: ReportGenerationStep) => Promise<void> | void;
  } = {}
): Promise<ReportDraft> {
  const { analysis } = input;
  const copy = getReportCopy(options.language ?? "en");

  if (analysis.reproches.length === 0) {
    throw new ReportGenerationError("No approved allegations are available.");
  }

  await options.onStep?.(REPORT_GENERATION_STEPS[0]);
  const frameworkSections = buildFrameworkSections(input, copy);

  await options.onStep?.(REPORT_GENERATION_STEPS[1]);
  const allegationsSection = buildAllegationsSection(analysis.reproches, copy);

  await options.onStep?.(REPORT_GENERATION_STEPS[2]);
  const globalAssessmentSection = buildGlobalAssessmentSection(analysis, copy);

  await options.onStep?.(REPORT_GENERATION_STEPS[3]);
  const sections = [
    ...frameworkSections,
    allegationsSection,
    globalAssessmentSection,
  ];
  const content = renderReportSections(sections)
    .split("\n")
    .map((line) => cleanDashboardOnlyContent(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  await options.onStep?.(REPORT_GENERATION_STEPS[4]);
  const issues = findDashboardOnlyContentIssues(content);
  if (issues.length > 0) {
    throw new ReportGenerationError("The report draft needs cleanup before it can be saved.", {
      detail: JSON.stringify(issues),
    });
  }

  return reportDraftSchema.parse({
    generatedAt: new Date().toISOString(),
    generatedContent: content,
    editedContent: null,
    sections,
    coherence: { status: "coherent", issues: [] },
  });
}

function buildFrameworkSections(
  _input: ReportGenerationInput,
  copy: ReportCopy
): ReportSection[] {
  return [
    createSection({
      number: "1",
      title: copy.initialSituation,
      type: "manual",
      source: "caseMetadata",
      content: "",
      placeholder: copy.initialSituationPlaceholder,
    }),
    createSection({
      number: "2",
      title: copy.factFindingFramework,
      type: "manual",
      source: "template",
      content: "",
      placeholder: copy.factFindingFrameworkPlaceholder,
      children: [
        createSection({
          number: "2.1",
          title: copy.mandate,
          type: "manual",
          source: "template",
          content: "",
          placeholder: copy.mandatePlaceholder,
        }),
        createSection({
          number: "2.2",
          title: copy.procedure,
          type: "manual",
          source: "caseMetadata",
          content: "",
          placeholder: copy.procedurePlaceholder,
        }),
        createSection({
          number: "2.3",
          title: copy.investigationLimits,
          type: "manual",
          source: "analysis",
          content: "",
          placeholder: copy.limitsPlaceholder,
        }),
      ],
    }),
    createSection({
      number: "3",
      title: copy.legalBasis,
      type: "manual",
      source: "template",
      content: "",
      placeholder: copy.legalBasisPlaceholder,
      children: [
        createSection({
          number: "3.1",
          title: copy.mobbingBossing,
          type: "manual",
          source: "template",
          content: "",
          placeholder: copy.mobbingDefinitionPlaceholder,
        }),
        createSection({
          number: "3.2",
          title: copy.contradictoryStatements,
          type: "manual",
          source: "analysis",
          content: "",
          placeholder: copy.contradictoryDefinitionPlaceholder,
        }),
      ],
    }),
    createSection({
      number: "4",
      title: copy.companyContext,
      type: "manual",
      source: "caseMetadata",
      content: "",
      placeholder: copy.companyContextPlaceholder,
    }),
  ];
}

function buildAllegationsSection(
  reproches: Reproche[],
  copy: ReportCopy
): ReportSection {
  return createSection({
    number: "5",
    title: copy.examinationOfAllegations,
    type: "generated",
    source: "analysis",
    content: copy.allegationsIntro,
    children: reproches.map((reproche, index) =>
      buildAllegationSection(reproche, index + 1, copy)
    ),
  });
}

function buildAllegationSection(
  reproche: Reproche,
  number: number,
  copy: ReportCopy
): ReportSection {
  const findingsIndex = 3 + reproche.referenceStatements.length;
  const sectionNumber = `5.${number}`;

  return createSection({
    number: sectionNumber,
    title: reproche.title,
    type: "generated",
    source: "analysis",
    content: allegationDescriptionText(reproche),
    children: [
      createSection({
        number: `${sectionNumber}.1`,
        title: copy.claimantDeclaration,
        type: "generated",
        source: "analysis",
        content: statementText(reproche.claimantStatement.summary, copy),
      }),
      createSection({
        number: `${sectionNumber}.2`,
        title: copy.accusedDeclaration,
        type: "generated",
        source: "analysis",
        content: statementText(reproche.accusedStatement.summary, copy),
      }),
      ...reproche.referenceStatements.map((statement, index) =>
        createSection({
          number: `${sectionNumber}.${index + 3}`,
          title: referenceDeclarationTitle(index, copy),
          type: "generated",
          source: "analysis",
          content: statementText(statement.summary, copy),
        })
      ),
      createSection({
        number: `${sectionNumber}.${findingsIndex}`,
        title: copy.findingsAndEvaluation,
        type: "generated",
        source: "analysis",
        content: formatFindingsAndEvaluation(reproche),
      }),
    ],
  });
}

function allegationDescriptionText(reproche: Reproche): string {
  return cleanDashboardOnlyContent(reproche.description).trim();
}

function referenceDeclarationTitle(index: number, copy: ReportCopy): string {
  return index === 0
    ? copy.referenceDeclaration
    : copy.numberedReferenceDeclaration(index + 1);
}

function statementText(value: string, copy: ReportCopy): string {
  const cleaned = cleanDashboardOnlyContent(value);
  return cleaned.trim() ? paragraph(cleaned) : paragraph(copy.noAccount);
}

function formatFindingsAndEvaluation(reproche: Reproche): string {
  const findings =
    reproche.findings.length > 0
      ? reproche.findings
          .map((finding) => cleanDashboardOnlyContent(finding))
          .filter(Boolean)
          .map((finding) => `- ${finding}`)
          .join("\n")
      : "";
  const evaluation = cleanDashboardOnlyContent(reproche.evaluation).trim();

  return [findings, evaluation ? paragraph(evaluation) : ""].filter(Boolean).join("\n\n");
}

function buildGlobalAssessmentSection(
  analysis: InvestigationAnalysis,
  copy: ReportCopy
): ReportSection {
  const globalAssessment = cleanDashboardOnlyContent(analysis.globalAssessment).trim();

  return createSection({
    number: "6",
    title: copy.globalAssessment,
    type: "generated",
    source: "globalAssessment",
    content: globalAssessment
      ? paragraph(globalAssessment)
      : paragraph(copy.noGlobalAssessment),
  });
}

export function renderReportSections(sections: ReportSection[]): string {
  return sections.map(renderReportSection).filter(Boolean).join("\n\n");
}

function renderReportSection(section: ReportSection): string {
  const body = (section.editedContent ?? section.content).trim();
  const children = section.children?.map(renderReportSection).filter(Boolean) ?? [];

  return [
    `${section.number} ${section.title}`,
    body,
    ...children,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createSection(params: Omit<ReportSection, "id">): ReportSection {
  return {
    ...params,
    id: `${params.number}-${slugify(params.title)}`,
    children: params.children ?? [],
  };
}

type ReportCopy = {
  initialSituation: string;
  factFindingFramework: string;
  mandate: string;
  procedure: string;
  investigationLimits: string;
  legalBasis: string;
  mobbingBossing: string;
  contradictoryStatements: string;
  companyContext: string;
  examinationOfAllegations: string;
  allegationsIntro: string;
  globalAssessment: string;
  claimantDeclaration: string;
  accusedDeclaration: string;
  referenceDeclaration: string;
  findingsAndEvaluation: string;
  documentsUsed: string;
  interviewsUsed: string;
  identifiedLimits: string;
  contradictionsIdentified: string;
  partiesIdentified: string;
  noDocuments: string;
  noAdditionalLimits: string;
  noContradictions: string;
  noParties: string;
  noAccount: string;
  noGlobalAssessment: string;
  initialSituationPlaceholder: string;
  factFindingFrameworkPlaceholder: string;
  mandatePlaceholder: string;
  procedurePlaceholder: string;
  limitsPlaceholder: string;
  legalBasisPlaceholder: string;
  mobbingDefinitionPlaceholder: string;
  contradictoryDefinitionPlaceholder: string;
  companyContextPlaceholder: string;
  numberedReferenceDeclaration: (index: number) => string;
};

function getReportCopy(language: ReportLanguage): ReportCopy {
  if (language === "de") return germanReportCopy;
  return language === "fr" ? frenchReportCopy : englishReportCopy;
}

const englishReportCopy: ReportCopy = {
  initialSituation: "Initial situation",
  factFindingFramework: "Fact-finding framework",
  mandate: "Mandate",
  procedure: "Procedure",
  investigationLimits: "Limits of the investigation",
  legalBasis: "Legal basis and definitions",
  mobbingBossing: "Mobbing / Bossing",
  contradictoryStatements: "Contradictory statements",
  companyContext: "Company context",
  examinationOfAllegations: "Examination of the allegations",
  allegationsIntro:
    "The claimant reported a number of situations considered to illustrate the difficulties encountered with the accused person. The examples presented below are not an exhaustive list of all situations raised during the investigation, but correspond to those considered most representative of the allegations made. All elements communicated were nevertheless taken into account in the overall assessment of the situation.",
  globalAssessment: "Global assessment",
  claimantDeclaration: "Claimant declaration",
  accusedDeclaration: "Accused person declaration",
  referenceDeclaration: "Reference person declaration",
  findingsAndEvaluation: "Findings and evaluation",
  documentsUsed: "Documents and interviews used:",
  interviewsUsed: "Interview accounts used:",
  identifiedLimits: "Identified limits and missing elements:",
  contradictionsIdentified: "Contradictory points identified in the case analysis:",
  partiesIdentified: "Parties and roles identified in the case analysis:",
  noDocuments: "No extracted document summary is available in the case file.",
  noAdditionalLimits: "No additional investigation limits were recorded in the case analysis.",
  noContradictions: "The case analysis does not identify a specific word-against-word configuration beyond the contradictions addressed in the individual allegations.",
  noParties: "No party information is available in the case analysis.",
  noAccount: "No account on record.",
  noGlobalAssessment: "No global assessment is available in the case analysis.",
  initialSituationPlaceholder:
    "Complete the initial situation, background, and relevant chronology.",
  factFindingFrameworkPlaceholder:
    "Add any general framing needed for the fact-finding process.",
  mandatePlaceholder:
    "Complete the formal mandate, date, scope, and mandating person or body.",
  procedurePlaceholder:
    "Describe the investigative steps, reviewed documents, and interviews conducted.",
  limitsPlaceholder:
    "Describe the limits of the investigation, unavailable material, or unresolved points.",
  legalBasisPlaceholder:
    "Add the applicable legal or internal framework.",
  mobbingDefinitionPlaceholder:
    "Add the applicable definition or reference text.",
  contradictoryDefinitionPlaceholder:
    "Add the method used to address contradictory statements.",
  companyContextPlaceholder:
    "Complete the relevant company context, roles, reporting lines, and organizational background.",
  numberedReferenceDeclaration: (index) => `Reference person declaration ${index}`,
};

const frenchReportCopy: ReportCopy = {
  initialSituation: "Situation initiale",
  factFindingFramework: "Cadre de l’établissement des faits",
  mandate: "Mandat",
  procedure: "Procédure",
  investigationLimits: "Limites de l’activité d’enquête",
  legalBasis: "Fondements juridiques et définitions",
  mobbingBossing: "Mobbing / Bossing",
  contradictoryStatements: "Déclarations contradictoires",
  companyContext: "Contexte de l’entreprise",
  examinationOfAllegations: "Examen des reproches",
  allegationsIntro:
    "La personne plaignante a relaté un certain nombre de situations qu’elle considérait comme illustrant les difficultés rencontrées avec la personne mise en cause. Les exemples présentés ci-après ne constituent pas une liste exhaustive des situations évoquées au cours de l’enquête, mais correspondent à celles qui ont été jugées les plus représentatives des reproches formulés. L’ensemble des éléments communiqués a toutefois été pris en considération dans l’appréciation globale de la situation.",
  globalAssessment: "Appréciation globale",
  claimantDeclaration: "Déclaration de la personne plaignante",
  accusedDeclaration: "Déclaration de la personne mise en cause",
  referenceDeclaration: "Déclaration de la personne de référence",
  findingsAndEvaluation: "Constats et appréciation",
  documentsUsed: "Documents et entretiens utilisés :",
  interviewsUsed: "Comptes rendus d’entretien utilisés :",
  identifiedLimits: "Limites et éléments manquants identifiés :",
  contradictionsIdentified: "Points contradictoires identifiés dans l’analyse du dossier :",
  partiesIdentified: "Parties et rôles identifiés dans l’analyse du dossier :",
  noDocuments: "Aucun résumé de document extrait n’est disponible dans le dossier.",
  noAdditionalLimits: "Aucune limite d’enquête supplémentaire n’a été enregistrée dans l’analyse du dossier.",
  noContradictions: "L’analyse du dossier n’identifie pas de configuration spécifique de parole contre parole au-delà des contradictions examinées dans les reproches individuels.",
  noParties: "Aucune information sur les parties n’est disponible dans l’analyse du dossier.",
  noAccount: "Aucune déclaration n’est disponible dans le dossier.",
  noGlobalAssessment: "Aucune appréciation globale n’est disponible dans l’analyse du dossier.",
  initialSituationPlaceholder:
    "Compléter la situation initiale, le contexte et la chronologie utile.",
  factFindingFrameworkPlaceholder:
    "Ajouter les éléments généraux nécessaires au cadrage de l’établissement des faits.",
  mandatePlaceholder:
    "Compléter le mandat formel, la date, le périmètre et la personne ou l’organe mandant.",
  procedurePlaceholder:
    "Décrire les démarches effectuées, les documents examinés et les entretiens menés.",
  limitsPlaceholder:
    "Décrire les limites de l’enquête, les éléments indisponibles ou les points non résolus.",
  legalBasisPlaceholder:
    "Ajouter le cadre juridique ou interne applicable.",
  mobbingDefinitionPlaceholder:
    "Ajouter la définition applicable ou le texte de référence.",
  contradictoryDefinitionPlaceholder:
    "Ajouter la méthode retenue pour traiter les déclarations contradictoires.",
  companyContextPlaceholder:
    "Compléter le contexte de l’entreprise, les rôles, les lignes hiérarchiques et les éléments organisationnels utiles.",
  numberedReferenceDeclaration: (index) =>
    `Déclaration de la personne de référence ${index}`,
};

const germanReportCopy: ReportCopy = {
  initialSituation: "Ausgangslage",
  factFindingFramework: "Rahmen der Sachverhaltsabklärung",
  mandate: "Mandat",
  procedure: "Vorgehen",
  investigationLimits: "Grenzen der Abklärung",
  legalBasis: "Rechtliche Grundlagen und Begriffe",
  mobbingBossing: "Mobbing / Bossing",
  contradictoryStatements: "Widersprüchliche Aussagen",
  companyContext: "Unternehmenskontext",
  examinationOfAllegations: "Prüfung der Vorwürfe",
  allegationsIntro:
    "Die beschwerdeführende Person schilderte eine Reihe von Situationen, die aus ihrer Sicht die Schwierigkeiten mit der beschuldigten Person veranschaulichen. Die nachfolgend dargestellten Beispiele bilden keine abschliessende Liste aller im Rahmen der Untersuchung erwähnten Situationen, sondern entsprechen denjenigen Punkten, die als besonders repräsentativ für die erhobenen Vorwürfe beurteilt wurden. Sämtliche mitgeteilten Elemente wurden jedoch in der Gesamtwürdigung der Situation berücksichtigt.",
  globalAssessment: "Gesamtwürdigung",
  claimantDeclaration: "Aussage der beschwerdeführenden Person",
  accusedDeclaration: "Aussage der beschuldigten Person",
  referenceDeclaration: "Aussage der Referenzperson",
  findingsAndEvaluation: "Feststellungen und Würdigung",
  documentsUsed: "Verwendete Dokumente und Gespräche:",
  interviewsUsed: "Verwendete Gesprächsprotokolle:",
  identifiedLimits: "Identifizierte Grenzen und fehlende Elemente:",
  contradictionsIdentified: "Widersprüchliche Punkte aus der Fallanalyse:",
  partiesIdentified: "In der Fallanalyse identifizierte Parteien und Rollen:",
  noDocuments: "Im Dossier ist keine extrahierte Dokumentenzusammenfassung verfügbar.",
  noAdditionalLimits: "In der Fallanalyse wurden keine zusätzlichen Abklärungsgrenzen festgehalten.",
  noContradictions: "Die Fallanalyse identifiziert keine spezifische Aussage-gegen-Aussage-Konstellation über die in den einzelnen Vorwürfen behandelten Widersprüche hinaus.",
  noParties: "In der Fallanalyse sind keine Angaben zu den Parteien verfügbar.",
  noAccount: "Im Dossier ist keine Aussage verfügbar.",
  noGlobalAssessment: "In der Fallanalyse ist keine Gesamtwürdigung verfügbar.",
  initialSituationPlaceholder:
    "Ausgangslage, Hintergrund und relevante Chronologie ergänzen.",
  factFindingFrameworkPlaceholder:
    "Allgemeine Angaben zum Rahmen der Sachverhaltsabklärung ergänzen.",
  mandatePlaceholder:
    "Formelles Mandat, Datum, Umfang sowie mandatierende Person oder Stelle ergänzen.",
  procedurePlaceholder:
    "Durchgeführte Schritte, geprüfte Unterlagen und geführte Gespräche beschreiben.",
  limitsPlaceholder:
    "Grenzen der Abklärung, nicht verfügbare Elemente oder offene Punkte beschreiben.",
  legalBasisPlaceholder:
    "Anwendbaren rechtlichen oder internen Rahmen ergänzen.",
  mobbingDefinitionPlaceholder:
    "Anwendbare Definition oder Referenztext ergänzen.",
  contradictoryDefinitionPlaceholder:
    "Methode zum Umgang mit widersprüchlichen Aussagen ergänzen.",
  companyContextPlaceholder:
    "Relevanten Unternehmenskontext, Rollen, Berichtslinien und organisatorische Hintergründe ergänzen.",
  numberedReferenceDeclaration: (index) => `Aussage der Referenzperson ${index}`,
};

function findContradictionLines(reproches: Reproche[]): string[] {
  return reproches
    .filter((reproche) => hasContradiction(reproche))
    .map((reproche) => `- ${reproche.title}`);
}

function hasContradiction(reproche: Reproche): boolean {
  const text = [
    reproche.verdict,
    reproche.evaluation,
    ...reproche.findings,
  ]
    .join(" ")
    .toLowerCase();

  return [
    "word against word",
    "contradict",
    "disputed",
    "diverg",
    "parole contre parole",
    "contradic",
    "contest",
    "diverg",
    "disput",
  ].some((marker) => text.includes(marker));
}

function paragraph(value: string): string {
  return value.trim();
}

function cleanDashboardOnlyContent(value: string): string {
  return value
    .replace(/\bdashboard\b/gi, "analysis")
    .replace(/\btableau de bord\b/gi, "analyse")
    .replace(/\bRe[-\s]?analy[sz]e\b/gi, "")
    .replace(/\bconfidence(?: score)?\s*:?\s*\d{1,3}%?/gi, "")
    .replace(/[^.!?\n]*\bconfidence(?: score)?\b[^.!?\n]*(?:[.!?]|$)/gi, "")
    .replace(/\b\d{1,3}\s*%\b/g, "")
    .replace(/\b(?:Mobbing|Sexual harassment|Violence|Racism):\s*(?:Likely indicated|Possible|Not indicated|Insufficient information)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findDashboardOnlyContentIssues(value: string) {
  const issues = [];
  const forbiddenPatterns = [
    {
      pattern: /\bconfidence(?: score)?\b/i,
      subject: "Dashboard confidence wording",
    },
    {
      pattern: /\b\d{1,3}\s*%\b/,
      subject: "Dashboard percentage",
    },
    {
      pattern: /\bRe[-\s]?analy[sz]e\b/i,
      subject: "Dashboard action label",
    },
    {
      pattern: /\b(?:dashboard|tableau de bord)\b/i,
      subject: "Dashboard wording",
    },
    {
      pattern: /\b(?:Mobbing|Sexual harassment|Violence|Racism):\s*(?:Likely indicated|Possible|Not indicated|Insufficient information)\b/i,
      subject: "Dashboard conduct label",
    },
  ];

  for (const item of forbiddenPatterns) {
    if (!item.pattern.test(value)) continue;

    issues.push({
      subject: item.subject,
      versionA: "Dashboard-only content remains in the report draft.",
      versionB: "The report draft must contain only report prose.",
      recommendation: "Remove the dashboard-only wording before saving.",
    });
  }

  return issues;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
