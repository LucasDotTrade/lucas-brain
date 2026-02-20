import { createScorer } from "@mastra/core/evals";
import {
  checkVerdictFormat,
  checkNoDateWords,
  checkNoSemicolonsOutsideCode,
  checkRequiredSections,
} from "../mastra/agents/output-validators";

const toText = (val: unknown): string =>
  typeof val === "string" ? val : JSON.stringify(val);

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
