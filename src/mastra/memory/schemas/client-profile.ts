import { z } from "zod";

export const clientProfileSchema = z.object({
  name: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  industry: z.string().optional(),
  products: z.array(z.string()).default([]),
  tradeRoutes: z.array(z.object({
    origin: z.string(),
    destination: z.string(),
  })).default([]),
  preferredBanks: z.array(z.string()).default([]),
  problematicBanks: z.array(z.object({
    name: z.string(),
    issues: z.array(z.string()),
  })).default([]),
  commonMistakes: z.array(z.string()).default([]),
  stats: z.object({
    totalDocumentsReviewed: z.number().default(0),
    goCount: z.number().default(0),
    waitCount: z.number().default(0),
    noGoCount: z.number().default(0),
  }).default({}),
});

export type ClientProfile = z.infer<typeof clientProfileSchema>;
