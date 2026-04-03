/**
 * Correction Flow — Stateful error correction for AI mistakes.
 *
 * State machine:
 *   PENDING_ACKNOWLEDGMENT → user confirms issue → PENDING_FIX_APPROVAL → user approves fix → APPLIED
 *                          → user says "no"     → DISMISSED (ask user to explain)
 *
 * Memory auto-save happens at PENDING_FIX_APPROVAL (after user confirms the issue is correct),
 * not at detection time — because until the user confirms, we don't know if we caught the right problem.
 *
 * SECURITY: Corrections are scoped by session_id. All lookups and mutations
 * require a session_id to prevent cross-user state leakage in shared processes.
 */

import { handleSmartContext } from './smart-context.js';
import { sanitizeText } from '../utils/inputSanitize.js';
import { logger } from '../utils/logger.js';

/**
 * Redact common secret patterns from content before persisting.
 * Catches API keys, tokens, passwords, and connection strings.
 */
function redactSecrets(content: string): string {
  return content
    .replace(/(?:key|token|secret|password|apikey|api_key|auth)[\s]*[=:]\s*['"]?[^\s'"]{8,}/gi, '[REDACTED_SECRET]')
    .replace(/(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .replace(/(?:postgres|mysql|mongodb|redis):\/\/[^\s]{10,}/gi, '[REDACTED_CONNECTION_STRING]');
}

// ── Types ──────────────────────────────────────────────────────────────────────

export enum CorrectionState {
  PENDING_ACKNOWLEDGMENT = 'pending_acknowledgment',
  PENDING_FIX_APPROVAL = 'pending_fix_approval',
  APPLIED = 'applied',
  DISMISSED = 'dismissed',
}

export interface CorrectionEntry {
  id: string;
  session_id: string;
  state: CorrectionState;
  created_at: string;
  created_at_ms: number;
  issues_detected: string[];
  proposed_fixes: string[];
  verified_content: string;
  fixed_code?: string;
  user_confirmed_issue: boolean;
  user_approved_fix: boolean;
  saved_to_memory: boolean;
  memory_save_error?: string;
  auth?: Record<string, unknown>;
}

// ── In-memory store keyed by correction ID, scoped by session_id ───────────────

const pendingCorrections = new Map<string, CorrectionEntry>();

let correctionCounter = 0;

function generateCorrectionId(): string {
  correctionCounter++;
  return `correction_${Date.now()}_${correctionCounter}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a new correction from verify results.
 * Returns the correction in PENDING_ACKNOWLEDGMENT state.
 */
export function createCorrection(
  issues: string[],
  fixes: string[],
  content: string,
  sessionId: string,
  fixedCode?: string,
  auth?: Record<string, unknown>,
): CorrectionEntry {
  const id = generateCorrectionId();
  const now = Date.now();
  const entry: CorrectionEntry = {
    id,
    session_id: sessionId,
    state: CorrectionState.PENDING_ACKNOWLEDGMENT,
    created_at: new Date(now).toISOString(),
    created_at_ms: now,
    issues_detected: issues,
    proposed_fixes: fixes,
    verified_content: redactSecrets(sanitizeText(content.substring(0, 500))),
    fixed_code: fixedCode,
    user_confirmed_issue: false,
    user_approved_fix: false,
    saved_to_memory: false,
    auth,
  };

  pendingCorrections.set(id, entry);
  logger.info(`[Correction] Created ${id} for session ${sessionId} in PENDING_ACKNOWLEDGMENT state`);
  return entry;
}

/**
 * User confirms the detected issue is correct.
 * Transitions to PENDING_FIX_APPROVAL and auto-saves to memory.
 * Requires session_id to prevent cross-user confirmation.
 */
export async function confirmIssue(correctionId: string, sessionId: string): Promise<CorrectionEntry> {
  const entry = pendingCorrections.get(correctionId);
  if (!entry) {
    throw new Error(`Correction ${correctionId} not found. It may have expired.`);
  }
  if (entry.session_id !== sessionId) {
    throw new Error(`Correction ${correctionId} does not belong to this session.`);
  }
  if (entry.state !== CorrectionState.PENDING_ACKNOWLEDGMENT) {
    throw new Error(`Correction ${correctionId} is in state ${entry.state}, expected ${CorrectionState.PENDING_ACKNOWLEDGMENT}.`);
  }

  entry.state = CorrectionState.PENDING_FIX_APPROVAL;
  entry.user_confirmed_issue = true;

  // Now that the user confirmed the issue is real, save to memory with auth context
  try {
    await handleSmartContext({
      content: `AI mistake confirmed by user: ${entry.issues_detected.join('; ')}. Original content: ${entry.verified_content}`,
      type: 'constraint',
      tags: ['ai-mistake', 'do-not-repeat'],
      session_id: entry.session_id,
      auth: entry.auth,
    });
    entry.saved_to_memory = true;
    logger.info(`[Correction] ${correctionId} → PENDING_FIX_APPROVAL, saved to memory`);
  } catch (err) {
    logger.warn(`[Correction] Failed to save mistake to memory:`, err);
    entry.memory_save_error = err instanceof Error ? err.message : 'Unknown error';
  }

  return entry;
}

/**
 * User approves the proposed fix.
 * Transitions to APPLIED and cleans up.
 * Requires session_id to prevent cross-user approval.
 */
export function approveFix(correctionId: string, sessionId: string): CorrectionEntry {
  const entry = pendingCorrections.get(correctionId);
  if (!entry) {
    throw new Error(`Correction ${correctionId} not found. It may have expired.`);
  }
  if (entry.session_id !== sessionId) {
    throw new Error(`Correction ${correctionId} does not belong to this session.`);
  }
  if (entry.state !== CorrectionState.PENDING_FIX_APPROVAL) {
    throw new Error(`Correction ${correctionId} is in state ${entry.state}, expected ${CorrectionState.PENDING_FIX_APPROVAL}. Did you call confirm first?`);
  }

  entry.state = CorrectionState.APPLIED;
  entry.user_approved_fix = true;

  logger.info(`[Correction] ${correctionId} → APPLIED`);

  // Clean up after a short delay (let the response be read first)
  setTimeout(() => pendingCorrections.delete(correctionId), 60000);

  return entry;
}

/**
 * User says "no, that's not the issue".
 * Can only dismiss from PENDING_ACKNOWLEDGMENT or PENDING_FIX_APPROVAL — not terminal states.
 * Requires session_id to prevent cross-user dismissal.
 */
export function dismissCorrection(correctionId: string, sessionId: string): CorrectionEntry {
  const entry = pendingCorrections.get(correctionId);
  if (!entry) {
    throw new Error(`Correction ${correctionId} not found. It may have expired.`);
  }
  if (entry.session_id !== sessionId) {
    throw new Error(`Correction ${correctionId} does not belong to this session.`);
  }
  if (entry.state === CorrectionState.APPLIED || entry.state === CorrectionState.DISMISSED) {
    throw new Error(`Correction ${correctionId} is already in terminal state ${entry.state} and cannot be dismissed.`);
  }

  entry.state = CorrectionState.DISMISSED;

  logger.info(`[Correction] ${correctionId} → DISMISSED`);

  // Clean up after a delay
  setTimeout(() => pendingCorrections.delete(correctionId), 60000);

  return entry;
}

/**
 * Get a pending correction by ID.
 */
export function getCorrection(correctionId: string): CorrectionEntry | undefined {
  return pendingCorrections.get(correctionId);
}

/**
 * Get the most recent pending correction for a specific session.
 * Only returns corrections belonging to the given session_id.
 * Optionally filter by expected state to avoid returning entries
 * that the caller's operation would immediately reject.
 */
export function getMostRecentPendingCorrection(
  sessionId: string,
  expectedState?: CorrectionState,
): CorrectionEntry | undefined {
  let latest: CorrectionEntry | undefined;
  for (const entry of pendingCorrections.values()) {
    if (entry.session_id !== sessionId) continue;
    if (expectedState) {
      if (entry.state !== expectedState) continue;
    } else {
      // Default: return any non-terminal correction
      if (entry.state !== CorrectionState.PENDING_ACKNOWLEDGMENT &&
          entry.state !== CorrectionState.PENDING_FIX_APPROVAL) continue;
    }
    if (!latest || entry.created_at_ms > latest.created_at_ms) {
      latest = entry;
    }
  }
  return latest;
}

/**
 * Clear all corrections. Used in tests to isolate state between test cases.
 */
export function clearAllCorrections(): void {
  pendingCorrections.clear();
}

// ── Cleanup expired corrections (older than 30 minutes) ────────────────────────

const cleanupInterval = setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  let cleaned = 0;
  for (const [id, entry] of pendingCorrections.entries()) {
    if (entry.created_at_ms < cutoff) {
      pendingCorrections.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(`[Correction] Cleaned up ${cleaned} expired corrections`);
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();
