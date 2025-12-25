import { Mastra } from "@mastra/core";
import { lucasAgent } from "./agents";

export const mastra = new Mastra({
  agents: { lucasAgent },
  bundler: {
    externals: ["@ai-sdk/anthropic"],
  },
});
