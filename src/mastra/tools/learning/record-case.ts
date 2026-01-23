import { createTool } from "@mastra/core/tools";
import OpenAI from "openai";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);
// Lazy init to avoid module-load errors when env vars aren't ready
let _openai: OpenAI | null = null;
const getOpenAI = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

export const recordCase = createTool({
  id: "recordCase",
  description: "Record this document analysis to build institutional knowledge. Call after every analysis. Include confidence score (0-100) based on document clarity and extraction certainty.",
  inputSchema: z.object({
    clientEmail: z.string().describe("Client identifier (email or phone)"),
    documentType: z.string().describe("Type: letter_of_credit, bill_of_lading, etc"),
    verdict: z.enum(["GO", "WAIT", "NO_GO"]),
    confidence: z.number().min(0).max(100).optional().describe("Confidence score 0-100. High (90+) = clear docs, all fields extracted. Medium (70-89) = some uncertainty. Low (<70) = poor OCR or missing info."),
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
  execute: async (inputData) => {
    const issues = inputData.issues ?? [];
    console.log("📊 recordCase called:", {
      clientEmail: inputData.clientEmail,
      documentType: inputData.documentType,
      verdict: inputData.verdict,
      confidence: inputData.confidence,
      issuesCount: issues.length,
    });

    try {
      // Create text for embedding: combine issues and advice
      const issuesText = issues
        .map(i => `${i.type}: ${i.description}`)
        .join(". ");
      const embeddingText = `${inputData.documentType}. ${issuesText}. ${inputData.adviceSummary}`;

      // Try to generate embedding, but don't fail if it doesn't work
      let embedding: number[] | null = null;
      try {
        console.log("🔍 Generating embedding for:", embeddingText.substring(0, 100) + "...");
        const embeddingResponse = await getOpenAI().embeddings.create({
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
      // Phase 1: Also store confidence score for case outcome tracking
      const confidenceValue = inputData.confidence ?? null;

      const [row] = embedding
        ? await sql`
            INSERT INTO cases (client_email, document_type, verdict, issues, advice_summary, embedding, confidence)
            VALUES (
              ${inputData.clientEmail},
              ${inputData.documentType},
              ${inputData.verdict},
              ${JSON.stringify(issues)},
              ${inputData.adviceSummary},
              ${JSON.stringify(embedding)}::vector,
              ${confidenceValue}
            )
            RETURNING id
          `
        : await sql`
            INSERT INTO cases (client_email, document_type, verdict, issues, advice_summary, confidence)
            VALUES (
              ${inputData.clientEmail},
              ${inputData.documentType},
              ${inputData.verdict},
              ${JSON.stringify(issues)},
              ${inputData.adviceSummary},
              ${confidenceValue}
            )
            RETURNING id
          `;

      console.log("✅ Case recorded:", row.id, embedding ? "(with embedding)" : "(without embedding)");

      return {
        success: true,
        caseId: row.id,
        message: `Case recorded for ${inputData.clientEmail}`,
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
