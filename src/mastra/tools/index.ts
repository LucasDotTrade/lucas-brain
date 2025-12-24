import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Tool to extract data from trade documents via Python engine
export const extractDocument = createTool({
  id: 'extract-document',
  description: 'Extract structured data from trade documents (LC, Bill of Lading, Invoice, Packing List, Certificate of Origin)',
  inputSchema: z.object({
    fileUrl: z.string().describe('URL to the document file'),
  }),
  outputSchema: z.object({
    document_type: z.string(),
    confidence_score: z.number(),
    fields: z.record(z.any()),
    tables: z.array(z.any()),
    flags: z.array(z.string()),
    raw_text: z.string(),
  }),
  execute: async ({ context }) => {
    const response = await fetch('https://unignited-couth-zane.ngrok-free.dev/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: context.fileUrl }),
    });
    return await response.json();
  },
});

// Tool to validate documents against each other
export const validateDocuments = createTool({
  id: 'validate-documents',
  description: 'Cross-validate LC, Bill of Lading, and Invoice for discrepancies',
  inputSchema: z.object({
    lc: z.object({
      document_type: z.string(),
      fields: z.record(z.any()),
      raw_text: z.string(),
    }),
    bl: z.object({
      document_type: z.string(),
      fields: z.record(z.any()),
      raw_text: z.string(),
    }),
    invoice: z.object({
      document_type: z.string(),
      fields: z.record(z.any()),
      raw_text: z.string(),
    }),
  }),
  outputSchema: z.object({
    discrepancies: z.array(z.any()),
    overall_status: z.string(),
  }),
  execute: async ({ context }) => {
    const response = await fetch('https://unignited-couth-zane.ngrok-free.dev/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });
    return await response.json();
  },
});

// Tool to get AI analysis of a document
export const analyzeDocument = createTool({
  id: 'analyze-document',
  description: 'Get AI-powered compliance analysis with red flags and recommendations',
  inputSchema: z.object({
    document_type: z.string(),
    raw_text: z.string(),
    fields: z.record(z.any()).optional(),
  }),
  outputSchema: z.object({
    analysis: z.record(z.any()),
    red_flags: z.array(z.string()),
    compliance_score: z.number(),
    recommendations: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const response = await fetch('https://unignited-couth-zane.ngrok-free.dev/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });
    return await response.json();
  },
});