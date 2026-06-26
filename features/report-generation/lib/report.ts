import "server-only";

import type { InvestigationAnalysis, Reproche } from "@/features/investigation-analysis/types";
import {
  reportDraftSchema,
  type ReportDraft,
  type ReportLanguage,
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
  const content = [frameworkSections, allegationsSection, globalAssessmentSection]
    .join("\n\n")
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
    coherence: { status: "coherent", issues: [] },
  });
}

function buildFrameworkSections(
  input: ReportGenerationInput,
  copy: ReportCopy
): string {
  const { investigationCase, documents, analysis } = input;
  const extractedDocuments = documents.filter(
    (document) => document.status === "extracted"
  );
  const documentLines = extractedDocuments.map(
    (document) => `- ${document.fileName}${document.intervieweeRole ? ` (${document.intervieweeRole})` : ""}`
  );
  const interviewLines = analysis.interviews.map(
    (interview) => `- ${interview.name} (${interview.documentName})`
  );
  const partyLines = analysis.mainParties.map((party) =>
    [party.canonicalName, party.caseRole, party.jobRole].filter(Boolean).join(" - ")
  );
  const missingLimits = [
    ...analysis.gaps.missingInterviews,
    ...analysis.gaps.missingEvidence,
    ...analysis.gaps.missingClarification,
  ];
  const contradictionLines = findContradictionLines(analysis.reproches);

  return [
    `1. ${copy.initialSituation}`,
    paragraph(
      copy.caseIntro(investigationCase.title, investigationCase.companyName)
    ),
    `2. ${copy.factFindingFramework}`,
    `2.1 ${copy.mandate}`,
    paragraph(copy.mandatePlaceholder),
    `2.2 ${copy.procedure}`,
    paragraph(copy.procedureIntro),
    documentLines.length > 0
      ? [copy.documentsUsed, ...documentLines].join("\n")
      : paragraph(copy.noDocuments),
    interviewLines.length > 0
      ? [copy.interviewsUsed, ...interviewLines].join("\n")
      : "",
    `2.3 ${copy.investigationLimits}`,
    paragraph(copy.limitsIntro),
    missingLimits.length > 0
      ? [copy.identifiedLimits, ...uniqueStrings(missingLimits).map((item) => `- ${item}`)].join("\n")
      : paragraph(copy.noAdditionalLimits),
    `3. ${copy.legalBasis}`,
    `3.1 ${copy.mobbingBossing}`,
    paragraph(copy.mobbingDefinition),
    `3.2 ${copy.contradictoryStatements}`,
    paragraph(copy.contradictoryDefinition),
    contradictionLines.length > 0
      ? [copy.contradictionsIdentified, ...contradictionLines].join("\n")
      : paragraph(copy.noContradictions),
    `4. ${copy.companyContext}`,
    paragraph(copy.company(investigationCase.companyName)),
    partyLines.length > 0
      ? [copy.partiesIdentified, ...partyLines.map((line) => `- ${line}`)].join("\n")
      : paragraph(copy.noParties),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildAllegationsSection(
  reproches: Reproche[],
  copy: ReportCopy
): string {
  return [
    `5. ${copy.examinationOfAllegations}`,
    ...reproches.map((reproche, index) =>
      buildAllegationSection(reproche, index + 1, copy)
    ),
  ].join("\n\n");
}

function buildAllegationSection(
  reproche: Reproche,
  number: number,
  copy: ReportCopy
): string {
  const sections = [
    `5.${number} ${reproche.title}`,
    `5.${number}.1 ${copy.claimantDeclaration}`,
    statementText(reproche.claimantStatement.summary, copy),
    `5.${number}.2 ${copy.accusedDeclaration}`,
    statementText(reproche.accusedStatement.summary, copy),
    ...reproche.referenceStatements.flatMap((statement, index) => [
      `5.${number}.${index + 3} ${referenceDeclarationTitle(index, copy)}`,
      statementText(statement.summary, copy),
    ]),
  ];
  const findingsIndex = 3 + reproche.referenceStatements.length;

  return [
    ...sections,
    `5.${number}.${findingsIndex} ${copy.findingsAndEvaluation}`,
    formatFindingsAndEvaluation(reproche),
  ]
    .filter(Boolean)
    .join("\n\n");
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
): string {
  const globalAssessment = cleanDashboardOnlyContent(analysis.globalAssessment).trim();

  return [
    `6. ${copy.globalAssessment}`,
    globalAssessment
      ? paragraph(globalAssessment)
      : paragraph(copy.noGlobalAssessment),
  ].join("\n\n");
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
  mandatePlaceholder: string;
  procedureIntro: string;
  limitsIntro: string;
  mobbingDefinition: string;
  contradictoryDefinition: string;
  caseIntro: (title: string, companyName: string) => string;
  company: (companyName: string) => string;
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
  mandatePlaceholder:
    "The mandate section is to be completed by the investigator with the formal mandate, date, scope, and mandating person or body.",
  procedureIntro:
    "This draft is based on the validated case analysis and the extracted case material available in the file.",
  limitsIntro:
    "This draft formats the validated case analysis into a report structure. It does not add facts, allegations, credibility findings, or legal conclusions.",
  mobbingDefinition:
    "Mobbing or bossing generally refers to repeated or systematic conduct over time that may affect a person's dignity, work situation, social relations, professional reputation, or health. This section is conceptual and does not establish that such conduct occurred.",
  contradictoryDefinition:
    "Where accounts differ, the report distinguishes between what each person states and what the collected elements allow establishing. Unresolved contradictions remain identified as disputed points.",
  caseIntro: (title, companyName) =>
    `This draft report concerns the case "${title}" at ${companyName}.`,
  company: (companyName) => `Company: ${companyName}.`,
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
  mandatePlaceholder:
    "La section relative au mandat doit être complétée par l’enquêteur avec le mandat formel, la date, le périmètre et la personne ou l’organe mandant.",
  procedureIntro:
    "Ce projet est fondé sur l’analyse validée du dossier et sur les éléments extraits disponibles.",
  limitsIntro:
    "Ce projet ne réanalyse pas le dossier. Il place l’analyse validée dans une structure de rapport. Il n’ajoute aucun fait, reproche, élément d’appréciation de crédibilité ou conclusion juridique.",
  mobbingDefinition:
    "Le mobbing ou bossing renvoie généralement à des comportements répétés ou systématiques dans la durée, susceptibles d’affecter la dignité, la situation de travail, les relations sociales, la réputation professionnelle ou la santé d’une personne. Cette section est conceptuelle et ne constate pas que de tels comportements sont établis.",
  contradictoryDefinition:
    "Lorsque les versions divergent, le rapport distingue ce que chaque personne déclare de ce que les éléments recueillis permettent d’établir. Les contradictions non résolues restent identifiées comme des points disputés.",
  caseIntro: (title, companyName) =>
    `Ce projet de rapport concerne le dossier « ${title} » auprès de ${companyName}.`,
  company: (companyName) => `Entreprise : ${companyName}.`,
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
  mandatePlaceholder:
    "Der Abschnitt zum Mandat ist durch die untersuchende Person mit dem formellen Mandat, dem Datum, dem Umfang sowie der mandatierenden Person oder Stelle zu ergänzen.",
  procedureIntro:
    "Dieser Entwurf stützt sich auf die validierte Fallanalyse und die verfügbaren extrahierten Elemente im Dossier.",
  limitsIntro:
    "Dieser Entwurf nimmt keine erneute Analyse des Dossiers vor. Er überführt die validierte Analyse in eine Berichtsstruktur. Er fügt keine neuen Tatsachen, Vorwürfe, Glaubwürdigkeitsbewertungen oder rechtlichen Schlussfolgerungen hinzu.",
  mobbingDefinition:
    "Mobbing oder Bossing bezeichnet allgemein wiederholte oder systematische Verhaltensweisen über eine gewisse Dauer, die die Würde, Arbeitssituation, sozialen Beziehungen, berufliche Reputation oder Gesundheit einer Person beeinträchtigen können. Dieser Abschnitt ist begrifflich und stellt nicht fest, dass ein solches Verhalten vorliegt.",
  contradictoryDefinition:
    "Wenn Aussagen voneinander abweichen, unterscheidet der Bericht zwischen dem, was die einzelnen Personen erklären, und dem, was die erhobenen Elemente feststellen lassen. Nicht aufgelöste Widersprüche bleiben als strittige Punkte ausgewiesen.",
  caseIntro: (title, companyName) =>
    `Dieser Berichtsentwurf betrifft das Dossier "${title}" bei ${companyName}.`,
  company: (companyName) => `Unternehmen: ${companyName}.`,
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
