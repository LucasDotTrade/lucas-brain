import { Agent } from "@mastra/core/agent";
import { runEvals } from "@mastra/core/evals";
import { instructionsTemplate } from "../mastra/agents/index";
import { seedItems } from "./seed-data";
import {
  verdictFormatScorer,
  noDateWordsScorer,
  noSemicolonsScorer,
  requiredSectionsScorer,
  verdictAccuracyScorer,
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

async function main() {
  console.log("=== Lucas Senior Reviewer Eval ===\n");
  console.log(`Running ${seedItems.length} test cases...\n`);

  const scorers = [
    verdictFormatScorer,
    noDateWordsScorer,
    noSemicolonsScorer,
    requiredSectionsScorer,
    verdictAccuracyScorer,
  ];

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
        const icon = score >= 1 ? "pass" : score > 0 ? "warn" : "FAIL";
        console.log(`  [${icon}] ${name}: ${score} — ${reason}`);
      }
    },
  });

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Total items: ${result.summary.totalItems}`);

  const allScores: number[] = [];
  for (const [, scorerData] of Object.entries(result.scores)) {
    const avg = (scorerData as any)?.average;
    if (typeof avg === "number") {
      allScores.push(avg);
      console.log(
        `  ${(scorerData as any)?.scorerName || "scorer"}: avg ${(avg * 100).toFixed(1)}%`
      );
    }
  }
  if (allScores.length > 0) {
    const overall =
      allScores.reduce((a, b) => a + b, 0) / allScores.length;
    console.log(`\n=== Overall: ${(overall * 100).toFixed(1)}% ===`);
  }
}

main().catch(console.error);
