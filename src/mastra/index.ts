import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { lucasAgent, haikuExtractor } from "./agents";
import { documentReviewWorkflow } from "./workflows/document-review";
import { packageValidationWorkflow } from "./workflows/package-validation";

const storage = new PostgresStore({
  connectionString: process.env.DATABASE_URL!,
});

export const mastra = new Mastra({
  agents: { lucasAgent, haikuExtractor },
  workflows: { documentReviewWorkflow, packageValidationWorkflow },
  storage,
  server: {
    timeout: 10 * 60 * 1000, // 10 minutes (default was 3 min - caused 503 timeouts)
    bodySizeLimit: 50 * 1024 * 1024, // 50 MB (default was 4.5 MB)
  },
  observability: {
    default: { enabled: true },
  },
});
