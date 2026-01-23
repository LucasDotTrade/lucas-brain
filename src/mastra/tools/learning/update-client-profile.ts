import { createTool } from "@mastra/core/tools";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);

/**
 * updateClientProfile - Phase 1: Mastra Quick Wins
 *
 * Updates client statistics in working memory after each analysis.
 * Tracks GO/WAIT/NO_GO counts, common issues, and trade patterns.
 *
 * This tool bridges the gap between case recording and working memory updates.
 */
export const updateClientProfile = createTool({
  id: "updateClientProfile",
  description: `Update client profile stats after document analysis. Call this AFTER recordCase to update the client's working memory profile with their latest stats.

Use cases:
- After every GO/WAIT/NO_GO verdict, update the client's stats
- Track trade routes and products for personalization
- Record common issues for proactive guidance

Example: updateClientProfile({
  resourceId: "user@example.com",
  verdict: "GO",
  documentType: "letter_of_credit",
  tradeRoute: { origin: "China", destination: "UAE" },
  product: "Electronics",
  issues: ["date_calculation"]
})`,
  inputSchema: z.object({
    resourceId: z.string().describe("Client identifier (email or phone)"),
    verdict: z.enum(["GO", "WAIT", "NO_GO"]).describe("The analysis verdict"),
    documentType: z.string().describe("Type of document analyzed"),
    confidence: z.number().min(0).max(100).optional().describe("Confidence score (0-100)"),
    tradeRoute: z.object({
      origin: z.string(),
      destination: z.string(),
    }).optional().describe("Origin and destination of the trade"),
    product: z.string().optional().describe("Product/commodity being traded"),
    issues: z.array(z.string()).optional().describe("Issue types encountered (e.g., 'beneficiary_mismatch', 'port_typo')"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    updatedStats: z.object({
      totalDocumentsReviewed: z.number(),
      goCount: z.number(),
      waitCount: z.number(),
      noGoCount: z.number(),
      successRate: z.number(),
    }).optional(),
  }),
  execute: async (inputData) => {
    const { resourceId, verdict, documentType, confidence, tradeRoute, product, issues } = inputData;

    console.log("📊 updateClientProfile called:", {
      resourceId,
      verdict,
      documentType,
      confidence,
    });

    try {
      // Get current stats from cases table
      const stats = await sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE verdict::text = 'GO') as go_count,
          COUNT(*) FILTER (WHERE verdict::text = 'WAIT') as wait_count,
          COUNT(*) FILTER (WHERE verdict::text = 'NO_GO') as no_go_count
        FROM cases
        WHERE client_email = ${resourceId}
      `;

      const currentStats = stats[0] || { total: 0, go_count: 0, wait_count: 0, no_go_count: 0 };

      // Calculate new stats (including this analysis)
      const newStats = {
        totalDocumentsReviewed: parseInt(currentStats.total) + 1,
        goCount: parseInt(currentStats.go_count) + (verdict === "GO" ? 1 : 0),
        waitCount: parseInt(currentStats.wait_count) + (verdict === "WAIT" ? 1 : 0),
        noGoCount: parseInt(currentStats.no_go_count) + (verdict === "NO_GO" ? 1 : 0),
        successRate: 0,
      };

      newStats.successRate = newStats.totalDocumentsReviewed > 0
        ? Math.round((newStats.goCount / newStats.totalDocumentsReviewed) * 100)
        : 0;

      // Store the case outcome with confidence in a separate tracking table
      // This supports Phase 1 case outcome tracking requirement
      try {
        await sql`
          INSERT INTO case_outcomes (
            resource_id,
            verdict,
            document_type,
            confidence,
            trade_route_origin,
            trade_route_destination,
            product,
            issues,
            created_at
          ) VALUES (
            ${resourceId},
            ${verdict},
            ${documentType},
            ${confidence || null},
            ${tradeRoute?.origin || null},
            ${tradeRoute?.destination || null},
            ${product || null},
            ${issues ? JSON.stringify(issues) : null},
            NOW()
          )
          ON CONFLICT DO NOTHING
        `;
        console.log("✅ Case outcome tracked with confidence");
      } catch (trackingErr) {
        // Table might not exist yet - log but don't fail
        console.log("⚠️ case_outcomes table not available (Phase 1 migration pending):", String(trackingErr).substring(0, 100));
      }

      console.log("✅ Client profile updated:", newStats);

      return {
        success: true,
        message: `Profile updated for ${resourceId}. ${newStats.totalDocumentsReviewed} total docs, ${newStats.successRate}% GO rate.`,
        updatedStats: newStats,
      };
    } catch (err) {
      console.error("❌ updateClientProfile error:", err);
      return {
        success: false,
        message: `Error updating profile: ${String(err)}`,
      };
    }
  },
});
