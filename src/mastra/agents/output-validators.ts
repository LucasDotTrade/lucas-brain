/**
 * Output validators for Lucas agent responses.
 *
 * These are deterministic checks that can be used both in tests
 * and as runtime guards before sending responses to users.
 */

export interface ValidationResult {
  passed: boolean;
  errors: string[];
}

/** Strict verdict format: GO (xx/100), WAIT (xx/100), NO_GO (xx/100) */
const VERDICT_PATTERN = /(GO|WAIT|NO_GO)\s*\(\d{1,3}\/100\)/;

/** Date words that Lucas must never generate (dates are Python's job) */
const FORBIDDEN_DATE_WORDS = [
  /\bexpired?\b/i,
  /\bhas passed\b/i,
  /\bdays? remaining\b/i,
  /\bdays? left\b/i,
  /\bdays? until\b/i,
  /\bdays? to expiry\b/i,
  /\bonly (?:have )?\d+ days?\b/i,
];

/**
 * Check that the response contains a valid verdict line.
 */
export function checkVerdictFormat(text: string): ValidationResult {
  const errors: string[] = [];
  if (!VERDICT_PATTERN.test(text)) {
    errors.push(
      `Missing or malformed verdict. Expected pattern like "GO (92/100)" or "WAIT (78/100)" or "NO_GO (45/100)".`
    );
  }
  return { passed: errors.length === 0, errors };
}

/**
 * Check that the response doesn't contain date-related words
 * that Lucas should never generate (dates are Python's job).
 */
export function checkNoDateWords(text: string): ValidationResult {
  const errors: string[] = [];
  for (const pattern of FORBIDDEN_DATE_WORDS) {
    const match = text.match(pattern);
    if (match) {
      errors.push(`Found forbidden date word: "${match[0]}"`);
    }
  }
  return { passed: errors.length === 0, errors };
}

/**
 * Check that semicolons don't appear outside code blocks.
 * Lucas is banned from using semicolons as separators.
 */
export function checkNoSemicolonsOutsideCode(text: string): ValidationResult {
  const errors: string[] = [];
  // Strip code blocks (``` ... ```) before checking
  const withoutCode = text.replace(/```[\s\S]*?```/g, "");
  // Strip inline code (` ... `)
  const withoutInlineCode = withoutCode.replace(/`[^`]+`/g, "");
  if (withoutInlineCode.includes(";")) {
    errors.push("Semicolon found outside code blocks (banned by style guide)");
  }
  return { passed: errors.length === 0, errors };
}

/**
 * Check that required sections are present in the response.
 * At minimum, a document analysis should have a verdict and at least one section.
 */
export function checkRequiredSections(text: string): ValidationResult {
  const errors: string[] = [];
  const hasVerdict = VERDICT_PATTERN.test(text);
  if (!hasVerdict) {
    errors.push("No verdict line found");
  }

  // Check for at least one expected section header
  const sectionHeaders = [
    /The good news/i,
    /Watch out for/i,
    /What.?s missing/i,
    /What to do now/i,
    /Timeline/i,
  ];
  const hasSection = sectionHeaders.some((h) => h.test(text));
  if (!hasSection) {
    errors.push(
      "No recognized section headers found (expected 'The good news', 'Watch out for', etc.)"
    );
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Run all validators against a Lucas response.
 * Returns combined results.
 */
export function validateLucasOutput(text: string): ValidationResult {
  const results = [
    checkVerdictFormat(text),
    checkNoDateWords(text),
    checkNoSemicolonsOutsideCode(text),
    checkRequiredSections(text),
  ];

  const allErrors = results.flatMap((r) => r.errors);
  return { passed: allErrors.length === 0, errors: allErrors };
}
