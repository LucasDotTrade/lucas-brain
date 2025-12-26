import { Mastra } from "@mastra/core";
import { PgStore } from "@mastra/pg";
import { lucasAgent } from "./agents";

const storage = new PgStore({
  connectionString: process.env.DATABASE_URL!,
});

export const mastra = new Mastra({
  agents: { lucasAgent },
  storage,
});
