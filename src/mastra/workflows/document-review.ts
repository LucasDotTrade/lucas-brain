import { createWorkflow, createStep } from "@mastra/core/workflows";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { z } from "zod";
import { recordCase } from "../tools/learning/record-case";

const classifyStep = createStep({
  id: "classify",
  inputSchema: z.object({
    documentText: z.string(),
    clientEmail: z.string(),
    channel: z.enum(["email", "whatsapp"]),
  }),
  outputSchema: z.object({
    documentType: z.string(),
    documentText: z.string(),
    clientEmail: z.string(),
    channel: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Simple keyword classification
    const text = inputData.documentText.toLowerCase();
    let documentType = "unknown";
    if (text.includes("letter of credit") || text.includes("l/c")) documentType = "letter_of_credit";
    else if (text.includes("bill of lading") || text.includes("b/l")) documentType = "bill_of_lading";
    else if (text.includes("invoice")) documentType = "commercial_invoice";
    else if (text.includes("packing")) documentType = "packing_list";
    else if (text.includes("origin")) documentType = "certificate_of_origin";

    return { ...inputData, documentType };
  },
});

const analyzeStep = createStep({
  id: "analyze",
  inputSchema: z.object({
    documentType: z.string(),
    documentText: z.string(),
    clientEmail: z.string(),
    channel: z.string(),
  }),
  outputSchema: z.object({
    verdict: z.enum(["GO", "WAIT", "NO_GO"]),
    issues: z.array(z.object({
      type: z.string(),
      severity: z.enum(["minor", "major", "critical"]),
      description: z.string(),
    })),
    analysis: z.string(),
    clientEmail: z.string(),
    documentType: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const lucas = mastra?.getAgent("lucasAgent");
    if (!lucas) {
      throw new Error("Lucas agent not found");
    }

    // Generate a thread ID for this workflow run
    const threadId = `workflow-${Date.now()}-${inputData.clientEmail}`;

    const response = await lucas.generate(
      `Analyze this ${inputData.documentType}:\n\n${inputData.documentText}`,
      { resourceId: inputData.clientEmail, threadId }
    );

    // Parse verdict from response (simplified - in real use, use structured output)
    let verdict: "GO" | "WAIT" | "NO_GO" = "WAIT";
    if (response.text.includes("GO ✅") || response.text.includes("PROCEED")) verdict = "GO";
    if (response.text.includes("NO_GO") || response.text.includes("❌")) verdict = "NO_GO";

    return {
      verdict,
      issues: [], // Would extract from structured response
      analysis: response.text,
      clientEmail: inputData.clientEmail,
      documentType: inputData.documentType,
    };
  },
});

const recordCaseStep = createStep({
  id: "record-case",
  inputSchema: z.object({
    verdict: z.enum(["GO", "WAIT", "NO_GO"]),
    issues: z.array(z.object({
      type: z.string(),
      severity: z.enum(["minor", "major", "critical"]),
      description: z.string(),
    })),
    analysis: z.string(),
    clientEmail: z.string(),
    documentType: z.string(),
  }),
  outputSchema: z.object({
    caseId: z.string(),
    verdict: z.string(),
    analysis: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Use the recordCase tool
    const result = await recordCase.execute({
      context: {
        clientEmail: inputData.clientEmail,
        documentType: inputData.documentType,
        verdict: inputData.verdict,
        issues: inputData.issues,
        adviceSummary: inputData.analysis.substring(0, 500),
      },
      runtimeContext: new RuntimeContext(),
    });

    return {
      caseId: result.caseId || "unknown",
      verdict: inputData.verdict,
      analysis: inputData.analysis,
    };
  },
});

export const documentReviewWorkflow = createWorkflow({
  id: "document-review",
  inputSchema: z.object({
    documentText: z.string(),
    clientEmail: z.string(),
    channel: z.enum(["email", "whatsapp"]),
  }),
  outputSchema: z.object({
    caseId: z.string(),
    verdict: z.string(),
    analysis: z.string(),
  }),
})
  .then(classifyStep)
  .then(analyzeStep)
  .then(recordCaseStep)
  .commit();
