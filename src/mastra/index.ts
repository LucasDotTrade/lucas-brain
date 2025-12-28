import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { lucasAgent } from "./agents";
import { documentReviewWorkflow } from "./workflows/document-review";

const storage = new PostgresStore({
  connectionString: process.env.DATABASE_URL!,
});

export const mastra = new Mastra({
  agents: { lucasAgent },
  workflows: { documentReviewWorkflow },
  storage,
});
