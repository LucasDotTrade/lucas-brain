import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const recordCase = createTool({
  id: "recordCase",
  description: "Record this document analysis to build institutional knowledge. Call after every analysis.",
  inputSchema: z.object({
    clientEmail: z.string().describe("Client identifier (email or phone)"),
    documentType: z.string().describe("Type: letter_of_credit, bill_of_lading, etc"),
    verdict: z.enum(["GO", "WAIT", "NO_GO"]),
    issues: z.array(z.object({
      type: z.string(),
      severity: z.enum(["critical", "major", "minor"]),
      description: z.string(),
    })).default([]),
    adviceSummary: z.string().describe("Brief summary of advice given"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    caseId: z.string().optional(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    // For now, just log - we'll connect to Supabase next
    console.log("📊 Recording case:", context);
    return {
      success: true,
      caseId: crypto.randomUUID(),
      message: `Case recorded for ${context.clientEmail}`,
    };
  },
});
