/**
 * Apples-to-apples extraction benchmark: run ONE real document through the full,
 * unchanged extraction pipeline under each provider (OpenAI vs Anthropic) and
 * report the quality dimensions side by side. The only thing that varies between
 * runs is the model behind `getExtractionProvider()` — chunking, prompts,
 * consolidation, validation, and normalization are identical.
 *
 * Usage:
 *   npx tsx scripts/benchmark-extraction.ts <paginated-text-file> [outDir]
 *
 * The input must be the document's stored `rawText` — i.e. text that already
 * carries "--- Page N ---" markers (every document is paginated before
 * extraction). Plain unpaginated text yields zero chunks. Export a real case
 * document's rawText to a file and point this script at it.
 *
 * Requires OPENAI_API_KEY and ANTHROPIC_API_KEY in the environment.
 *
 * Writes <outDir>/<provider>.json (consolidated result) for each provider so you
 * can diff allegation accuracy, quote relevance, and hallucinations by hand,
 * and prints a count table for the quantitative dimensions.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createExtractionChunks } from "@/features/extraction/lib/extraction-chunks";
import {
  consolidateExtractions,
  extractInterviewChunkWithFallback,
} from "@/features/extraction/lib/pipeline";
import type { ExtractionResponse } from "@/lib/types";

type ProviderName = "openai" | "anthropic";

interface RunResult {
  provider: ProviderName;
  ok: boolean;
  durationMs: number;
  error?: string;
  result?: ExtractionResponse;
}

async function runProvider(
  provider: ProviderName,
  rawText: string,
  documentName: string
): Promise<RunResult> {
  // getExtractionProvider() reads this fresh on every call (env.extractionProvider
  // is a getter), so flipping it here switches the backend for this whole run.
  process.env.EXTRACTION_PROVIDER = provider;

  const startedAt = Date.now();
  try {
    const chunks = createExtractionChunks(rawText);
    if (chunks.length === 0) {
      throw new Error(
        'No pages found. Input must contain "--- Page N ---" markers.'
      );
    }

    // Same shape as the real action: extract every chunk (with per-page
    // fallback), then consolidate the drafts.
    const draftGroups = await Promise.all(
      chunks.map((chunk) =>
        extractInterviewChunkWithFallback(chunk, documentName)
      )
    );
    const drafts = draftGroups.flat();
    const result = await consolidateExtractions(drafts, {
      onStep: (message) => console.log(`  [${provider}] ${message}`),
    });

    return {
      provider,
      ok: true,
      durationMs: Date.now() - startedAt,
      result,
    };
  } catch (error) {
    return {
      provider,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Count the items in each benchmark dimension for one consolidated result. */
function dimensions(result: ExtractionResponse) {
  const datedEvents = result.keyEvents.filter((event) => event.date != null);
  return {
    allegations: result.allegations.length,
    keyEvents: result.keyEvents.length,
    "keyEvents w/ date": datedEvents.length,
    notableQuotes: result.notableQuotes.length,
    factualStatements: result.factualStatements.length,
    "potential witnesses": result.potentialWitnesses.length,
    "consolidated witnesses": result.consolidatedWitnesses.length,
    "people mentioned": result.peopleMentioned.length,
    "evidence assessments": result.evidenceAssessment.length,
    "extraction warnings": result.extractionWarnings.length,
  };
}

function printComparison(runs: RunResult[]) {
  const dimensionKeys = Object.keys(dimensions(EMPTY_FOR_KEYS()));
  const header = ["dimension", ...runs.map((run) => run.provider)];
  const rows: string[][] = [];

  rows.push(["JSON valid", ...runs.map((run) => (run.ok ? "yes" : "NO"))]);
  rows.push([
    "duration (s)",
    ...runs.map((run) => (run.durationMs / 1000).toFixed(1)),
  ]);

  for (const key of dimensionKeys) {
    rows.push([
      key,
      ...runs.map((run) =>
        run.result
          ? String(dimensions(run.result)[key as keyof ReturnType<typeof dimensions>])
          : "—"
      ),
    ]);
  }

  const widths = header.map((_, col) =>
    Math.max(header[col].length, ...rows.map((row) => row[col].length))
  );
  const format = (cells: string[]) =>
    cells.map((cell, col) => cell.padEnd(widths[col])).join("  ");

  console.log("\n" + format(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log(
    "\nAllegation accuracy, quote relevance, and hallucinations are qualitative —" +
      " compare the written JSON files by hand."
  );
}

// Build an empty result purely to derive the dimension key order without
// hardcoding it twice.
function EMPTY_FOR_KEYS(): ExtractionResponse {
  return {
    allegations: [],
    keyEvents: [],
    notableQuotes: [],
    factualStatements: [],
    potentialWitnesses: [],
    consolidatedWitnesses: [],
    peopleMentioned: [],
    evidenceAssessment: [],
    extractionWarnings: [],
  } as unknown as ExtractionResponse;
}

async function main() {
  const [inputPath, outDir = "benchmark-out"] = process.argv.slice(2);
  if (!inputPath) {
    console.error(
      "Usage: npx tsx scripts/benchmark-extraction.ts <paginated-text-file> [outDir]"
    );
    process.exit(1);
  }

  const rawText = readFileSync(inputPath, "utf8");
  const documentName = inputPath.split("/").pop() ?? "document";
  mkdirSync(outDir, { recursive: true });

  const providers: ProviderName[] = ["openai", "anthropic"];
  const runs: RunResult[] = [];

  for (const provider of providers) {
    console.log(`\n=== Running ${provider} ===`);
    const run = await runProvider(provider, rawText, documentName);
    if (run.ok && run.result) {
      const outPath = `${outDir}/${provider}.json`;
      writeFileSync(outPath, JSON.stringify(run.result, null, 2));
      console.log(`  wrote ${outPath} (${(run.durationMs / 1000).toFixed(1)}s)`);
    } else {
      console.error(`  FAILED: ${run.error}`);
    }
    runs.push(run);
  }

  printComparison(runs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
