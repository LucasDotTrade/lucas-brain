/**
 * Mastra Processors - Phase 1: Mastra Quick Wins
 *
 * These are DETERMINISTIC output processors that do NOT make extra LLM calls.
 * Previous processors (LanguageDetector, PIIDetector) were removed because
 * they added GPT-4o-mini calls per request (causing 120s+ timeouts).
 *
 * The evidenceAndTransparencyProcessor uses pure regex/string matching.
 */

export {
  processOutputForEvidence,
  formatIssuesAsFeedback,
  hasConfidenceDisplay,
  extractVerdictFromResponse,
  type ProcessorResult,
} from "./evidence-transparency";
