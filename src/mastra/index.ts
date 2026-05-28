import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { lucasAgent, haikuExtractor } from "./agents";
import {
  verdictFormatScorer,
  noDateWordsScorer,
  noSemicolonsScorer,
  requiredSectionsScorer,
  verdictAccuracyScorer,
  forbiddenClaimsScorer,
  responseShapeScorer,
  forbiddenRegexScorer,
  entityGroundingScorer,
  findingFaithfulnessScorer,
  promptAlignmentScorer,
} from "../evals/scorers";

const storageMaxConnections = Number.parseInt(
  process.env.MASTRA_STORAGE_MAX_CONNECTIONS || "4",
  10,
);

const storage = new PostgresStore({
  id: "mastra-storage",
  connectionString: process.env.DATABASE_URL!,
  max: Number.isFinite(storageMaxConnections) ? storageMaxConnections : 4,
  idleTimeoutMillis: 10_000,
});

export const mastra = new Mastra({
  agents: { lucasAgent, haikuExtractor },
  storage,
  scorers: {
    verdictFormatScorer,
    noDateWordsScorer,
    noSemicolonsScorer,
    requiredSectionsScorer,
    verdictAccuracyScorer,
    forbiddenClaimsScorer,
    responseShapeScorer,
    forbiddenRegexScorer,
    entityGroundingScorer,
    findingFaithfulnessScorer,
    promptAlignmentScorer,
  },
  server: {
    port: parseInt(process.env.PORT || "4111"),
    host: "0.0.0.0",
    timeout: 10 * 60 * 1000, // 10 min (default 3 min caused 503 timeouts)
    bodySizeLimit: 50 * 1024 * 1024, // 50 MB
  },
});
