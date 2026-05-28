import { describe, expect, it } from "vitest";
import {
  loadControlPlaneSeedItems,
  loadPreDepositSeedItems,
  loadRajSeedItem,
} from "./control-plane-cases";

describe("Mastra control-plane eval corpus loader", () => {
  it("loads the Pre-Deposit acceptance corpus", () => {
    const cases = loadPreDepositSeedItems();

    expect(cases.length).toBeGreaterThanOrEqual(14);
    expect(cases[0].input).toContain("[Stage: pre_deposit]");
    expect(cases[0].input).toContain("Forbidden claims:");
    expect(cases[0].groundTruth.corpus).toBe("pre_deposit");
    expect(cases[0].groundTruth.forbiddenClaims).toContain("payment_authorized");
  });

  it("loads the Raj replay fixture as a pinned regression case", () => {
    const cases = loadRajSeedItem();

    expect(cases).toHaveLength(1);
    expect(cases[0].input).toContain("raj_egypt_lng");
    expect(cases[0].input).toContain("Must not find:");
    expect(cases[0].groundTruth.mustMention).toContain("IRH");
    expect(cases[0].groundTruth.forbiddenRegexes).toEqual(
      expect.arrayContaining([expect.stringContaining("mercuria energy")])
    );
  });

  it("combines all control-plane cases for Mastra eval gates", () => {
    const cases = loadControlPlaneSeedItems();

    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.some((item) => item.groundTruth.corpus === "pre_deposit")).toBe(
      true
    );
    expect(cases.some((item) => item.groundTruth.corpus === "raj_egypt_lng")).toBe(
      true
    );
  });
});
