import { createScorer } from "@mastra/core/evals";
import Anthropic from "@anthropic-ai/sdk";
import {
  checkVerdictFormat,
  checkNoDateWords,
  checkNoSemicolonsOutsideCode,
  checkRequiredSections,
} from "../mastra/agents/output-validators";

const toText = (val: unknown): string =>
  typeof val === "string" ? val : JSON.stringify(val);

// Judge model for LLM-scored evals (~$0.001/call)
const JUDGE_MODEL = "claude-haiku-4-5-20251001";

// --- Text extraction from Mastra run objects ---
// run.input is { inputMessages: MastraDBMessage[], ... }
// run.output is MastraDBMessage[]
// We need the actual text content, not JSON-stringified messages.

function extractText(val: unknown): string {
  if (typeof val === "string") return val;

  // MastraDBMessage[] — extract text from parts
  if (Array.isArray(val)) {
    return val
      .map((msg: any) => {
        if (typeof msg === "string") return msg;
        const content = msg?.content;
        if (!content) return "";
        if (typeof content === "string") return content;
        // MastraMessageContentV2: { format: 2, parts: [{ type: "text", text: "..." }] }
        if (content.parts) {
          return content.parts
            .filter((p: any) => p.type === "text" || p.text)
            .map((p: any) => p.text ?? "")
            .join("");
        }
        if (typeof content.content === "string") return content.content;
        return "";
      })
      .join("\n");
  }

  // run.input object: { inputMessages, rememberedMessages, ... }
  if (val && typeof val === "object" && "inputMessages" in val) {
    return extractText((val as any).inputMessages);
  }

  return JSON.stringify(val);
}

// --- Context extraction helpers ---

function extractDocContext(input: string): string {
  const match = input.match(
    /## Document Content:\n([\s\S]*?)(?=\nFINDING_ID:)/
  );
  return match?.[1]?.trim() ?? "";
}

function extractFindings(input: string): string {
  const match = input.match(
    /(FINDING_ID:[\s\S]*?)(?=\n## (?:YOUR REVIEW|PYTHON VALIDATION))/
  );
  return match?.[1]?.trim() ?? "";
}

async function askJudge(prompt: string): Promise<{ score: number; reason: string }> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
  let text =
    response.content[0].type === "text" ? response.content[0].text : "";
  // Strip markdown code fences (Haiku often wraps JSON in ```json...```)
  text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    return {
      score: typeof parsed.score === "number" ? parsed.score : 1,
      reason: parsed.reason ?? text,
    };
  } catch {
    return { score: 1, reason: `Judge returned non-JSON: ${text.slice(0, 200)}` };
  }
}

// 1. Verdict Format — Does output have "GO (xx/100)" pattern?
export const verdictFormatScorer = createScorer({
  id: "verdict-format",
  description: "Checks for valid GO/WAIT/NO_GO (xx/100) verdict line",
})
  .generateScore(({ run }) => {
    const result = checkVerdictFormat(toText(run.output));
    return result.passed ? 1 : 0;
  })
  .generateReason(({ run }) => {
    const result = checkVerdictFormat(toText(run.output));
    return result.passed ? "Valid verdict found" : result.errors.join("; ");
  });

// 2. No Date Words — Lucas must never generate date calculations
export const noDateWordsScorer = createScorer({
  id: "no-date-words",
  description:
    "Ensures no forbidden date words (expired, days remaining, etc.)",
})
  .generateScore(({ run }) => {
    const result = checkNoDateWords(toText(run.output));
    return result.passed ? 1 : 0;
  })
  .generateReason(({ run }) => {
    const result = checkNoDateWords(toText(run.output));
    return result.passed ? "No forbidden date words" : result.errors.join("; ");
  });

// 3. No Semicolons — Style rule
export const noSemicolonsScorer = createScorer({
  id: "no-semicolons",
  description: "Semicolons banned outside code blocks",
}).generateScore(({ run }) => {
  const result = checkNoSemicolonsOutsideCode(toText(run.output));
  return result.passed ? 1 : 0;
});

// 4. Required Sections — Must have "The good news", "Watch out for", etc.
export const requiredSectionsScorer = createScorer({
  id: "required-sections",
  description: "Checks for required section headers in analysis output",
})
  .generateScore(({ run }) => {
    const result = checkRequiredSections(toText(run.output));
    return result.passed ? 1 : 0;
  })
  .generateReason(({ run }) => {
    const result = checkRequiredSections(toText(run.output));
    return result.passed ? "All sections present" : result.errors.join("; ");
  });

// 5. Verdict Accuracy — Does the verdict match expected?
export const verdictAccuracyScorer = createScorer({
  id: "verdict-accuracy",
  description: "Checks if verdict matches expected GO/WAIT/NO_GO",
})
  .generateScore(({ run }) => {
    if (!run.groundTruth?.expectedVerdict) return 1; // No ground truth = skip
    const text = toText(run.output);
    const verdictMatch = text.match(/(GO|WAIT|NO_GO)\s*\(\d+\/100\)/);
    if (!verdictMatch) return 0;
    return verdictMatch[1] === run.groundTruth.expectedVerdict ? 1 : 0;
  })
  .generateReason(({ run }) => {
    if (!run.groundTruth?.expectedVerdict)
      return "No expected verdict specified";
    const text = toText(run.output);
    const verdictMatch = text.match(/(GO|WAIT|NO_GO)\s*\(\d+\/100\)/);
    if (!verdictMatch) return "No verdict found in output";
    const actual = verdictMatch[1];
    const expected = run.groundTruth.expectedVerdict;
    return actual === expected
      ? `Correct: ${actual}`
      : `Wrong: got ${actual}, expected ${expected}`;
  });

// ============================================================
// LLM-JUDGED SCORERS (Haiku as judge, ~$0.001/call)
// ============================================================

// 6. Entity Grounding — Are all entity names in the output grounded in source docs?
// Catches the OCEAN SAINT class of bugs (Sonnet fabricating entity names).
export const entityGroundingScorer = createScorer({
  id: "entity-grounding",
  description:
    "Checks if all entity names (vessels, companies, ports) in output appear in source documents",
})
  .generateScore(async ({ run }) => {
    const inputText = extractText(run.input);
    const docs = extractDocContext(inputText);
    const output = extractText(run.output);
    if (!docs || !output) return 1;

    const result = await askJudge(
      `You are an eval judge for a trade finance document analysis system.

Check if the ANALYSIS OUTPUT contains any entity names (vessel names, company names, port names, document numbers) that do NOT appear in the SOURCE DOCUMENTS.

Ignore:
- Generic terms like "the bank", "the buyer", "the seller"
- UCP 600 references, trade terminology
- Section headers and formatting
- Metadata like phone numbers or dates from the prompt wrapper

SOURCE DOCUMENTS:
${docs}

ANALYSIS OUTPUT:
${output}

Are there any FABRICATED entity names? Respond with ONLY a JSON object.
If NO fabricated entities: {"score": 1.0, "reason": "All entities grounded", "fabricated": []}
If fabricated entities found: {"score": 0.0, "reason": "Found fabricated entities", "fabricated": ["ENTITY1"]}`
    );
    // Haiku sometimes returns score 0 but reason says "all grounded" — cross-validate
    if (result.score === 0 && /no fabricated|all.*grounded/i.test(result.reason)) {
      return 1;
    }
    return result.score;
  })
  .generateReason(async ({ run }) => {
    const inputText = extractText(run.input);
    const docs = extractDocContext(inputText);
    const output = extractText(run.output);
    if (!docs || !output) return "No documents to check";

    const result = await askJudge(
      `You are an eval judge for a trade finance document analysis system.

Check if the ANALYSIS OUTPUT contains any entity names (vessel names, company names, port names, document numbers) that do NOT appear in the SOURCE DOCUMENTS.

Ignore generic terms like "the bank", "the buyer", UCP 600 references.

SOURCE DOCUMENTS:
${docs}

ANALYSIS OUTPUT:
${output}

Respond with ONLY a JSON object:
{"score": 1.0, "reason": "All entities grounded", "fabricated": []}`
    );
    return result.reason;
  });

// 7. Finding Faithfulness — Does the analysis accurately reflect Python's findings?
// Catches Sonnet inventing findings or contradicting Python's severity.
export const findingFaithfulnessScorer = createScorer({
  id: "finding-faithfulness",
  description:
    "Checks if analysis faithfully reflects Python findings without fabrication",
})
  .generateScore(async ({ run }) => {
    const inputText = extractText(run.input);
    const findings = extractFindings(inputText);
    const output = extractText(run.output);
    if (!findings || !output) return 1;

    const mustMention = run.groundTruth?.mustMention as string[] | undefined;
    const mustNotMention = run.groundTruth?.mustNotMention as
      | string[]
      | undefined;

    const mentionContext = [
      mustMention?.length
        ? `\nMUST MENTION these terms: ${mustMention.join(", ")}`
        : "",
      mustNotMention?.length
        ? `\nMUST NOT MENTION these terms: ${mustNotMention.join(", ")}`
        : "",
    ].join("");

    const result = await askJudge(
      `You are an eval judge for a trade finance document analysis system.

Check if the ANALYSIS OUTPUT faithfully reflects the PYTHON FINDINGS below. Specifically:
1. Does the analysis address each Python finding?
2. Does it invent new deterministic findings that Python didn't produce?
3. Does it contradict Python's severity assignments?
4. Does it fabricate document quotes not in the findings?
${mentionContext}

PYTHON FINDINGS:
${findings}

ANALYSIS OUTPUT:
${output}

Respond with ONLY a JSON object:
{"score": 1.0, "reason": "Analysis faithfully reflects findings"}
or
{"score": 0.0, "reason": "Analysis fabricates/contradicts findings", "issues": ["issue1"]}

Score 1.0 = perfectly faithful.
Score 0.0 = major fabrication or contradiction.
Use intermediate scores for minor issues.`
    );
    return result.score;
  })
  .generateReason(async ({ run }) => {
    const inputText = extractText(run.input);
    const findings = extractFindings(inputText);
    const output = extractText(run.output);
    if (!findings || !output) return "No findings to check";

    const result = await askJudge(
      `You are an eval judge. Does this ANALYSIS faithfully reflect these PYTHON FINDINGS?

PYTHON FINDINGS:
${findings}

ANALYSIS OUTPUT:
${output}

Respond with ONLY a JSON object:
{"score": 1.0, "reason": "explanation"}`
    );
    return result.reason;
  });

// 8. Prompt Alignment — Does output follow the Senior Reviewer contract?
// Custom scorer (prebuilt createPromptAlignmentScorerLLM requires complex structured
// output that Haiku can't reliably produce).
export const promptAlignmentScorer = createScorer({
  id: "prompt-alignment",
  description:
    "Checks if output follows Senior Reviewer format (REVIEW_START/ANALYSIS_START, FINDING_ID blocks, HARD RULES)",
})
  .generateScore(async ({ run }) => {
    const output = extractText(run.output);
    if (!output) return 1;

    const result = await askJudge(
      `You are an eval judge for a trade finance document analysis system called Lucas.

Check if the output follows the Senior Reviewer contract. The output has TWO sections:

1. ---REVIEW_START--- section (FORMAL): Must have FINDING_ID/STATUS/CONFIDENCE/EVIDENCE/NOTES blocks for each Python finding. Must NOT reassign severity. Evidence must be verbatim quotes.

2. ---ANALYSIS_START--- section (USER-FACING): This section IS allowed to be casual, friendly, use emoji, and conversational tone — it's written for the end user. BUT it must NOT:
   - Introduce new DETERMINISTIC findings that Python didn't produce
   - Fabricate document content or quotes
   - Contradict Python's severity

IMPORTANT: Do NOT penalize casual tone, emoji, greetings, or conversational style in the ANALYSIS section. That is by design. Only penalize structural violations (missing sections, missing FINDING_ID blocks in REVIEW, new deterministic findings, fabricated evidence).

OUTPUT:
${output}

Respond with ONLY a JSON object:
{"score": 1.0, "reason": "Follows contract"}
or
{"score": 0.0, "reason": "Violates contract", "issues": ["issue1"]}

Score 1.0 = both sections present and compliant.
Score 0.0 = missing sections or major violations (fabricated findings/evidence).
Use intermediate scores for minor issues.`
    );
    return result.score;
  })
  .generateReason(async ({ run }) => {
    const output = extractText(run.output);
    if (!output) return "No output to check";

    const result = await askJudge(
      `You are an eval judge for Lucas, a trade finance analysis system.

Does this output follow the Senior Reviewer contract? Check:
1. Has ---REVIEW_START--- with structured FINDING_ID blocks?
2. Has ---ANALYSIS_START--- with semantic analysis?
3. No fabricated deterministic findings?
(Casual tone and emoji in ANALYSIS section is OK — it's user-facing.)

OUTPUT:
${output}

Respond with ONLY a JSON object:
{"score": 1.0, "reason": "explanation"}`
    );
    return result.reason;
  });
