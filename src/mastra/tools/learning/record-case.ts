import { createTool } from "@mastra/core/tools";
import OpenAI from "openai";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);
const openai = new OpenAI();

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
    console.log("📊 recordCase called:", {
      clientEmail: context.clientEmail,
      documentType: context.documentType,
      verdict: context.verdict,
      issuesCount: context.issues.length,
    });

    try {
      // Create text for embedding: combine issues and advice
      const issuesText = context.issues
        .map(i => `${i.type}: ${i.description}`)
        .join(". ");
      const embeddingText = `${context.documentType}. ${issuesText}. ${context.adviceSummary}`;

      // Try to generate embedding, but don't fail if it doesn't work
      let embedding: number[] | null = null;
      try {
        console.log("🔍 Generating embedding for:", embeddingText.substring(0, 100) + "...");
        const embeddingResponse = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: embeddingText,
        });
        embedding = embeddingResponse.data[0].embedding;
        console.log("✅ Embedding generated:", embedding.length, "dimensions");
      } catch (embeddingErr) {
        console.error("⚠️ Embedding failed (will insert without):", embeddingErr);
        // Continue without embedding
      }

      // Insert with or without embedding
      const [row] = embedding
        ? await sql`
            INSERT INTO cases (client_email, document_type, verdict, issues, advice_summary, embedding)
            VALUES (
              ${context.clientEmail},
              ${context.documentType},
              ${context.verdict},
              ${JSON.stringify(context.issues)},
              ${context.adviceSummary},
              ${JSON.stringify(embedding)}::vector
            )
            RETURNING id
          `
        : await sql`
            INSERT INTO cases (client_email, document_type, verdict, issues, advice_summary)
            VALUES (
              ${context.clientEmail},
              ${context.documentType},
              ${context.verdict},
              ${JSON.stringify(context.issues)},
              ${context.adviceSummary}
            )
            RETURNING id
          `;

      console.log("✅ Case recorded:", row.id, embedding ? "(with embedding)" : "(without embedding)");

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
