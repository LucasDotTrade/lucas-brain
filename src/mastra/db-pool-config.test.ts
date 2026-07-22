import { describe, expect, it } from "vitest";

import {
  AGENT_DATABASE_POOL_OPTIONS,
  TOOL_DATABASE_POOL_OPTIONS,
} from "./db-pool-config";

describe("database pool limits", () => {
  it("bounds each Mastra agent pool", () => {
    expect(AGENT_DATABASE_POOL_OPTIONS).toEqual({
      max: 2,
      idleTimeoutMillis: 10_000,
    });
  });

  it("bounds each postgres.js tool pool", () => {
    expect(TOOL_DATABASE_POOL_OPTIONS).toEqual({
      max: 1,
      idle_timeout: 10,
    });
  });
});
