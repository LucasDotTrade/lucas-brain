import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const RAILWAY_API = "https://lucas-core-production.up.railway.app";

export const extractDocument = createTool({
  id: "extractDocument",
  description: "Extract text from a document image or PDF. Returns raw text and basic field extraction. Call this when user sends a document.",
  inputSchema: z.object({
    url: z.string().describe("URL of the document to extract"),
  }),
  execute: async ({ context }) => {
    try {
      const response = await fetch(`${RAILWAY_API}/extract-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: context.url }),
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
  execute: async ({ context }) => {
    try {
      const cleanPhone = context.phone.replace("whatsapp:", "").replace("+", "");
      
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

export const analyzeDocument = createTool({
  id: "analyzeDocument",
  description: "Get detailed compliance analysis of a document. Only use if you need deeper analysis beyond what you can determine from the raw text.",
  inputSchema: z.object({
    text: z.string().describe("Document text to analyze"),
    document_type: z.string().describe("Type: letter_of_credit, bill_of_lading, commercial_invoice, packing_list, certificate_of_origin"),
  }),
  execute: async ({ context }) => {
    try {
      const response = await fetch(`${RAILWAY_API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: context.text, document_type: context.document_type }),
      });
      
      if (!response.ok) {
        return { success: false, error: `Analysis failed: ${response.status}` };
      }
      
      return await response.json();
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const searchSimilarCases = createTool({
  id: "searchSimilarCases",
  description: "Search past decision traces for similar cases. Use this to find patterns - what happened when we saw similar issues before? What was the bank outcome?",
  inputSchema: z.object({
    document_type: z.string().optional().describe("Filter by document type: letter_of_credit, bill_of_lading, etc."),
    issue_code: z.string().optional().describe("Filter by issue type: PORT_TYPO, MISSING_SHIPPED_ON_BOARD_DATE, LC_EXPIRED, etc."),
    recommendation: z.string().optional().describe("Filter by Lucas recommendation: reject, review, approve"),
    limit: z.number().default(10).describe("Max results to return"),
  }),
  execute: async ({ context }) => {
    try {
      const response = await fetch(`${RAILWAY_API}/traces/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: context.document_type,
          issue_code: context.issue_code,
          recommendation: context.recommendation,
          limit: context.limit || 10,
        }),
      });
      
      if (!response.ok) {
        return { success: false, error: `Search failed: ${response.status}` };
      }
      
      const data = await response.json();
      return {
        success: true,
        total_matches: data.total,
        cases: data.cases,
        patterns: data.patterns,
        summary: data.summary
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const getCustomerHistory = createTool({
  id: "getCustomerHistory",
  description: "Get analysis history for a specific customer/phone. Shows past documents, issues found, patterns.",
  inputSchema: z.object({
    phone: z.string().describe("Customer phone number"),
    limit: z.number().default(20).describe("Max past analyses to return"),
  }),
  execute: async ({ context }) => {
    try {
      const cleanPhone = context.phone.replace("whatsapp:", "").replace("+", "");
      
      const response = await fetch(`${RAILWAY_API}/traces/customer/${cleanPhone}?limit=${context.limit || 20}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        return { success: false, error: `Lookup failed: ${response.status}` };
      }
      
      const data = await response.json();
      return {
        success: true,
        total_analyses: data.total,
        recent_analyses: data.analyses,
        common_issues: data.common_issues,
        summary: data.summary
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const getIssuePatterns = createTool({
  id: "getIssuePatterns",
  description: "Get patterns for a specific issue type. Shows how often it leads to rejection, common fixes, bank-specific behavior.",
  inputSchema: z.object({
    issue_code: z.string().describe("Issue code: PORT_TYPO, MISSING_SHIPPED_ON_BOARD_DATE, AMOUNT_MISMATCH, etc."),
  }),
  execute: async ({ context }) => {
    try {
      const response = await fetch(`${RAILWAY_API}/traces/patterns/${context.issue_code}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        return { success: false, error: `Pattern lookup failed: ${response.status}` };
      }
      
      const data = await response.json();
      return {
        success: true,
        issue_code: context.issue_code,
        total_occurrences: data.total,
        rejection_rate: data.rejection_rate,
        avg_resolution_days: data.avg_resolution_days,
        common_fixes: data.common_fixes,
        bank_specific: data.bank_patterns
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});
