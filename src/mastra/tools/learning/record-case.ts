import { createTool } from "@mastra/core/tools";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);

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
    try {
      const [row] = await sql`
        insert into cases (client_email, document_type, verdict, issues, advice_summary)
        values (
          ${context.clientEmail},
          ${context.documentType},
          ${context.verdict},
          ${JSON.stringify(context.issues)},
          ${context.adviceSummary}
        )
        returning id
      `;

      return {
        success: true,
        caseId: row.id,
        message: `Case recorded for ${context.clientEmail}`,
      };
    } catch (err) {
      console.error("❌ recordCase error:", err);
      return {
        success: false,
        message: `Error: ${String(err)}`,
      };
    }
  },
});
