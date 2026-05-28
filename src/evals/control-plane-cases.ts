import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ManifestCase = {
  id: string;
  title: string;
  family: string;
  expected_status: string;
  evidence?: Array<{ path?: string; type?: string; role?: string }>;
  acceptance_criteria?: {
    must_detect?: Array<{
      id: string;
      severity: string;
      owner: string;
      next_action: string;
      evidence_refs?: string[];
    }>;
    must_not_claim?: string[];
    required_response_shape?: string[];
    copy_blocks?: Record<string, string>;
  };
};

type CorpusManifest = {
  corpus_name?: string;
  cases?: ManifestCase[];
};

export type LucasEvalSeedItem = {
  input: string;
  groundTruth: Record<string, unknown>;
};

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(THIS_DIR, "../../..");
const LUCAS_TRADE_ROOT = join(WORKSPACE_ROOT, "lucas.trade");
const PRE_DEPOSIT_CORPUS_DIR = join(
  LUCAS_TRADE_ROOT,
  "tests",
  "fixtures",
  "pre_deposit_case_corpus"
);
const RAJ_FIXTURE_DIR = join(
  LUCAS_TRADE_ROOT,
  "tests",
  "fixtures",
  "raj_egypt_lng"
);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function readEvidence(baseDir: string, evidence: ManifestCase["evidence"]): string {
  return (evidence || [])
    .map((item) => {
      if (!item.path) return "";
      const path = join(baseDir, item.path);
      const text = existsSync(path) ? readFileSync(path, "utf-8") : "";
      return [
        `--- Evidence: ${item.type || "document"} ---`,
        item.role ? `Role: ${item.role}` : "",
        text.trim(),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function makePreDepositPrompt(manifestName: string, item: ManifestCase): string {
  const acceptance = item.acceptance_criteria || {};
  const mustDetect = acceptance.must_detect || [];
  const copyBlocks = Object.entries(acceptance.copy_blocks || {});
  const evidenceText = readEvidence(PRE_DEPOSIT_CORPUS_DIR, item.evidence);

  return `[Lucas Eval Corpus: ${manifestName || "pre_deposit_importer_orders_v1"}]
[Case: ${item.id}]
[Stage: pre_deposit]
[Truth authority: acceptance criteria below]

You are Lucas reviewing an importer order BEFORE deposit.
Use only the supplied evidence. Do not approve payment, call the supplier safe, or make a legal import ruling.

## Evidence
${evidenceText}

## Acceptance Criteria
Expected status: ${item.expected_status}
Required detections:
${mustDetect
  .map(
    (finding) =>
      `- ${finding.id} | severity=${finding.severity} | owner=${finding.owner} | action=${finding.next_action}`
  )
  .join("\n")}

Required response shape:
${(acceptance.required_response_shape || []).map((shape) => `- ${shape}`).join("\n")}

Copy blocks to preserve when relevant:
${copyBlocks.length ? copyBlocks.map(([owner, text]) => `- ${owner}: ${text}`).join("\n") : "- none"}

Forbidden claims:
${(acceptance.must_not_claim || []).map((claim) => `- ${claim}`).join("\n")}

## Output Contract
Start with one status line:
*Pre-deposit check — Not ready for deposit*
or
*Pre-deposit check — Needs confirmation*
or
*Pre-deposit check — Ready for operator review*

Then write short sections in this order:
*Blocking / needs confirmation*
*Confirmed from evidence*
*Owners and next actions*
*Message to supplier*
*Broker / forwarder / operator question* when relevant

End with a boundary line:
Boundary: Evidence control for operator review, not payment approval, supplier verification, legal advice, customs clearance, or safety certification.

Never use semicolons. Use commas or line breaks.

Write the user-facing Lucas response.`;
}

export function loadPreDepositSeedItems(): LucasEvalSeedItem[] {
  const manifestPath = join(PRE_DEPOSIT_CORPUS_DIR, "manifest.json");
  if (!existsSync(manifestPath)) return [];

  const manifest = readJson<CorpusManifest>(manifestPath);
  return (manifest.cases || []).map((item) => {
    const acceptance = item.acceptance_criteria || {};
    const mustDetect = acceptance.must_detect || [];
    return {
      input: makePreDepositPrompt(manifest.corpus_name || "", item),
      groundTruth: {
        corpus: "pre_deposit",
        caseId: item.id,
        scenario: item.title,
        family: item.family,
        expectedStatus: item.expected_status,
        mustMention: mustDetect.flatMap((finding) => [
          finding.owner,
          finding.next_action,
          finding.id.replaceAll("_", " "),
        ]),
        forbiddenClaims: acceptance.must_not_claim || [],
        requiredResponseShape: acceptance.required_response_shape || [],
        mustDetectIds: mustDetect.map((finding) => finding.id),
      },
    };
  });
}

export function loadRajSeedItem(): LucasEvalSeedItem[] {
  const expectedPath = join(RAJ_FIXTURE_DIR, "expected.json");
  if (!existsSync(expectedPath)) return [];

  const expected = readJson<{
    name?: string;
    must_find?: Array<{ description?: string; pattern?: string }>;
    must_not_find?: Array<{ description?: string; pattern?: string }>;
    documents?: Array<{ doc_type?: string; file?: string }>;
  }>(expectedPath);
  const docs = (expected.documents || [])
    .map((doc) => {
      if (!doc.file) return "";
      const path = join(RAJ_FIXTURE_DIR, doc.file);
      const text = existsSync(path) ? readFileSync(path, "utf-8") : "";
      return `--- ${doc.doc_type || doc.file} ---\n${text.trim()}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      input: `[Lucas Eval Corpus: raj_egypt_lng]
[Case: raj_egypt_lng]

Review this transaction package. Use only supplied evidence and deterministic findings. Preserve draft-LC boundaries.

## Evidence
${docs}

## Acceptance Criteria
Must find:
${(expected.must_find || []).map((item) => `- ${item.description || item.pattern}`).join("\n")}

Must not find:
${(expected.must_not_find || [])
  .map((item) => `- ${item.description || item.pattern}`)
  .join("\n")}

Write the user-facing Lucas response.`,
      groundTruth: {
        corpus: "raj_egypt_lng",
        caseId: "raj_egypt_lng",
        scenario: expected.name || "Raj Egypt LNG",
        mustMention: [
          "IRH",
          "EGPC",
          "Mercuria",
          "Venture Global",
          "ORION SAINT",
          "non-negotiable",
          "copy",
          "intermediary",
        ],
        forbiddenRegexes: (expected.must_not_find || []).map((item) => item.pattern),
        requiredResponseShape: ["blocking_items_first", "evidence_grounded", "next_actions"],
      },
    },
  ];
}

export function loadControlPlaneSeedItems(): LucasEvalSeedItem[] {
  return [...loadPreDepositSeedItems(), ...loadRajSeedItem()];
}
