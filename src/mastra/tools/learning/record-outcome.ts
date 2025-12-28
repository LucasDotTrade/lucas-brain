import { createTool } from "@mastra/core/tools";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);

export const recordOutcome = createTool({
  id: "recordOutcome",
  description: "Record the actual bank outcome for a case. Call when user reports what happened with their document.",
  inputSchema: z.object({
    caseId: z.string().optional().describe("UUID of the case if known"),
    clientEmail: z.string().describe("Client identifier to find recent case"),
    outcome: z.enum(["accepted", "rejected", "amended"]),
    bankFeedback: z.string().optional().describe("What the bank said"),
    lessonLearned: z.string().optional().describe("Key insight from this outcome"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      // Find the most recent case for this client if no caseId provided
      let targetCaseId = context.caseId;

      if (!targetCaseId) {
        const [recentCase] = await sql`
          select id from cases
          where client_email = ${context.clientEmail}
          order by created_at desc
          limit 1
        `;

        if (!recentCase) {
          return {
            success: false,
            message: `No recent case found for ${context.clientEmail}`,
          };
        }
        targetCaseId = recentCase.id;
      }

      await sql`
        update cases set
          outcome = ${context.outcome},
          bank_feedback = ${context.bankFeedback || null},
          lesson_learned = ${context.lessonLearned || null},
          outcome_recorded_at = now()
        where id = ${targetCaseId!}
      `;

      return {
        success: true,
        message: `Outcome recorded: ${context.outcome}. This helps everyone learn.`,
      };
    } catch (err) {
      console.error("❌ recordOutcome error:", err);
      return {
        success: false,
        message: `Error: ${String(err)}`,
      };
    }
  },
});
