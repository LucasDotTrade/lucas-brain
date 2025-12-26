import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { lucasAgent } from "./agents";

const storage = new PostgresStore({
  connectionString: process.env.DATABASE_URL!,
});

export const mastra = new Mastra({
  agents: { lucasAgent },
  storage,
});
