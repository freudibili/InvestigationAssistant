import "server-only";

import { ZodError } from "zod";

import { getAnalysisProvider } from "@/features/extraction/lib/providers";
import {
  conductAssessmentSchema,
  type ConductAssessment,
  type InvestigationAnalysis,
} from "@/features/investigation-analysis/validation";
import type { Reproche } from "@/features/investigation-analysis/types";

export class ConductAssessmentError extends Error {
  readonly userMessage: string;
  readonly detail?: string;

  constructor(
    userMessage: string,
    options: { detail?: string; cause?: unknown } = {}
  ) {
    super(userMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = "ConductAssessmentError";
    this.userMessage = userMessage;
    this.detail = options.detail;
  }
}

const SYSTEM_PROMPT = `You are a cautious workplace investigation analyst.
Classify one already-triangulated grievance against workplace conduct categories. Use only the provided grievance content. Do not make legal conclusions, do not infer facts, and do not decide liability.
Write visible reasoning as a concise risk indicator, not a second investigation analysis. Each section must have a unique purpose and must not repeat the same caveat.
Return ONLY valid JSON matching the requested schema.`;

const MOBBING_FRAMEWORK = [
  "Expression and communication: restricting expression, interrupting, insults, threats, or hostile communication.",
  "Social relations: isolation, exclusion, refusal to speak, or deliberate relational marginalization.",
  "Professional reputation: ridicule, rumors, humiliation, attacks on dignity, or discrediting a person.",
  "Working conditions: assigning degrading, impossible, pointless, or inappropriate work; removing work; undermining professional activity.",
  "Health: threats, physical violence, sexual harassment, or actions affecting physical or psychological health.",
];

export async function assessReprocheConduct(
  reproche: Reproche
): Promise<ConductAssessment> {
  return requestConductAssessment(buildPrompt(reproche));
}

export async function assessGlobalConduct(
  analysis: InvestigationAnalysis
): Promise<ConductAssessment> {
  const assessedReproches = analysis.reproches.filter(
    (reproche) => reproche.conductAssessment
  );

  if (assessedReproches.length !== analysis.reproches.length) {
    throw new ConductAssessmentError(
      "Run the conduct assessment for every grievance before calculating the global result."
    );
  }

  return requestConductAssessment(buildGlobalPrompt(analysis));
}

async function requestConductAssessment(prompt: string): Promise<ConductAssessment> {
  const { content, truncated } = await getAnalysisProvider().complete({
    system: SYSTEM_PROMPT,
    user: prompt,
  });

  if (!content) {
    throw new ConductAssessmentError("The AI returned an empty assessment.");
  }
  if (truncated) {
    throw new ConductAssessmentError(
      "The AI assessment was cut off before it finished. Try again.",
      { detail: `truncated, chars=${content.length}` }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ConductAssessmentError(
      "The AI returned an assessment that was not valid JSON.",
      { cause: error, detail: content.slice(0, 1000) }
    );
  }

  try {
    return conductAssessmentSchema.parse(parsed);
  } catch (error) {
    throw new ConductAssessmentError(
      "The AI assessment did not match the expected format.",
      {
        cause: error,
        detail:
          error instanceof ZodError
            ? error.issues.map((issue) => issue.path.join(".")).join(", ")
            : String(error),
      }
    );
  }
}

function buildPrompt(reproche: Reproche): string {
  const payload = {
    title: reproche.title,
    grievanceType: reproche.grievanceType,
    description: reproche.description,
    claimantStatement: reproche.claimantStatement.summary,
    accusedStatement: reproche.accusedStatement.summary,
    referenceStatements: reproche.referenceStatements.map(
      (statement) => statement.summary
    ),
    findings: reproche.findings,
    evaluation: reproche.evaluation,
    verdict: reproche.verdict,
    openQuestions: reproche.openQuestions,
  };

  return `Assess whether this grievance indicates any of these categories:
- Mobbing
- Sexual harassment
- Violence
- Racism

For mobbing, use the SECO workplace mobbing framework. Mobbing requires repeated or systematic conduct over time and can involve these five forms:
${MOBBING_FRAMEWORK.map((item) => `- ${item}`).join("\n")}

Use these statuses only:
- Likely indicated: the available elements clearly point to the category.
- Possible: some elements point to the category, but the record has material limits.
- Not indicated: the available elements do not point to the category.
- Insufficient information: the provided grievance does not contain enough information to assess.

Rules:
- Keep the assessment cautious and evidence-based.
- Do not label a single isolated incident as mobbing unless the grievance describes repeated or systematic conduct.
- Sexual harassment, violence, and racism may be indicated by a single incident if the available elements support it.
- Visible text must not mention SECO or the underlying framework by name. Use neutral wording such as "mobbing indicators", "assessment dimensions", and the dimension names.
- overallCaution must be a short global interpretation answering which category may be relevant, why, and what prevents higher confidence.
- Rationale must be concise, neutral, and based only on the provided content.
- For Mobbing category rationale, explain only the repeated/systematic threshold issue.
- For Violence category rationale, explain only whether the available elements indicate physical violence, threats, or perceived verbal intensity.
- For Sexual harassment and Racism, keep rationale very short when confidence is 0 or the status is Not indicated.
- Do not restate the full grievance in each category.
- Do not repeat the same limitation across categories, dimensions, overallCaution, and missingInformation.
- Mention "single incident" at most once across all visible text.
- Mention "repeated" or "systematic" at most once across all visible text.
- Mention "disputed" at most once across all visible text.
- Mention missing witnesses or absent direct accounts only in missingInformation.
- supportingFactors must be short strings.
- Put all missing elements in the top-level missingInformation list. Leave category missingInformation arrays empty unless a category has a unique missing point not already listed.
- mobbingFactors must include only these exact values when relevant: "Expression and communication", "Social relations", "Professional reputation", "Working conditions", "Health".
- confidence must be an integer from 0 to 100 expressing how strongly the available elements support that category, not certainty that the conduct occurred.
- Use lower confidence when the grievance is based on one account only, lacks dates/examples, lacks corroboration, or has unresolved contradictions.
- For mobbing, fill mobbingFactorAssessments with each assessment dimension that is supported or possibly supported. Each rationale must explain only why that specific dimension may apply and must not repeat global caveats.
- Return all four categories in categories.
- Return JSON only in this exact shape:
{
  "categories": [
    {
      "category": "Mobbing",
      "status": "Possible",
      "confidence": 50,
      "rationale": "",
      "supportingFactors": [],
      "missingInformation": []
    }
  ],
  "mobbingFactors": [],
  "mobbingFactorAssessments": [
    {
      "factor": "Expression and communication",
      "confidence": 50,
      "rationale": ""
    }
  ],
  "missingInformation": [],
  "overallCaution": ""
}

Grievance:
${JSON.stringify(payload)}`;
}

function buildGlobalPrompt(analysis: InvestigationAnalysis): string {
  const payload = {
    scopeSummary: analysis.scopeSummary,
    globalAssessment: analysis.globalAssessment,
    reproches: analysis.reproches.map((reproche) => ({
      id: reproche.id,
      title: reproche.title,
      grievanceType: reproche.grievanceType,
      verdict: reproche.verdict,
      findings: reproche.findings,
      evaluation: reproche.evaluation,
      conductAssessment: reproche.conductAssessment,
    })),
  };

  return `Calculate the global conduct risk indicator for the whole case from the already-saved per-grievance conduct assessments.

Use the same categories:
- Mobbing
- Sexual harassment
- Violence
- Racism

For mobbing, keep using the same internal workplace mobbing framework and assessment dimensions:
${MOBBING_FRAMEWORK.map((item) => `- ${item}`).join("\n")}

Rules:
- Use only the saved per-grievance conduct assessments and the case-level finding text provided.
- Do not introduce new allegations or new facts.
- Visible text must not mention SECO or the underlying framework by name.
- overallCaution must be a short global interpretation across all grievances.
- Category rationale must explain the case-level pattern or absence of pattern, without repeating every grievance.
- Confidence must be an integer from 0 to 100 expressing the strength of support across the saved assessments, not certainty that the conduct occurred.
- For mobbing, consider whether several grievances together show repeated or systematic conduct; do not treat unrelated isolated grievances as a pattern without explaining the limit.
- Fill mobbingFactorAssessments with the assessment dimensions that are supported or possibly supported across the case.
- Put missing elements in the top-level missingInformation list only.
- Keep 0-confidence category rationales very short.
- Return all four categories in categories.
- Return JSON only in this exact shape:
{
  "categories": [
    {
      "category": "Mobbing",
      "status": "Possible",
      "confidence": 50,
      "rationale": "",
      "supportingFactors": [],
      "missingInformation": []
    }
  ],
  "mobbingFactors": [],
  "mobbingFactorAssessments": [
    {
      "factor": "Expression and communication",
      "confidence": 50,
      "rationale": ""
    }
  ],
  "missingInformation": [],
  "overallCaution": ""
}

Case conduct inputs:
${JSON.stringify(payload)}`;
}
