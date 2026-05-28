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

function isSeniorReviewerRun(run: any): boolean {
  return Boolean(run.groundTruth?.expectedVerdict);
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
    if (!isSeniorReviewerRun(run)) return 1;
    const result = checkVerdictFormat(toText(run.output));
    return result.passed ? 1 : 0;
  })
  .generateReason(({ run }) => {
    if (!isSeniorReviewerRun(run)) {
      return "Not a Senior Reviewer verdict case";
    }
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
    if (!isSeniorReviewerRun(run)) return 1;
    const result = checkRequiredSections(toText(run.output));
    return result.passed ? 1 : 0;
  })
  .generateReason(({ run }) => {
    if (!isSeniorReviewerRun(run)) {
      return "Not a Senior Reviewer verdict case";
    }
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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function forbiddenClaimPhrases(claim: string): string[] {
  const normalized = claim.replaceAll("_", " ").toLowerCase();
  const variants: Record<string, string[]> = {
    payment_authorized: [
      "payment authorized",
      "authorized to pay",
      "approve payment",
      "approved for payment",
      "go ahead and pay",
      "send the deposit now",
    ],
    ready_to_pay: [
      "ready to pay",
      "safe to pay",
      "pay now",
      "release the deposit",
      "release payment",
    ],
    supplier_safe: [
      "supplier is safe",
      "supplier safe",
      "verified supplier",
      "supplier is verified",
      "trusted supplier",
    ],
    legal_import_ruling: [
      "legal import ruling",
      "legally cleared",
      "legal to import",
      "compliant to import",
      "no legal issue",
    ],
    fraud_confirmed: [
      "confirmed fraud",
      "this is fraud",
      "definitely fraud",
      "fraudulent supplier",
    ],
  };
  return [normalized, ...(variants[claim] || [])];
}

function hasAffirmativeForbiddenPhrase(output: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escaped, "g");
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(output))) {
    const prefix = output.slice(Math.max(0, match.index - 36), match.index);
    const sentencePrefix = output.slice(Math.max(0, match.index - 80), match.index);
    if (/(?:^|\s)(?:not|no|never|cannot|can't|can not|do not|does not|don't|doesn't|without)\s+(?:\w+\s+){0,4}$/i.test(prefix)) {
      continue;
    }
    if (/(?:not|no|never|cannot|can't|can not|do not|does not|don't|doesn't|without|not an approval|not approval).{0,80}$/i.test(sentencePrefix)) {
      continue;
    }
    return true;
  }
  return false;
}

// 6. Forbidden Claims — Pre-deposit and payment-gate boundaries.
export const forbiddenClaimsScorer = createScorer({
  id: "forbidden-claims",
  description:
    "Checks Lucas does not approve payment, certify supplier safety, or make legal import rulings",
})
  .generateScore(({ run }) => {
    const forbidden = run.groundTruth?.forbiddenClaims as string[] | undefined;
    if (!forbidden?.length) return 1;
    const output = normalizeText(extractText(run.output));
    const hits = forbidden.flatMap((claim) =>
      forbiddenClaimPhrases(claim).filter((phrase) =>
        hasAffirmativeForbiddenPhrase(output, phrase)
      )
    );
    return hits.length ? 0 : 1;
  })
  .generateReason(({ run }) => {
    const forbidden = run.groundTruth?.forbiddenClaims as string[] | undefined;
    if (!forbidden?.length) return "No forbidden claims configured";
    const output = normalizeText(extractText(run.output));
    const hits = forbidden.flatMap((claim) =>
      forbiddenClaimPhrases(claim).filter((phrase) =>
        hasAffirmativeForbiddenPhrase(output, phrase)
      )
    );
    return hits.length
      ? `Forbidden claim phrase(s): ${Array.from(new Set(hits)).join(", ")}`
      : "No forbidden payment/safety/legal claims";
  });

function responseShapePasses(shape: string, output: string): boolean {
  const head = output.slice(0, 700);
  const checks: Record<string, (text: string) => boolean> = {
    status_not_ready: (text) =>
      /not ready|do not pay|don't pay|hold payment|before deposit/.test(text),
    not_ready_status: (text) =>
      /not ready|hold|before deposit|do not pay|don't pay/.test(text),
    blocker_first: () => /block|critical|not ready|hold/.test(head),
    blocking_items_first: () =>
      /block|critical|not ready|needs confirmation|missing|hold/.test(head),
    owner_named: (text) =>
      /operator|buyer|supplier|broker|bank|forwarder|inspection|reviewer/.test(
        text
      ),
    operator_owner: (text) => /operator|buyer/.test(text),
    broker_owner: (text) => /broker/.test(text),
    forwarder_owner: (text) => /forwarder|carrier|shipping/.test(text),
    copyable_supplier_message: (text) =>
      /message to send|send this|please confirm|please send|ask the supplier/.test(
        text
      ),
    supplier_copy: (text) =>
      /message to supplier|supplier message|ask the supplier|please confirm|please send/.test(
        text
      ),
    broker_copy: (text) =>
      /broker.*(?:question|message)|ask the broker|broker.*confirm/.test(text),
    operator_copy: (text) =>
      /operator.*(?:question|message)|buyer.*(?:question|message)|define inspection|confirm before deposit/.test(
        text
      ),
    human_review_boundary: (text) =>
      /operator review|human review|human|review before|not legal advice/.test(
        text
      ),
    operator_boundary: (text) => /operator review|operator|human review/.test(text),
    payment_boundary: (text) =>
      /not payment approval|not ready to pay|do not pay|don't pay|before deposit/.test(
        text
      ),
    deposit_boundary: (text) =>
      /before deposit|not ready for deposit|deposit.*(?:hold|boundary|not)/.test(
        text
      ),
    evidence_grounded: (text) =>
      /evidence|docs reviewed|document shows|source|from the/.test(text),
    next_actions: (text) => /next action|next step|ask|get|upload|confirm/.test(text),
    confirmed_facts: (text) =>
      /confirmed from evidence|confirmed|evidence shows|the evidence shows/.test(
        text
      ),
    missing_evidence_list: (text) => /missing|not provided|need|needs/.test(text),
    single_next_supplier_message: (text) =>
      /message to supplier|supplier message|please send|please confirm/.test(text),
    entity_chain_gap: (text) =>
      /entity chain|seller|manufacturer|certificate holder|beneficiary/.test(text),
    broker_question: (text) => /broker.*(?:question|confirm|check|review)/.test(text),
    spec_lock_gap: (text) => /spec|sample|material|dimension|tolerance/.test(text),
    inspection_gap: (text) => /inspection|aql|defect|sample/.test(text),
    importer_responsibility_boundary: (text) =>
      /importer responsibility|importer.*responsible|operator review/.test(text),
    dangerous_goods_blocker: (text) =>
      /dangerous goods|lithium|un 38\.3|battery|block/.test(text),
    shipping_boundary: (text) =>
      /shipping|forwarder|dangerous goods|not safety certification/.test(text),
    label_gap: (text) => /label|labeling|marking|fiber|origin/.test(text),
    food_import_gap: (text) => /food|fda|prior notice|facility/.test(text),
    packaging_gap: (text) => /packaging|wood|ispm|pallet|crate/.test(text),
    forced_labor_trace_blocker: (text) =>
      /forced labor|uflpa|trace|supply chain|block/.test(text),
    terms_conflict: (text) => /terms conflict|conflict|incoterm|payment terms/.test(text),
    operator_cost_boundary: (text) =>
      /operator|buyer|landed cost|delivered price|freight|insurance|duty|fob|cost boundary|commercial cost/.test(
        text
      ),
    sample_gate: (text) => /sample|golden sample|approved sample/.test(text),
    inspection_terms: (text) => /inspection|aql|defect|reinspection/.test(text),
    origin_claim_gap: (text) => /origin|made in|country of origin|marking/.test(text),
    marketing_claim_boundary: (text) =>
      /marketing claim|claim|not legal advice|broker/.test(text),
    residual_checks: (text) => /residual|still check|remaining|broker|operator/.test(text),
    ready_for_operator_review_not_payment: (text) =>
      /ready for operator review/.test(text) && /not payment approval|not ready to pay/.test(text),
    no_false_blocker: (text) => !/blocker|not ready for deposit|do not pay|don't pay/.test(text),
    no_legal_advice: (text) => /not legal advice|broker|operator review/.test(text),
    no_compliance_guarantee: (text) =>
      /not.*(?:compliance|legal).*guarantee|not legal advice|operator review/.test(text),
    no_safety_guarantee: (text) =>
      /not.*safety.*(?:certification|guarantee)|forwarder|operator review/.test(text),
    no_fda_clearance_claim: (text) =>
      /not.*fda.*clearance|not customs clearance|broker/.test(text),
    no_customs_clearance_claim: (text) =>
      /not customs clearance|broker|operator review/.test(text),
    no_admissibility_ruling: (text) =>
      /not.*admissibility|not legal advice|broker/.test(text),
    no_financial_advice: (text) =>
      /not financial advice|operator review|commercial terms/.test(text),
    no_quality_guarantee: (text) =>
      /not.*quality.*guarantee|inspection|operator review/.test(text),
    no_supplier_judgment: (text) =>
      /not.*supplier.*(?:safe|judgment|verified)|operator review|evidence control/.test(
        text
      ),
    no_generic_doc_receipt: (text) =>
      !/received your document|analyzing now|send the remaining pages/.test(text),
  };
  return (checks[shape] || ((text) => text.includes(shape.replaceAll("_", " "))))(
    output
  );
}

// 7. Response Shape — Lucas must turn findings into operator-grade action.
export const responseShapeScorer = createScorer({
  id: "response-shape",
  description: "Checks required response shape markers from corpus ground truth",
})
  .generateScore(({ run }) => {
    const shapes = run.groundTruth?.requiredResponseShape as string[] | undefined;
    if (!shapes?.length) return 1;
    const output = normalizeText(extractText(run.output));
    const misses = shapes.filter((shape) => !responseShapePasses(shape, output));
    return misses.length ? Math.max(0, 1 - misses.length / shapes.length) : 1;
  })
  .generateReason(({ run }) => {
    const shapes = run.groundTruth?.requiredResponseShape as string[] | undefined;
    if (!shapes?.length) return "No response shape configured";
    const output = normalizeText(extractText(run.output));
    const misses = shapes.filter((shape) => !responseShapePasses(shape, output));
    return misses.length
      ? `Missing response shape marker(s): ${misses.join(", ")}`
      : "All required response shape markers present";
  });

// 8. Forbidden Regexes — pinned regression patterns from replay fixtures.
export const forbiddenRegexScorer = createScorer({
  id: "forbidden-regexes",
  description: "Checks replay fixtures do not hit known false-positive regexes",
})
  .generateScore(({ run }) => {
    const patterns = run.groundTruth?.forbiddenRegexes as string[] | undefined;
    if (!patterns?.length) return 1;
    const output = extractText(run.output);
    const hits = patterns.filter((pattern) => {
      try {
        return new RegExp(pattern).test(output);
      } catch {
        return false;
      }
    });
    return hits.length ? 0 : 1;
  })
  .generateReason(({ run }) => {
    const patterns = run.groundTruth?.forbiddenRegexes as string[] | undefined;
    if (!patterns?.length) return "No forbidden regexes configured";
    const output = extractText(run.output);
    const hits = patterns.filter((pattern) => {
      try {
        return new RegExp(pattern).test(output);
      } catch {
        return false;
      }
    });
    return hits.length
      ? `Forbidden replay regex(es) matched: ${hits.join(", ")}`
      : "No forbidden replay regexes matched";
  });

// ============================================================
// LLM-JUDGED SCORERS (Haiku as judge, ~$0.001/call)
// ============================================================

// Entity Grounding — Are all entity names in the output grounded in source docs?
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
