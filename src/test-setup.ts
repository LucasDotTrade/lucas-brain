// Mock @mastra/pg to avoid DB connection on import
import { vi } from "vitest";

vi.mock("@mastra/pg", () => ({
  PostgresStore: vi.fn().mockImplementation(() => ({})),
  PgVector: vi.fn().mockImplementation(() => ({})),
}));

// Mock @mastra/memory to avoid initialization
vi.mock("@mastra/memory", () => ({
  Memory: vi.fn().mockImplementation(() => ({})),
}));

// Mock @mastra/core/agent to avoid initialization
vi.mock("@mastra/core/agent", () => ({
  Agent: vi.fn().mockImplementation((config) => config),
}));

// Mock tools to avoid their initialization
vi.mock("../src/mastra/tools", () => ({
  recordCase: { name: "recordCase" },
  searchSimilarCases: { name: "searchSimilarCases" },
  verifyMath: { name: "verifyMath" },
  updateClientProfile: { name: "updateClientProfile" },
}));

// Mock memory schemas
vi.mock("../src/mastra/memory/schemas/client-profile", () => ({
  clientProfileSchema: {
    parse: vi.fn().mockReturnValue({}),
  },
}));
