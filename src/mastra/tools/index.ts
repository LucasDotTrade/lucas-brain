import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const RAILWAY_API = "https://lucas-core-production.up.railway.app";

export const extractDocument = createTool({
  id: "extractDocument",
  description: "Extract text from a document image or PDF. Returns raw text and basic field extraction. Call this when user sends a document.",
  inputSchema: z.object({
    url: z.string().describe("URL of the document to extract"),
  }),
  execute: async ({ context }) => {
    try {
      const response = await fetch(`${RAILWAY_API}/extract-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: context.url }),
      });
      
      if (!response.ok) {
        return { success: false, error: `Extraction failed: ${response.status}` };
      }
      
      const data = await response.json();
      return {
        success: true,
        raw_text: data.raw_text,
        document_type: data.document_type,
        fields: data.fields,
        readability_score: data.readability_score
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const validateDocuments = createTool({
  id: "validateDocuments",
  description: "Cross-validate all stored documents for a user. Compares B/L against LC requirements, checks dates, ports, amounts. Call when user wants to validate/compare their documents.",
  inputSchema: z.object({
    phone: z.string().describe("User phone number to retrieve their documents"),
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
        return { success: false, error: `Validation failed: ${response.status}` };
      }
      
      return await response.json();
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export const analyzeDocument = createTool({
  id: "analyzeDocument",
  description: "Get detailed compliance analysis of a document. Only use if you need deeper analysis beyond what you can determine from the raw text.",
  inputSchema: z.object({
    text: z.string().describe("Document text to analyze"),
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
        return { success: false, error: `Analysis failed: ${response.status}` };
      }
      
      return await response.json();
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});
