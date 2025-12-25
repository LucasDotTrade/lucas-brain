import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const RAILWAY_API = "https://lucas-core-production.up.railway.app";

export const extractDocument = createTool({
  id: "extractDocument",
  description: "Extract text and data from a document image or PDF. Call this first when user sends a document.",
  inputSchema: z.object({
    url: z.string().describe("URL of the document image or PDF to extract"),
  }),
  execute: async ({ context }) => {
    try {
      const response = await fetch(`${RAILWAY_API}/extract-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: context.url }),
      });
      
      if (!response.ok) {
        return { error: `Extraction failed: ${response.status}` };
      }
      
      const data = await response.json();
      return {
        success: true,
        document_type: data.document_type,
        text: data.raw_text,
        fields: data.fields,
        readability_score: data.readability_score,
      };
    } catch (error) {
      return { error: `Extraction error: ${error}` };
    }
  },
});

export const analyzeDocument = createTool({
  id: "analyzeDocument", 
  description: "Perform deep analysis on a single document. Use after extractDocument to get detailed compliance check.",
  inputSchema: z.object({
    text: z.string().describe("The extracted document text"),
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
        return { error: `Analysis failed: ${response.status}` };
      }
      
      return await response.json();
    } catch (error) {
      return { error: `Analysis error: ${error}` };
    }
  },
});

export const validateDocuments = createTool({
  id: "validateDocuments",
  description: "Cross-validate all stored documents for a user against each other and LC requirements. Call when user types 'validate' or wants to check document consistency.",
  inputSchema: z.object({
    phone: z.string().describe("User's phone number to retrieve their stored documents"),
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
        return { error: `Validation failed: ${response.status}` };
      }
      
      return await response.json();
    } catch (error) {
      return { error: `Validation error: ${error}` };
    }
  },
});
