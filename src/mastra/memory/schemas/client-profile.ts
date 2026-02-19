import { z } from "zod";

export const clientProfileSchema = z.object({
  // Identity
  name: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  industry: z.string().optional(),
  language: z.string().optional(),

  // Trade patterns
  products: z.array(z.string()).default([]),
  commodities: z.array(z.string()).default([]),
  tradeRoutes: z.array(z.object({
    origin: z.string(),
    destination: z.string(),
  })).default([]),

  // Counterparties
  preferredBanks: z.array(z.string()).default([]),
  issuingBanks: z.array(z.string()).default([]),
  freightForwarders: z.array(z.string()).default([]),
  problematicBanks: z.array(z.object({
    name: z.string(),
    issues: z.array(z.string()),
  })).default([]),

  // Behavioral patterns
  commonIssues: z.array(z.object({
    issue: z.string(),
    count: z.number().default(1),
    lastSeen: z.string().optional(),
  })).default([]),
  commonMistakes: z.array(z.string()).default([]),

  // Stats (deterministically synced)
  stats: z.object({
    totalDocumentsReviewed: z.number().default(0),
    goCount: z.number().default(0),
    waitCount: z.number().default(0),
    noGoCount: z.number().default(0),
  }).default({}),
});

export type ClientProfile = z.infer<typeof clientProfileSchema>;
