import { Agent } from "@mastra/core/agent";
import { runEvals } from "@mastra/core/evals";
import type { MastraScorer } from "@mastra/core/evals";
import { instructionsTemplate } from "../mastra/agents/index";
import { seedItems } from "./seed-data";
import {
  verdictFormatScorer,
  noDateWordsScorer,
  noSemicolonsScorer,
  requiredSectionsScorer,
  verdictAccuracyScorer,
  entityGroundingScorer,
  findingFaithfulnessScorer,
  promptAlignmentScorer,
} from "./scorers";

// Lightweight agent for eval — same instructions + model, no memory/storage
const now = new Date();
const today = `${now.getDate()} ${now.toLocaleString("en-US", { month: "long" })} ${now.getFullYear()}`;

const evalAgent = new Agent({
  id: "lucas-eval",
  name: "Lucas (eval)",
  instructions: instructionsTemplate.replace("__DATE_PLACEHOLDER__", today),
  model: process.env.MODEL || "anthropic/claude-sonnet-4-20250514",
});

const quickMode = process.argv.includes("--quick");

const deterministicScorers: MastraScorer[] = [
  verdictFormatScorer,
  noDateWordsScorer,
  noSemicolonsScorer,
  requiredSectionsScorer,
  verdictAccuracyScorer,
];

const llmScorers: MastraScorer[] = [
  entityGroundingScorer,
  findingFaithfulnessScorer,
  promptAlignmentScorer,
];

async function main() {
  const scorers = quickMode
    ? deterministicScorers
    : [...deterministicScorers, ...llmScorers];

  console.log("=== Lucas Senior Reviewer Eval ===\n");
  console.log(
    `Mode: ${quickMode ? "quick (deterministic only)" : "full (deterministic + LLM-judged)"}`
  );
  console.log(
    `Running ${seedItems.length} test cases × ${scorers.length} scorers...\n`
  );

  // Accumulate per-scorer scores for summary
  const scorerTotals: Record<string, { sum: number; count: number }> = {};

  const result = await runEvals({
    data: seedItems,
    scorers,
    target: evalAgent,
    concurrency: 2,
    onItemComplete: ({ item, scorerResults }) => {
      const scenario =
        (item as any).groundTruth?.scenario || "unknown";
      console.log(`\n--- ${scenario} ---`);
      for (const [name, res] of Object.entries(scorerResults)) {
        const score = (res as any)?.score ?? "?";
        const reason = (res as any)?.reason ?? "";
        const icon =
          score >= 0.9 ? "pass" : score >= 0.5 ? "warn" : "FAIL";
        console.log(`  [${icon}] ${name}: ${score} — ${reason}`);
        if (typeof score === "number") {
          if (!scorerTotals[name]) scorerTotals[name] = { sum: 0, count: 0 };
          scorerTotals[name].sum += score;
          scorerTotals[name].count += 1;
        }
      }
    },
  });

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Total items: ${result.summary.totalItems}`);

  const allAvgs: number[] = [];
  for (const [name, { sum, count }] of Object.entries(scorerTotals)) {
    const avg = sum / count;
    allAvgs.push(avg);
    console.log(`  ${name}: avg ${(avg * 100).toFixed(1)}%`);
  }
  if (allAvgs.length > 0) {
    const overall = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
    console.log(`\n=== Overall: ${(overall * 100).toFixed(1)}% ===`);
  }
}

main().catch(console.error);
