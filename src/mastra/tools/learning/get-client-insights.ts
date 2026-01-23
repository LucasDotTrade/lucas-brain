import { createTool } from "@mastra/core/tools";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);

export const getClientInsights = createTool({
  id: "getClientInsights",
  description: "Get insights about a client's document history and success rate. Use when a client has history with you.",
  inputSchema: z.object({
    clientEmail: z.string().describe("Client identifier (email or phone)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    hasHistory: z.boolean(),
    insights: z.object({
      totalDocuments: z.number(),
      verdicts: z.object({
        GO: z.number(),
        WAIT: z.number(),
        NO_GO: z.number(),
      }),
      successRate: z.number(),
      commonIssues: z.array(z.object({
        type: z.string(),
        count: z.number(),
      })),
      outcomes: z.object({
        accepted: z.number(),
        rejected: z.number(),
        amended: z.number(),
        pending: z.number(),
      }),
      firstSeen: z.string().nullable(),
      lastSeen: z.string().nullable(),
    }).optional(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    try {
      // Get verdict counts
      const verdictCounts = await sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE verdict::text = 'GO') as go_count,
          COUNT(*) FILTER (WHERE verdict::text = 'WAIT') as wait_count,
          COUNT(*) FILTER (WHERE verdict::text = 'NO_GO') as no_go_count,
          COUNT(*) FILTER (WHERE outcome = 'accepted') as accepted,
          COUNT(*) FILTER (WHERE outcome = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE outcome = 'amended') as amended,
          COUNT(*) FILTER (WHERE outcome IS NULL) as pending,
          MIN(created_at) as first_seen,
          MAX(created_at) as last_seen
        FROM cases
        WHERE client_email = ${inputData.clientEmail}
      `;

      const stats = verdictCounts[0];
      const total = parseInt(stats.total);

      if (total === 0) {
        return {
          success: true,
          hasHistory: false,
          message: `No history found for ${inputData.clientEmail}`,
        };
      }

      // Get common issues
      const issueQuery = await sql`
        SELECT issues FROM cases
        WHERE client_email = ${inputData.clientEmail}
        AND issues IS NOT NULL
      `;

      // Count issue types
      const issueCounts: Record<string, number> = {};
      for (const row of issueQuery) {
        let issues = row.issues;
        if (typeof issues === 'string') {
          try {
            issues = JSON.parse(issues);
          } catch {
            continue;
          }
        }
        if (Array.isArray(issues)) {
          for (const issue of issues) {
            if (issue.type) {
              issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
            }
          }
        }
      }

      // Sort and get top 3
      const commonIssues = Object.entries(issueCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => ({ type, count }));

      const goCount = parseInt(stats.go_count);
      const successRate = total > 0 ? Math.round((goCount / total) * 100) : 0;

      return {
        success: true,
        hasHistory: true,
        insights: {
          totalDocuments: total,
          verdicts: {
            GO: goCount,
            WAIT: parseInt(stats.wait_count),
            NO_GO: parseInt(stats.no_go_count),
          },
          successRate,
          commonIssues,
          outcomes: {
            accepted: parseInt(stats.accepted),
            rejected: parseInt(stats.rejected),
            amended: parseInt(stats.amended),
            pending: parseInt(stats.pending),
          },
          firstSeen: stats.first_seen?.toISOString() || null,
          lastSeen: stats.last_seen?.toISOString() || null,
        },
        message: `${total} documents analyzed, ${successRate}% success rate`,
      };
    } catch (err) {
      console.error("❌ getClientInsights error:", err);
      return {
        success: false,
        hasHistory: false,
        message: `Error: ${String(err)}`,
      };
    }
  },
});
