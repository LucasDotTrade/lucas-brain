#!/usr/bin/env npx tsx
/**
 * Test goods description cross-reference logic using Haiku
 * Run: npx tsx scripts/test-goods-description.ts
 *
 * NOTE: This now tests against Haiku LLM for semantic comparison.
 * The old hardcoded category logic has been replaced.
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Replicate the Haiku comparison logic from package-validation.ts
async function compareGoodsDescriptions(
  lcDesc: string,
  otherDesc: string,
  docType: "invoice" | "bl"
): Promise<{ matches: boolean; reason?: string }> {
  const rule = docType === "invoice"
    ? "UCP 600 Article 18(c): Invoice must 'correspond' with LC - all key product descriptors (grade, type, specification) must match. Missing descriptors = mismatch."
    : "UCP 600 Article 19: B/L can use general terms, only fails if describing a completely different product category.";

  const prompt = `Compare these goods descriptions for a Letter of Credit presentation.

LC description: "${lcDesc}"
${docType === "invoice" ? "Invoice" : "B/L"} description: "${otherDesc}"

Rule: ${rule}

Examples:
- LC "MURBAN CRUDE OIL" vs Invoice "CRUDE OIL" → mismatch (invoice missing grade "MURBAN")
- LC "MURBAN CRUDE OIL" vs B/L "CRUDE OIL" → match (B/L can use general terms)
- LC "MURBAN CRUDE OIL" vs B/L "FROZEN BEEF" → mismatch (different product entirely)
- LC "FROZEN BEEF CUTS" vs Invoice "BEEF CUTS FROZEN" → match (same words, different order)

Respond with JSON only:
{"matches": true or false, "reason": "one sentence explanation"}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonStr = text.replace(/```json\n?|\n?```/g, "").trim();
    const json = JSON.parse(jsonStr);
    return { matches: Boolean(json.matches), reason: json.reason };
  } catch (error) {
    console.error("Haiku error:", error);
    return { matches: false, reason: "Unable to verify - manual review recommended" };
  }
}

// Test cases
const tests = [
  // Invoice tests (UCP 600 Article 18(c) - strict)
  { name: "Invoice exact match", lcDesc: "MURBAN CRUDE OIL", otherDesc: "MURBAN CRUDE OIL", docType: "invoice" as const, expected: true },
  { name: "Invoice missing grade", lcDesc: "MURBAN CRUDE OIL", otherDesc: "CRUDE OIL", docType: "invoice" as const, expected: false },
  { name: "Invoice with extra detail", lcDesc: "MURBAN CRUDE OIL", otherDesc: "MURBAN CRUDE OIL API 40.2", docType: "invoice" as const, expected: true },
  { name: "Invoice different word order", lcDesc: "FROZEN BEEF CUTS", otherDesc: "BEEF CUTS FROZEN", docType: "invoice" as const, expected: true },
  { name: "Invoice wrong product", lcDesc: "MURBAN CRUDE OIL", otherDesc: "FROZEN BEEF", docType: "invoice" as const, expected: false },

  // B/L tests (UCP 600 Article 19 - lenient)
  { name: "B/L exact match", lcDesc: "MURBAN CRUDE OIL", otherDesc: "MURBAN CRUDE OIL", docType: "bl" as const, expected: true },
  { name: "B/L general terms OK", lcDesc: "MURBAN CRUDE OIL", otherDesc: "CRUDE OIL", docType: "bl" as const, expected: true },
  { name: "B/L very general terms", lcDesc: "MURBAN CRUDE OIL", otherDesc: "PETROLEUM PRODUCTS", docType: "bl" as const, expected: true },
  { name: "B/L contradictory product", lcDesc: "MURBAN CRUDE OIL", otherDesc: "FROZEN BEEF", docType: "bl" as const, expected: false },

  // Edge cases that hardcoded logic couldn't handle
  { name: "Electronics (no hardcoded category)", lcDesc: "ELECTRONIC COMPONENTS", otherDesc: "FROZEN BEEF", docType: "bl" as const, expected: false },
  { name: "Plural handling", lcDesc: "CRUDE OILS", otherDesc: "CRUDE OIL", docType: "invoice" as const, expected: true },
  { name: "Brand name handling", lcDesc: "A5 WAGYU BEEF", otherDesc: "JAPANESE BEEF", docType: "bl" as const, expected: true },
];

async function runTests() {
  console.log("=== GOODS DESCRIPTION CROSS-REFERENCE TESTS (HAIKU) ===\n");

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await compareGoodsDescriptions(test.lcDesc, test.otherDesc, test.docType);
    const status = result.matches === test.expected ? "✅" : "❌";

    if (result.matches === test.expected) {
      passed++;
    } else {
      failed++;
    }

    console.log(`${status} ${test.name}`);
    console.log(`   LC: "${test.lcDesc}"`);
    console.log(`   ${test.docType === "invoice" ? "Invoice" : "B/L"}: "${test.otherDesc}"`);
    console.log(`   Expected: ${test.expected ? "MATCH" : "MISMATCH"}, Got: ${result.matches ? "MATCH" : "MISMATCH"}`);
    console.log(`   Reason: ${result.reason}`);
    console.log("");
  }

  console.log("=================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
}

runTests().catch(console.error);
