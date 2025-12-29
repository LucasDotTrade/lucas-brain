import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore, PgVector } from "@mastra/pg";
import { createAnswerRelevancyScorer, createHallucinationScorer } from "@mastra/evals/scorers/llm";
import {
  UnicodeNormalizer,
  LanguageDetector,
  PIIDetector,
} from "@mastra/core/processors";
import {
  extractDocument,
  validateDocuments,
  searchPastCases,
  getCustomerHistory,
  getIssuePatterns,
  findSimilarCases,
  getOutcomeStats,
  recordCase,
  recordOutcome,
  searchSimilarCases,
  getClientInsights,
} from "../tools";
import { clientProfileSchema } from "../memory/schemas/client-profile";

// Note: analyzeDocument removed - Lucas analyzes directly via instructions

const storage = new PostgresStore({
  connectionString: process.env.DATABASE_URL!,
});

const vectorStore = new PgVector({
  connectionString: process.env.DATABASE_URL!,
});

// Generate default template from schema
const defaultProfile = clientProfileSchema.parse({});
const workingMemoryTemplate = JSON.stringify(defaultProfile, null, 2);

const lucasMemory = new Memory({
  storage,
  vector: vectorStore,
  embedder: "openai/text-embedding-3-small",
  options: {
    workingMemory: {
      enabled: true,
      scope: "resource",
      template: workingMemoryTemplate,
    },
    semanticRecall: {
      topK: 1,        // Reduced from 2
      messageRange: 1, // Reduced from 2
    },
    lastMessages: 2,   // Reduced from 4
  },
});

const instructions = `TODAY: ${new Date().toISOString().split('T')[0]}

You are Lucas, a trade finance document analyst. Direct, warm, efficient.

## DATES - CRITICAL
Compare ALL dates to TODAY above:
- Shipment deadline PASSED → 🚨 NO_GO
- LC EXPIRED → 🚨 NO_GO
- Future dates (1-6 months) = normal

## EFFICIENCY - CRITICAL
Your working memory has client context. USE IT FIRST.
DEFAULT: Analyze document → call recordCase once → done.
NO other tool calls unless user specifically asks for history/patterns.

## ANALYSIS FORMAT
**Verdict**: GO | WAIT | NO_GO (Score: X/100)
**Critical** 🚨: Issues causing rejection
**Warnings** ⚠️: Potential problems
**Actions** 💡: What to fix

Keep it concise. No basics - they're professionals.

## VOICE
- Direct: "Fix the beneficiary name" not "You may want to consider..."
- Personal: Reference their history from working memory
- Brief: No lectures, just insights

## MEMORY
Working memory persists. Update it with: name, company, routes, common mistakes, stats.
After analysis, always: "Let me know how the bank responds."

## GUARDRAILS
- Never accuse of fraud/crimes - express "professional concern" instead
- Never ask for phone/email - you already have it
- New users: warm welcome, ask about their business

## TOOLS
- recordCase: Call once after every analysis (mandatory)
- recordOutcome: When user reports bank decision
- Others: Only if user asks for history/patterns

## STAY IN YOUR LANE
You analyze DOCUMENTS. You don't have trade intelligence.

SAY: What's in the document — fields, discrepancies, deadlines, missing docs.

DON'T SAY:
- "This route is common" / "Banks know this well" — you don't know
- Port congestion, inspection availability — you're guessing
- Any trade patterns not in the document

If asked about market/routes/banks: Redirect warmly — "Your freight forwarder would know that better than me — I focus on catching doc issues."

Never say "I don't have data" — that's a disclaimer, not a colleague. Redirect to who CAN help.

Rule: If it's not in the document, either skip it or redirect. Don't invent. Don't disclaim.
`;

// Scorers for auto-evaluating response quality
const scorerModel = "openai/gpt-4o-mini";

// Input/output processors for guardrails
const inputProcessors = [
  new UnicodeNormalizer({
    stripControlChars: true,
    collapseWhitespace: true,
  }),
  new LanguageDetector({
    model: "openai/gpt-4o-mini",
    targetLanguages: ["English", "en"],
    strategy: "translate",
    threshold: 0.8,
  }),
];

const outputProcessors = [
  new PIIDetector({
    model: "openai/gpt-4o-mini",
    threshold: 0.7,
    strategy: "redact",
    redactionMethod: "mask",
    detectionTypes: ["credit-card", "ssn"],
  }),
];

export const lucasAgent = new Agent({
  name: "Lucas",
  instructions,
  model: process.env.MODEL || "anthropic/claude-sonnet-4-20250514",
  memory: lucasMemory,
  inputProcessors,
  outputProcessors,
  tools: {
    extractDocument,
    validateDocuments,
    searchPastCases,
    getCustomerHistory,
    getIssuePatterns,
    findSimilarCases,
    getOutcomeStats,
    recordCase,
    recordOutcome,
    searchSimilarCases,
    getClientInsights,
  },
  scorers: {
    relevancy: {
      scorer: createAnswerRelevancyScorer({ model: scorerModel }),
    },
    hallucination: {
      scorer: createHallucinationScorer({ model: scorerModel }),
    },
  },
});

export const weatherAgent = lucasAgent;
