#!/usr/bin/env npx tsx
/**
 * Test goods description cross-reference logic
 * Run: npx tsx scripts/test-goods-description.ts
 */

// Replicate the logic from package-validation.ts for testing
const extractSignificantWords = (desc: string): Set<string> => {
  const normalized = desc.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const fillerWords = new Set(["of", "the", "and", "or", "for", "in", "on", "at", "to", "from", "with"]);

  return new Set(
    normalized.split(" ")
      .filter(w => w.length > 1 && !fillerWords.has(w))
  );
};

const isContradictory = (lcDesc: string, otherDesc: string): boolean => {
  const lcWords = extractSignificantWords(lcDesc);
  const otherWords = extractSignificantWords(otherDesc);

  const productCategories = [
    ["crude", "oil", "petroleum"],
    ["beef", "meat", "cattle"],
    ["chicken", "poultry"],
    ["fish", "seafood", "salmon", "tuna"],
    ["rice", "grain", "wheat", "corn"],
    ["sugar", "sweetener"],
    ["coffee", "cocoa"],
    ["steel", "iron", "metal"],
    ["cotton", "textile", "fabric"],
  ];

  let lcCategory: string[] | null = null;
  for (const category of productCategories) {
    if (category.some(word => lcWords.has(word))) {
      lcCategory = category;
      break;
    }
  }

  if (lcCategory) {
    for (const category of productCategories) {
      if (category === lcCategory) continue;
      if (category.some(word => otherWords.has(word))) {
        return true;
      }
    }
  }

  return false;
};

const invoiceCorrespondsToLC = (lcDesc: string, invoiceDesc: string): boolean => {
  const lcWords = extractSignificantWords(lcDesc);
  const invoiceWords = extractSignificantWords(invoiceDesc);

  for (const word of lcWords) {
    if (!invoiceWords.has(word)) {
      return false;
    }
  }
  return true;
};

const blConsistentWithLC = (lcDesc: string, blDesc: string): boolean => {
  return !isContradictory(lcDesc, blDesc);
};

// Test cases
console.log("=== GOODS DESCRIPTION CROSS-REFERENCE TESTS ===\n");

const tests = [
  // Invoice tests (UCP 600 Article 18(c) - strict)
  {
    name: "Invoice exact match",
    lcDesc: "MURBAN CRUDE OIL",
    otherDesc: "MURBAN CRUDE OIL",
    docType: "invoice",
    expected: true,
  },
  {
    name: "Invoice missing key term (murban)",
    lcDesc: "MURBAN CRUDE OIL",
    otherDesc: "CRUDE OIL",
    docType: "invoice",
    expected: false,
  },
  {
    name: "Invoice with extra detail",
    lcDesc: "MURBAN CRUDE OIL",
    otherDesc: "MURBAN CRUDE OIL API 40.2 SULFUR 0.8%",
    docType: "invoice",
    expected: true,
  },
  {
    name: "Invoice different word order",
    lcDesc: "FROZEN BEEF CUTS",
    otherDesc: "BEEF CUTS FROZEN",
    docType: "invoice",
    expected: true,
  },
  {
    name: "Invoice case insensitive",
    lcDesc: "Murban Crude Oil",
    otherDesc: "MURBAN CRUDE OIL",
    docType: "invoice",
    expected: true,
  },
  {
    name: "Invoice wrong product",
    lcDesc: "MURBAN CRUDE OIL",
    otherDesc: "FROZEN BEEF CUTS",
    docType: "invoice",
    expected: false,
  },

  // B/L tests (UCP 600 Article 19 - lenient)
  {
    name: "B/L exact match",
    lcDesc: "MURBAN CRUDE OIL",
    otherDesc: "MURBAN CRUDE OIL",
    docType: "bl",
    expected: true,
  },
  {
    name: "B/L general terms (OK per UCP 600)",
    lcDesc: "MURBAN CRUDE OIL",
    otherDesc: "CRUDE OIL",
    docType: "bl",
    expected: true,  // This is the key difference from invoice
  },
  {
    name: "B/L very general terms",
    lcDesc: "MURBAN CRUDE OIL API 40.2",
    otherDesc: "PETROLEUM PRODUCTS",
    docType: "bl",
    expected: true,  // Same category, not contradictory
  },
  {
    name: "B/L contradictory product",
    lcDesc: "MURBAN CRUDE OIL",
    otherDesc: "FROZEN BEEF",
    docType: "bl",
    expected: false,  // Different category = contradiction
  },
  {
    name: "B/L contradictory product 2",
    lcDesc: "JAPANESE KOBE BEEF A5",
    otherDesc: "SALMON FILLETS",
    docType: "bl",
    expected: false,  // Beef vs fish
  },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  let result: boolean;
  if (test.docType === "invoice") {
    result = invoiceCorrespondsToLC(test.lcDesc, test.otherDesc);
  } else {
    result = blConsistentWithLC(test.lcDesc, test.otherDesc);
  }

  const status = result === test.expected ? "✅" : "❌";
  if (result === test.expected) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${status} ${test.name}`);
  console.log(`   LC: "${test.lcDesc}"`);
  console.log(`   ${test.docType === "invoice" ? "Invoice" : "B/L"}: "${test.otherDesc}"`);
  console.log(`   Expected: ${test.expected ? "MATCH" : "MISMATCH"}, Got: ${result ? "MATCH" : "MISMATCH"}`);
  console.log("");
}

console.log("=================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
