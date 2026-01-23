import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const RAILWAY_API = process.env.RAILWAY_API || "https://lucas-core-production.up.railway.app";

export const extractDocument = createTool({
  id: "extractDocument",
  description: "Extract text from a document image or PDF. Returns raw text and basic field extraction. Call this when user sends a document.",
  inputSchema: z.object({
    url: z.string().describe("URL of the document to extract"),
  }),
  execute: async (inputData) => {
    try {
      const response = await fetch(`${RAILWAY_API}/extract-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputData.url }),
      });
      
      if (!response.ok) {
        return { success: false, error: `Extraction failed: ${response.status}` };
      }
      
      const data = await response.json();
      return {
        success: true,
        raw_text: data.raw_text,
        document_type: data.document_type,
        fields: data.fields,
        readability_score: data.readability_score
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const validateDocuments = createTool({
  id: "validateDocuments",
  description: "Cross-validate all stored documents for a user. Compares B/L against LC requirements, checks dates, ports, amounts. Call when user wants to validate/compare their documents.",
  inputSchema: z.object({
    phone: z.string().describe("User phone number to retrieve their documents"),
  }),
  execute: async (inputData) => {
    try {
      const cleanPhone = inputData.phone.replace("whatsapp:", "").replace("+", "");
      
      const response = await fetch(`${RAILWAY_API}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone }),
      });
      
      if (!response.ok) {
        return { success: false, error: `Validation failed: ${response.status}` };
      }
      
      return await response.json();
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const searchPastCases = createTool({
  id: "searchPastCases",
  description: "Search past document analyses for similar issues or patterns. Use when you encounter a compliance issue and want historical context.",
  inputSchema: z.object({
    query: z.string().describe("Search term - issue type or keyword (e.g., 'beneficiary mismatch', 'port typo', 'amount')"),
    outcome: z.string().optional().describe("Filter: 'accepted', 'rejected', or 'pending'"),
    limit: z.number().optional().default(5).describe("Max results"),
  }),
  execute: async (inputData) => {
    try {
      const params = new URLSearchParams({ q: inputData.query });
      if (inputData.outcome) params.append("outcome", inputData.outcome);
      if (inputData.limit) params.append("limit", inputData.limit.toString());
      
      const response = await fetch(`${RAILWAY_API}/traces/search?${params}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        return { success: false, error: `Search failed: ${response.status}` };
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const getCustomerHistory = createTool({
  id: "getCustomerHistory",
  description: "Get a customer's past document submissions and outcomes. Use to personalize response based on their experience level and past issues.",
  inputSchema: z.object({
    userId: z.string().describe("Phone number or email of the customer"),
  }),
  execute: async (inputData) => {
    try {
      const cleanUserId = inputData.userId.replace("whatsapp:", "").replace("+", "");
      
      const response = await fetch(`${RAILWAY_API}/traces/customer/${encodeURIComponent(cleanUserId)}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        return { success: false, error: `Lookup failed: ${response.status}` };
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const getIssuePatterns = createTool({
  id: "getIssuePatterns",
  description: "Get aggregate patterns about issue types and their rejection rates. Use to cite statistics and calibrate risk warnings.",
  inputSchema: z.object({
    days: z.number().optional().default(30).describe("Time window in days"),
  }),
  execute: async (inputData) => {
    try {
      const days = inputData.days || 30;
      const response = await fetch(`${RAILWAY_API}/traces/patterns?days=${days}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        return { success: false, error: `Pattern lookup failed: ${response.status}` };
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const findSimilarCases = createTool({
  id: "findSimilarCases",
  description: "Find past cases similar to a specific trace. Use after analyzing a document to find historical evidence for your recommendations.",
  inputSchema: z.object({
    traceId: z.string().describe("UUID of the trace to find similar cases for"),
  }),
  execute: async (inputData) => {
    try {
      const response = await fetch(`${RAILWAY_API}/traces/similar/${inputData.traceId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        return { success: false, error: `Similar cases lookup failed: ${response.status}` };
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const getOutcomeStats = createTool({
  id: "getOutcomeStats",
  description: "Query rejection patterns and outcome statistics from past document analyses. Use this to back up advice with real data.",
  inputSchema: z.object({
    documentType: z.string().optional().describe("Filter by document type: lc, bl, invoice, etc."),
    userPhone: z.string().optional().describe("Filter by specific user's history"),
  }),
  execute: async (inputData) => {
    try {
      const cleanPhone = inputData.userPhone?.replace("whatsapp:", "").replace("+", "");

      const params = new URLSearchParams();
      if (inputData.documentType) params.append("document_type", inputData.documentType);
      if (cleanPhone) params.append("user_phone", cleanPhone);

      const response = await fetch(`${RAILWAY_API}/traces/stats?${params}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        return { success: false, error: `Stats lookup failed: ${response.status}` };
      }
      
      const data = await response.json();
      return {
        success: true,
        totalAnalyzed: data.total_analyzed || data.total || 0,
        outcomes: {
          accepted: data.outcomes?.accepted || 0,
          rejected: data.outcomes?.rejected || 0,
          amended: data.outcomes?.amended || 0,
          pending: data.outcomes?.pending || 0,
        },
        topRejectionReasons: data.top_rejection_reasons || data.topRejectionReasons || [],
        acceptanceRate: data.acceptance_rate || data.acceptanceRate || 0,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

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
// recordOutcome removed - now handled by Python feedback_loop.py for instant pattern learning
export { searchSimilarCases } from "./learning/search-similar-cases";
export { getClientInsights } from "./learning/get-client-insights";
export { updateClientProfile } from "./learning/update-client-profile";
