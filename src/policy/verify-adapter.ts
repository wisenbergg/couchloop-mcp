/**
 * Policy Layer — Internal Verify Adapter
 *
 * Calls handleVerify without going through the MCP dispatcher.
 * Used by runToolWithPolicy when deriveVerifyMode returns non-null.
 *
 * The adapter extracts a text representation from the raw handler result, runs
 * the appropriate verify check, and returns the verify result. If verify fails
 * (issues found), the normalizer will surface this on the outer response.
 */

import { handleVerify } from '../tools/verify.js';
import type { VerifyMode } from './types.js';

interface VerifyAdapterResult {
  passed: boolean;
  /** true when the adapter itself threw — distinguishes "verify found issues" from "verify crashed" */
  verifyError: boolean;
  verify_output: unknown;
  /** Content extracted from the raw result and passed to verify */
  content_inspected: string;
}

/**
 * Extract a string representation from a raw tool result suitable for verify.
 * Prefers `fixed_code`, `corrected`, `recommendations`, `summary`, then
 * falls back to JSON stringification of the full result (capped at 8 KB).
 */
function extractContent(result: unknown): string {
  if (typeof result === 'string') return result.slice(0, 8_000);

  if (result !== null && typeof result === 'object') {
    const r = result as Record<string, unknown>;

    // Prefer fields that contain substantive output content
    const candidates: (keyof typeof r)[] = [
      'fixed_code',
      'corrected_code',
      'recommendations',
      'summary',
      'content',
      'message',
      'output',
    ];
    for (const key of candidates) {
      if (typeof r[key] === 'string' && (r[key] as string).length > 0) {
        return (r[key] as string).slice(0, 8_000);
      }
    }
  }

  try {
    return JSON.stringify(result).slice(0, 8_000);
  } catch {
    return '';
  }
}

/**
 * Run a verify check against the content extracted from `rawResult`.
 *
 * Returns `passed=true` when verify finds no issues (or when the content is
 * too short to be worth checking). Never throws — failures are surfaced as
 * `passed=false` with the error detail in `verify_output`.
 */
export async function internalVerifyAdapter(
  rawResult: unknown,
  mode: VerifyMode,
): Promise<VerifyAdapterResult> {
  const content = extractContent(rawResult);

  if (!content || content.length < 20) {
    return { passed: true, verifyError: false, verify_output: null, content_inspected: content };
  }

  try {
    const verifyOutput = await handleVerify({
      type: mode,   // mode is always non-null here (caller guards)
      content,
    });

    const passed =
      verifyOutput !== null &&
      typeof verifyOutput === 'object' &&
      (verifyOutput as Record<string, unknown>).verified === true;

    return { passed, verifyError: false, verify_output: verifyOutput, content_inspected: content };
  } catch (err) {
    return {
      passed: false,
      verifyError: true,
      verify_output: {
        success: false,
        error: err instanceof Error ? err.message : 'Verify adapter error',
      },
      content_inspected: content,
    };
  }
}
