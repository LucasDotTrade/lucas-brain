/**
 * evidenceAndTransparencyProcessor - Phase 1: Mastra Quick Wins
 *
 * Output processor that validates Lucas's responses for:
 * 1. Date hallucination detection (Lucas shouldn't calculate days)
 * 2. Forbidden phrases (style rules)
 * 3. Evidence requirement (discrepancies must show both documents)
 * 4. Semicolon ban
 *
 * This is a DETERMINISTIC processor - NO extra LLM calls.
 * Previous processors (LanguageDetector, PIIDetector) were removed
 * because they added GPT-4o-mini calls per request.
 *
 * This processor uses pure regex/string matching.
 */

export interface ProcessorResult {
  text: string;
  issues: string[];
  shouldRetry: boolean;
}

/**
 * Process Lucas output for evidence and transparency rules.
 *
 * @param text - The raw response text from Lucas
 * @param context - Optional context about low-confidence fields
 * @returns Processed result with issues flagged
 */
export function processOutputForEvidence(
  text: string,
  context?: { lowConfidenceFields?: string[] }
): ProcessorResult {
  const issues: string[] = [];

  // Rule 1: Date hallucination check
  // Lucas should NOT calculate days - Python handles timeline
  const dateCalcPatterns = [
    /only \d+ days?(?:\s+(?:left|remaining|until|to))/i,
    /just \d+ days?(?:\s+(?:left|remaining|until|to))/i,
    /\d+ days? (?:left|remaining|until|to)/i,
    /you have \d+ days?/i,
    /(?:have|with|only) \d+ business days?/i,
    /presentation period.*\d+\s*days/i,
    /expires? in \d+ days?/i,
    /\d+ days? (?:before|after) expiry/i,
  ];

  for (const pattern of dateCalcPatterns) {
    if (pattern.test(text)) {
      issues.push("Date calculation detected - system handles timeline, not LLM");
      break; // Only flag once
    }
  }

  // Rule 2: Forbidden phrases (from Lucas instructions)
  const forbiddenPhrases = [
    "ultra-high-value",
    "needs perfect execution",
    "got your docs",
    "let me take a look",
    "here's what I found",
    "serious red flags that need immediate attention",
    "back with",
    "this time",
    "again,",
    "looking at my records",
    "someone else on the team",
    "different contact method",
  ];

  for (const phrase of forbiddenPhrases) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push(`Forbidden phrase: "${phrase}"`);
    }
  }

  // Rule 3: If discrepancy mentioned, must show evidence
  // Look for discrepancy/mismatch language without supporting quotes
  const discrepancyKeywords = [
    "discrepancy",
    "mismatch",
    "doesn't match",
    "does not match",
    "inconsistent",
    "conflict",
  ];

  const hasDiscrepancyMention = discrepancyKeywords.some((kw) =>
    text.toLowerCase().includes(kw)
  );

  if (hasDiscrepancyMention) {
    // Check if evidence is shown (LC:, B/L:, Document:, or quoted values)
    const hasEvidence =
      text.includes("LC:") ||
      text.includes("B/L:") ||
      text.includes("Invoice:") ||
      text.includes("Document:") ||
      /[""][^""]+[""].*vs.*[""][^""]+[""]/i.test(text) || // "value" vs "value"
      /:\s*[""][^""]+[""]/i.test(text); // : "quoted value"

    if (!hasEvidence) {
      issues.push(
        "Discrepancy mentioned without showing evidence from both documents"
      );
    }
  }

  // Rule 4: Semicolon ban (except in code blocks)
  // Remove code blocks first, then check
  const textWithoutCode = text.replace(/```[\s\S]*?```/g, "");
  if (textWithoutCode.includes(";")) {
    // Check if it's actually a semicolon separator (not part of a URL or code)
    const semicolonContexts = textWithoutCode.split(";");
    for (let i = 0; i < semicolonContexts.length - 1; i++) {
      const before = semicolonContexts[i].trim();
      const after = semicolonContexts[i + 1]?.trim();
      // If there's readable text before and after, it's likely a separator
      if (
        before &&
        after &&
        !before.endsWith("http") &&
        !before.endsWith("https") &&
        !/^\s*[a-z]+\s*=/.test(after) // Not code like "x = 1"
      ) {
        issues.push("Semicolon used outside code block");
        break;
      }
    }
  }

  // Rule 5: No certainty claims about low-confidence fields
  const lowConfFields = context?.lowConfidenceFields || [];
  for (const field of lowConfFields) {
    const definitivePatterns = [
      new RegExp(`${field}.*(?:is correct|matches|verified|confirmed)`, "i"),
      new RegExp(`(?:verified|confirmed).*${field}`, "i"),
      new RegExp(`${field}.*(?:✓|✅)`, "i"),
    ];

    for (const pattern of definitivePatterns) {
      if (pattern.test(text)) {
        issues.push(`Claimed certainty about low-confidence field: ${field}`);
        break;
      }
    }
  }

  // Rule 6: Check for "expired" / "passed" / "missed" about dates
  // (Lucas should not comment on date status)
  const dateStatusPatterns = [
    /(?:date|deadline|expiry|shipment).*(?:has passed|already passed|expired|missed|behind)/i,
    /(?:passed|expired|missed).*(?:date|deadline|expiry)/i,
    /you(?:'ve| have) missed/i,
    /too late to/i,
  ];

  for (const pattern of dateStatusPatterns) {
    if (pattern.test(text)) {
      issues.push(
        "Date status comment detected (expired/passed/missed) - Python handles dates"
      );
      break;
    }
  }

  return {
    text,
    issues,
    shouldRetry: issues.length > 0,
  };
}

/**
 * Format issues as feedback for retry.
 * This can be passed back to the agent for self-correction.
 */
export function formatIssuesAsFeedback(issues: string[]): string {
  if (issues.length === 0) return "";

  return `Fix these issues in your response:\n${issues.map((i) => `- ${i}`).join("\n")}`;
}

/**
 * Check if response contains confidence display.
 * Phase 1 requirement: Add confidence to response output.
 */
export function hasConfidenceDisplay(text: string): boolean {
  // Check for confidence patterns like "(85/100)", "(confidence: 94%)", "[92%]"
  const confidencePatterns = [
    /\(\d{1,3}\/100\)/,           // (85/100)
    /\(confidence:\s*\d{1,3}%?\)/i, // (confidence: 94%)
    /\[\d{1,3}%\]/,               // [92%]
    /confidence\s*(?:score)?[:\s]+\d{1,3}%?/i, // confidence: 85% or confidence score 85
  ];

  return confidencePatterns.some((p) => p.test(text));
}

/**
 * Extract verdict from response text.
 * Returns the verdict and confidence score if found.
 */
export function extractVerdictFromResponse(text: string): {
  verdict: "GO" | "WAIT" | "NO_GO" | null;
  confidence: number | null;
} {
  // Look for verdict patterns
  const verdictPatterns = [
    /🟢\s*GO\s*\((\d{1,3})\/100\)/i,
    /🟡\s*WAIT\s*\((\d{1,3})\/100\)/i,
    /🔴\s*NO_GO\s*\((\d{1,3})\/100\)/i,
    /GO\s*\((\d{1,3})\/100\)/i,
    /WAIT\s*\((\d{1,3})\/100\)/i,
    /NO_GO\s*\((\d{1,3})\/100\)/i,
    /✅\s*READY\s*\((\d{1,3})\/100\)/i,  // Non-LC mode
    /🟡\s*REVIEW\s*\((\d{1,3})\/100\)/i, // Non-LC mode
    /🔴\s*INCOMPLETE\s*\((\d{1,3})\/100\)/i, // Non-LC mode
  ];

  for (const pattern of verdictPatterns) {
    const match = text.match(pattern);
    if (match) {
      let verdict: "GO" | "WAIT" | "NO_GO";
      const patternStr = pattern.source.toLowerCase();
      if (patternStr.includes("go") || patternStr.includes("ready")) {
        verdict = "GO";
      } else if (patternStr.includes("wait") || patternStr.includes("review")) {
        verdict = "WAIT";
      } else {
        verdict = "NO_GO";
      }

      const confidence = match[1] ? parseInt(match[1], 10) : null;
      return { verdict, confidence };
    }
  }

  // Fallback: look for verdict without score
  if (/🟢\s*GO|GO\s*✅|✅\s*READY/i.test(text)) {
    return { verdict: "GO", confidence: null };
  }
  if (/🟡\s*WAIT|WAIT\s*⚠️|🟡\s*REVIEW/i.test(text)) {
    return { verdict: "WAIT", confidence: null };
  }
  if (/🔴\s*NO_GO|NO_GO\s*❌|🔴\s*INCOMPLETE/i.test(text)) {
    return { verdict: "NO_GO", confidence: null };
  }

  return { verdict: null, confidence: null };
}
