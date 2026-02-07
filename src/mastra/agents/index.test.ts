import { describe, it, expect } from "vitest";
import { instructionsTemplate } from "./index";
import {
  checkVerdictFormat,
  checkNoDateWords,
  checkNoSemicolonsOutsideCode,
  checkRequiredSections,
  validateLucasOutput,
} from "./output-validators";

// =============================================================================
// PROMPT CONTRACT TESTS
// =============================================================================

describe("System Prompt Contract", () => {
  // -------------------------------------------------------------------------
  // Structural: Required sections exist IN ORDER
  // -------------------------------------------------------------------------

  describe("required sections in order", () => {
    it("has BEFORE analyzing section before verdict format", () => {
      const beforeIdx = instructionsTemplate.indexOf("BEFORE analyzing");
      const verdictIdx = instructionsTemplate.indexOf("Verdict:");
      expect(beforeIdx).toBeGreaterThan(-1);
      expect(verdictIdx).toBeGreaterThan(-1);
      expect(beforeIdx).toBeLessThan(verdictIdx);
    });

    it("has verdict format before The good news", () => {
      const verdictIdx = instructionsTemplate.indexOf("Verdict:");
      const goodNewsIdx = instructionsTemplate.indexOf("The good news");
      expect(verdictIdx).toBeGreaterThan(-1);
      expect(goodNewsIdx).toBeGreaterThan(-1);
      expect(verdictIdx).toBeLessThan(goodNewsIdx);
    });

    it("has The good news before Watch out for", () => {
      const goodIdx = instructionsTemplate.indexOf("The good news");
      const watchIdx = instructionsTemplate.indexOf("Watch out for");
      expect(goodIdx).toBeGreaterThan(-1);
      expect(watchIdx).toBeGreaterThan(-1);
      expect(goodIdx).toBeLessThan(watchIdx);
    });

    it("has Watch out for before What to do now in output format", () => {
      // In the output format section (after "Verdict:"), Watch out for must precede What to do now
      const verdictIdx = instructionsTemplate.indexOf("Verdict:");
      const formatSection = instructionsTemplate.slice(verdictIdx);
      const watchIdx = formatSection.indexOf("Watch out for");
      const todoIdx = formatSection.indexOf("What to do now");
      expect(watchIdx).toBeGreaterThan(-1);
      expect(todoIdx).toBeGreaterThan(-1);
      expect(watchIdx).toBeLessThan(todoIdx);
    });
  });

  // -------------------------------------------------------------------------
  // MUST/NEVER clauses
  // -------------------------------------------------------------------------

  describe("MUST/NEVER clauses", () => {
    it("declares dates are NOT YOUR JOB", () => {
      expect(instructionsTemplate).toContain("DATES: NOT YOUR JOB");
    });

    it("instructs to SKIP timeline section", () => {
      expect(instructionsTemplate).toContain("SKIP THIS SECTION ENTIRELY");
    });

    it("bans semicolons absolutely", () => {
      expect(instructionsTemplate).toContain("NEVER use semicolons");
    });

    it("never accuse of fraud", () => {
      expect(instructionsTemplate).toContain("Never accuse of fraud");
    });

    it("forbids date words: expired, passed, missed, behind", () => {
      const clause = instructionsTemplate;
      expect(clause).toMatch(/Do NOT say.*expired/);
      expect(clause).toMatch(/Do NOT say.*passed/);
      expect(clause).toMatch(/Do NOT say.*missed/);
      expect(clause).toMatch(/Do NOT say.*behind/);
    });

    it("instructs not to calculate days remaining", () => {
      expect(instructionsTemplate).toContain(
        "Do NOT calculate days remaining"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Mandatory tool references
  // -------------------------------------------------------------------------

  describe("mandatory tool references", () => {
    it("requires verifyMath as MANDATORY", () => {
      expect(instructionsTemplate).toContain("verifyMath");
      expect(instructionsTemplate).toContain("MANDATORY");
    });

    it("requires recordCase after every analysis", () => {
      expect(instructionsTemplate).toContain("recordCase");
      expect(instructionsTemplate).toMatch(
        /recordCase.*(?:mandatory|After every analysis)/i
      );
    });

    it("references all four tools", () => {
      expect(instructionsTemplate).toContain("verifyMath");
      expect(instructionsTemplate).toContain("recordCase");
      expect(instructionsTemplate).toContain("searchSimilarCases");
      expect(instructionsTemplate).toContain("updateClientProfile");
    });
  });

  // -------------------------------------------------------------------------
  // Sanctions list
  // -------------------------------------------------------------------------

  describe("sanctions list", () => {
    it("includes all sanctioned countries", () => {
      expect(instructionsTemplate).toContain("Iran");
      expect(instructionsTemplate).toContain("North Korea");
      expect(instructionsTemplate).toContain("Syria");
      expect(instructionsTemplate).toContain("Cuba");
    });

    it("treats Iran as AUTO NO_GO", () => {
      expect(instructionsTemplate).toMatch(/Iran.*NO_GO|AUTO NO_GO/);
    });
  });

  // -------------------------------------------------------------------------
  // Date placeholder
  // -------------------------------------------------------------------------

  describe("date placeholder", () => {
    it("has __DATE_PLACEHOLDER__ for runtime injection", () => {
      expect(instructionsTemplate).toContain("__DATE_PLACEHOLDER__");
    });

    it("starts with TODAY:", () => {
      expect(instructionsTemplate.startsWith("TODAY:")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Verdict format specification
  // -------------------------------------------------------------------------

  describe("verdict format", () => {
    it("specifies GO / WAIT / NO_GO verdict types", () => {
      expect(instructionsTemplate).toContain("GO");
      expect(instructionsTemplate).toContain("WAIT");
      expect(instructionsTemplate).toContain("NO_GO");
    });

    it("specifies score format (xx/100)", () => {
      expect(instructionsTemplate).toMatch(/\d+\/100/);
    });
  });
});

// =============================================================================
// OUTPUT VALIDATOR TESTS
// =============================================================================

describe("Output Validators", () => {
  // -------------------------------------------------------------------------
  // checkVerdictFormat
  // -------------------------------------------------------------------------

  describe("checkVerdictFormat", () => {
    it("passes for GO verdict", () => {
      const result = checkVerdictFormat("Verdict: GO (92/100)");
      expect(result.passed).toBe(true);
    });

    it("passes for WAIT verdict", () => {
      const result = checkVerdictFormat("Verdict: WAIT (78/100)");
      expect(result.passed).toBe(true);
    });

    it("passes for NO_GO verdict", () => {
      const result = checkVerdictFormat("Verdict: NO_GO (45/100)");
      expect(result.passed).toBe(true);
    });

    it("fails when verdict is missing", () => {
      const result = checkVerdictFormat("This is a great trade!");
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("fails for malformed verdict", () => {
      const result = checkVerdictFormat("Verdict: MAYBE (50/100)");
      expect(result.passed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // checkNoDateWords
  // -------------------------------------------------------------------------

  describe("checkNoDateWords", () => {
    it("passes for clean text", () => {
      const result = checkNoDateWords(
        "Your shipment route looks good. Port of loading confirmed."
      );
      expect(result.passed).toBe(true);
    });

    it("catches 'expired'", () => {
      const result = checkNoDateWords("The LC has expired.");
      expect(result.passed).toBe(false);
    });

    it("catches 'has passed'", () => {
      const result = checkNoDateWords("The deadline has passed.");
      expect(result.passed).toBe(false);
    });

    it("catches 'days remaining'", () => {
      const result = checkNoDateWords("You have 5 days remaining.");
      expect(result.passed).toBe(false);
    });

    it("catches 'days left'", () => {
      const result = checkNoDateWords("Only 3 days left to present.");
      expect(result.passed).toBe(false);
    });

    it("catches 'only X days'", () => {
      const result = checkNoDateWords("You only have 7 days.");
      expect(result.passed).toBe(false);
    });

    it("catches 'days to expiry'", () => {
      const result = checkNoDateWords("There are 10 days to expiry.");
      expect(result.passed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // checkNoSemicolonsOutsideCode
  // -------------------------------------------------------------------------

  describe("checkNoSemicolonsOutsideCode", () => {
    it("passes for text without semicolons", () => {
      const result = checkNoSemicolonsOutsideCode("Clean text here.");
      expect(result.passed).toBe(true);
    });

    it("fails for semicolons in prose", () => {
      const result = checkNoSemicolonsOutsideCode(
        "Good structure; solid terms; proper dates"
      );
      expect(result.passed).toBe(false);
    });

    it("allows semicolons inside code blocks", () => {
      const text = "Some text\n```\nconst x = 1;\n```\nMore text";
      const result = checkNoSemicolonsOutsideCode(text);
      expect(result.passed).toBe(true);
    });

    it("allows semicolons inside inline code", () => {
      const text = "Use `const x = 1;` in your code";
      const result = checkNoSemicolonsOutsideCode(text);
      expect(result.passed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkRequiredSections
  // -------------------------------------------------------------------------

  describe("checkRequiredSections", () => {
    it("passes for well-formed response", () => {
      const text = `
        Verdict: GO (92/100)

        The good news
        Everything looks solid.

        Watch out for
        Minor issue with port name.
      `;
      const result = checkRequiredSections(text);
      expect(result.passed).toBe(true);
    });

    it("fails when verdict missing", () => {
      const text = "The good news\nEverything is fine.";
      const result = checkRequiredSections(text);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain("No verdict line found");
    });

    it("fails when no sections present", () => {
      const text = "GO (92/100) - all clear.";
      const result = checkRequiredSections(text);
      expect(result.passed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // validateLucasOutput (combined)
  // -------------------------------------------------------------------------

  describe("validateLucasOutput", () => {
    const KNOWN_GOOD = `Hey Diego! 👋 First time working together — I'm Lucas.

USD 1.5M copper concentrate, Zambia to UAE via Durban — route works.

**Verdict: 🟢 GO (92/100)**
Document: LC-2024-001

✅ **The good news**
Clean LC structure. The reefer spec matches cargo requirements perfectly.

⚠️ **Watch out for**
Port of discharge shows "JEBAL ALI" — should be "JEBEL ALI". Banks will reject this.

📋 **What to do now**
- Fix the port name typo first — this is the priority

What's your timeline with the bank?`;

    const KNOWN_BAD_SEMICOLONS =
      "GO (92/100)\nThe good news\nClean structure; good terms; solid dates";

    const KNOWN_BAD_DATE_WORDS =
      "GO (92/100)\nThe good news\nThe LC has expired and you have 3 days remaining.";

    const KNOWN_BAD_NO_VERDICT =
      "The good news\nEverything looks great.\nWatch out for\nNothing.";

    it("passes for known-good output", () => {
      const result = validateLucasOutput(KNOWN_GOOD);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails for semicolons in prose", () => {
      const result = validateLucasOutput(KNOWN_BAD_SEMICOLONS);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("Semicolon"))).toBe(true);
    });

    it("fails for date words", () => {
      const result = validateLucasOutput(KNOWN_BAD_DATE_WORDS);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("date word"))).toBe(true);
    });

    it("fails for missing verdict", () => {
      const result = validateLucasOutput(KNOWN_BAD_NO_VERDICT);
      expect(result.passed).toBe(false);
      expect(
        result.errors.some((e) => e.includes("verdict") || e.includes("Verdict"))
      ).toBe(true);
    });
  });
});
