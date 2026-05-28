import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(thisDir, "../../..");
const lucasTradeRoot = join(workspaceRoot, "lucas.trade");
const preDepositDir = join(
  lucasTradeRoot,
  "tests",
  "fixtures",
  "pre_deposit_case_corpus"
);
const rajDir = join(lucasTradeRoot, "tests", "fixtures", "raj_egypt_lng");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const manifestPath = join(preDepositDir, "manifest.json");
const rajExpectedPath = join(rajDir, "expected.json");
const failures = [];

if (!existsSync(manifestPath)) {
  failures.push(`missing Pre-Deposit manifest: ${manifestPath}`);
}
if (!existsSync(rajExpectedPath)) {
  failures.push(`missing Raj replay fixture: ${rajExpectedPath}`);
}

const manifest = existsSync(manifestPath) ? readJson(manifestPath) : { cases: [] };
const rajExpected = existsSync(rajExpectedPath) ? readJson(rajExpectedPath) : {};
const preDepositCases = Array.isArray(manifest.cases) ? manifest.cases : [];
const rajCaseCount = Array.isArray(rajExpected.documents) ? 1 : 0;

if (preDepositCases.length < 14) {
  failures.push(`expected at least 14 Pre-Deposit cases, got ${preDepositCases.length}`);
}
if (rajCaseCount !== 1) {
  failures.push(`expected 1 Raj LNG replay case, got ${rajCaseCount}`);
}

for (const item of preDepositCases) {
  const acceptance = item.acceptance_criteria || {};
  if (!Array.isArray(acceptance.must_detect) || !acceptance.must_detect.length) {
    failures.push(`${item.id || "unknown"} missing must_detect acceptance criteria`);
  }
  if (!Array.isArray(acceptance.must_not_claim) || !acceptance.must_not_claim.length) {
    failures.push(`${item.id || "unknown"} missing forbidden-claim criteria`);
  }
  for (const evidence of item.evidence || []) {
    if (!evidence.path || !existsSync(join(preDepositDir, evidence.path))) {
      failures.push(`${item.id || "unknown"} missing evidence file ${evidence.path}`);
    }
  }
}

if (failures.length) {
  console.error("Mastra control-plane corpus gate: BLOCKED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Mastra control-plane corpus gate: PASSED");
console.log(`Pre-Deposit cases: ${preDepositCases.length}`);
console.log(`Raj replay cases: ${rajCaseCount}`);
console.log(`Total Mastra control-plane eval cases: ${preDepositCases.length + rajCaseCount}`);
