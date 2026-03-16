/**
 * Policy Layer — Response Classifiers + deriveVerifyMode
 *
 * Inspect raw tool output to determine whether the policy wrapper should
 * auto-trigger verify. Used exclusively inside runToolWithPolicy.
 */

import type { PublicToolName, VerifyMode } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Collect all string leaf values from an unknown result object/array. */
function collectStrings(value: unknown, maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((v) => collectStrings(v, maxDepth, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((v) =>
      collectStrings(v, maxDepth, depth + 1),
    );
  }
  return [];
}

function joinForInspection(result: unknown): string {
  return collectStrings(result).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Classifiers
// ─────────────────────────────────────────────────────────────────────────────

const CODE_PATTERNS = [
  /```[\w\s]*\n[\s\S]+?```/m,       // fenced code blocks
  /\b(import|require)\b.+from\s+['"]/,
  /\b(function|class|const|let|var)\s+\w+/,
  /=>\s*\{/,
  /\bawait\s+\w+\(/,
  /\.(ts|js|py|rs|go|java|cs)\b/,
];

const PACKAGE_PATTERNS = [
  /\bnpm\s+(install|i|add)\b/i,
  /\bpip\s+install\b/i,
  /\byarn\s+(add|install)\b/i,
  /\bpnpm\s+(add|install)\b/i,
  /\bimport\s+.+\s+from\s+['"][^./][^'"]+['"]/,
  /\brequire\s*\(['"][^./][^'"]+['"]\)/,
  /\b(dependencies|devDependencies|peerDependencies)\b/,
];

const TECHNICAL_CLAIM_PATTERNS = [
  /\bv?\d+\.\d+(\.\d+)?\b/,              // version numbers
  /\b(as of|since|in version|introduced in)\b/i,
  /\b\d+(%|ms|s|kb|mb|gb)\b/i,           // metrics
  /\b(deprecated|removed|breaking change)\b/i,
  /\b(always|never|guaranteed|will (always|never))\b/i,
];

/**
 * Returns true if the result contains code blocks or code-like syntax.
 */
export function detectCodeInResponse(result: unknown): boolean {
  const text = joinForInspection(result);
  return CODE_PATTERNS.some((re) => re.test(text));
}

/**
 * Returns true if the result contains package install commands or import statements
 * referencing third-party packages.
 */
export function detectPackageRecommendationsInResponse(result: unknown): boolean {
  const text = joinForInspection(result);
  return PACKAGE_PATTERNS.some((re) => re.test(text));
}

/**
 * Returns true if the result contains technical claims (version numbers,
 * deprecation notes, statistics) that could be hallucinated.
 */
export function detectTechnicalClaimsInResponse(result: unknown): boolean {
  const text = joinForInspection(result);
  return TECHNICAL_CLAIM_PATTERNS.some((re) => re.test(text));
}

/**
 * Determine which verify mode to use (or null to skip).
 *
 * Priority rules:
 * 1. code_review → always 'code' (output may contain fixed code snippets)
 * 2. package_audit → always 'packages'
 * 3. Any tool that returns both code + packages → 'all'
 * 4. Code detected in output → 'code'
 * 5. Packages detected in output → 'packages'
 * 6. Technical claims detected in output → 'all' (facts + response check)
 * 7. Otherwise → null (skip verify)
 */
export function deriveVerifyMode(toolName: PublicToolName, result: unknown): VerifyMode {
  if (toolName === 'code_review') return 'code';
  if (toolName === 'package_audit') return 'packages';

  const hasCode = detectCodeInResponse(result);
  const hasPkgs = detectPackageRecommendationsInResponse(result);
  const hasClaims = detectTechnicalClaimsInResponse(result);

  if (hasCode && hasPkgs) return 'all';
  if (hasCode) return 'code';
  if (hasPkgs) return 'packages';
  if (hasClaims) return 'all';  // run facts + response governance check
  return null;
}
