import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { lucasAgent, haikuExtractor } from "./agents";

const storage = new PostgresStore({
  id: "mastra-storage",
  connectionString: process.env.DATABASE_URL!,
});

export const mastra = new Mastra({
  agents: { lucasAgent, haikuExtractor },
  storage,
  server: {
    port: parseInt(process.env.PORT || "4111"),
    host: "0.0.0.0",
    timeout: 10 * 60 * 1000, // 10 min (default 3 min caused 503 timeouts)
    bodySizeLimit: 50 * 1024 * 1024, // 50 MB
  },
});
