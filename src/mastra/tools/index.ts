import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// ============================================================
// MATH VERIFICATION TOOL - LLMs can't do arithmetic reliably
// ============================================================
export const verifyMath = createTool({
  id: "verifyMath",
  description: `ALWAYS use this tool to verify any math in documents. LLMs cannot reliably add numbers.
Use cases:
- Ullage reports: Sum tank quantities, compare to printed total
- Invoices: Verify quantity × unit price = total
- Weight certificates: Sum individual weights vs total
- Any list of numbers that should add up to a total

Example: verifyMath({ numbers: [11287.40, 10007.00, 9450.50], printedTotal: 30744.90, context: "ullage tank volumes" })`,
  inputSchema: z.object({
    numbers: z.array(z.number()).describe("List of numbers to sum"),
    printedTotal: z.number().describe("The total printed in the document"),
    context: z.string().optional().describe("What we're checking (e.g., 'tank volumes', 'invoice line items')"),
  }),
  execute: async (inputData) => {
    const { numbers, printedTotal, context: mathContext } = inputData;

    // Precise arithmetic (avoid floating point errors)
    const actualSum = numbers.reduce((a, b) => a + b, 0);
    const roundedSum = Math.round(actualSum * 100) / 100;
    const roundedPrinted = Math.round(printedTotal * 100) / 100;
    const difference = Math.round((roundedSum - roundedPrinted) * 100) / 100;
    const percentDiff = printedTotal !== 0 ? Math.abs(difference / printedTotal * 100) : 0;

    const match = Math.abs(difference) < 0.01;
    const withinTolerance = percentDiff <= 0.5; // 0.5% tolerance for measurement variance

    return {
      success: true,
      match,
      withinTolerance,
      actualSum: roundedSum,
      printedTotal: roundedPrinted,
      difference,
      percentDifference: Math.round(percentDiff * 100) / 100,
      context: mathContext || "unspecified",
      verdict: match
        ? "✅ EXACT MATCH"
        : withinTolerance
          ? `⚠️ MINOR VARIANCE (${percentDiff.toFixed(2)}% - within 0.5% tolerance)`
          : `❌ MATH ERROR: Difference of ${difference.toLocaleString()} (${percentDiff.toFixed(2)}%)`,
      recommendation: match
        ? "Totals verified correct."
        : withinTolerance
          ? "Small variance acceptable for physical measurements."
          : `CRITICAL: Document shows ${printedTotal.toLocaleString()} but actual sum is ${roundedSum.toLocaleString()}. Flag as discrepancy.`
    };
  },
});

export { recordCase } from "./learning/record-case";
export { searchSimilarCases } from "./learning/search-similar-cases";
export { updateClientProfile } from "./learning/update-client-profile";
