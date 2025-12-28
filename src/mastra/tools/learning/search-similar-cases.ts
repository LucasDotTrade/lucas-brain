import { createTool } from "@mastra/core/tools";
import OpenAI from "openai";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);
const openai = new OpenAI();

export const searchSimilarCases = createTool({
  id: "searchSimilarCases",
  description: "Search past cases by semantic similarity. Use when you encounter an issue and want to find similar historical cases to inform your advice.",
  inputSchema: z.object({
    query: z.string().describe("Description of the issue or situation (e.g., 'beneficiary name mismatch on LC')"),
    limit: z.number().optional().default(3).describe("Number of similar cases to return"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    cases: z.array(z.object({
      id: z.string(),
      documentType: z.string(),
      verdict: z.string(),
      issues: z.any(),
      adviceSummary: z.string().nullable(),
      outcome: z.string().nullable(),
      similarity: z.number(),
    })),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      // Embed the query
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: context.query,
      });
      const embedding = embeddingResponse.data[0].embedding;

      // Search for similar cases
      const results = await sql`
        SELECT
          id,
          document_type,
          verdict::text as verdict,
          issues,
          advice_summary,
          outcome,
          1 - (embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
        FROM cases
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
        LIMIT ${context.limit || 3}
      `;

      if (results.length === 0) {
        return {
          success: true,
          cases: [],
          message: "No similar cases found yet. Keep recording cases to build the knowledge base.",
        };
      }

      return {
        success: true,
        cases: results.map(r => ({
          id: r.id,
          documentType: r.document_type,
          verdict: r.verdict,
          issues: r.issues,
          adviceSummary: r.advice_summary,
          outcome: r.outcome,
          similarity: parseFloat(r.similarity),
        })),
        message: `Found ${results.length} similar cases`,
      };
    } catch (err) {
      console.error("❌ searchSimilarCases error:", err);
      return {
        success: false,
        cases: [],
        message: `Error: ${String(err)}`,
      };
    }
  },
});
