/**
 * Correction Flow — Stateful error correction for AI mistakes.
 *
 * State machine:
 *   PENDING_ACKNOWLEDGMENT → user confirms issue → PENDING_FIX_APPROVAL → user approves fix → APPLIED
 *                          → user says "no"     → DISMISSED (ask user to explain)
 *
 * Memory auto-save happens at PENDING_FIX_APPROVAL (after user confirms the issue is correct),
 * not at detection time — because until the user confirms, we don't know if we caught the right problem.
 */

import { handleSmartContext } from './smart-context.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export enum CorrectionState {
  PENDING_ACKNOWLEDGMENT = 'pending_acknowledgment',
  PENDING_FIX_APPROVAL = 'pending_fix_approval',
  APPLIED = 'applied',
  DISMISSED = 'dismissed',
}

export interface CorrectionEntry {
  id: string;
  state: CorrectionState;
  created_at: string;
  issues_detected: string[];
  proposed_fixes: string[];
  verified_content: string;
  fixed_code?: string;
  user_confirmed_issue: boolean;
  user_approved_fix: boolean;
  saved_to_memory: boolean;
}

// ── In-memory store (scoped by MCP session, not DB session) ────────────────────

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
  fixedCode?: string,
): CorrectionEntry {
  const id = generateCorrectionId();
  const entry: CorrectionEntry = {
    id,
    state: CorrectionState.PENDING_ACKNOWLEDGMENT,
    created_at: new Date().toISOString(),
    issues_detected: issues,
    proposed_fixes: fixes,
    verified_content: content.substring(0, 500),
    fixed_code: fixedCode,
    user_confirmed_issue: false,
    user_approved_fix: false,
    saved_to_memory: false,
  };

  pendingCorrections.set(id, entry);
  logger.info(`[Correction] Created ${id} in PENDING_ACKNOWLEDGMENT state`);
  return entry;
}

/**
 * User confirms the detected issue is correct.
 * Transitions to PENDING_FIX_APPROVAL and auto-saves to memory.
 */
export async function confirmIssue(correctionId: string): Promise<CorrectionEntry> {
  const entry = pendingCorrections.get(correctionId);
  if (!entry) {
    throw new Error(`Correction ${correctionId} not found. It may have expired.`);
  }
  if (entry.state !== CorrectionState.PENDING_ACKNOWLEDGMENT) {
    throw new Error(`Correction ${correctionId} is in state ${entry.state}, expected ${CorrectionState.PENDING_ACKNOWLEDGMENT}.`);
  }

  entry.state = CorrectionState.PENDING_FIX_APPROVAL;
  entry.user_confirmed_issue = true;

  // Now that the user confirmed the issue is real, save to memory
  try {
    await handleSmartContext({
      content: `AI mistake confirmed by user: ${entry.issues_detected.join('; ')}. Original content: ${entry.verified_content}`,
      type: 'constraint',
      tags: ['ai-mistake', 'do-not-repeat'],
    });
    entry.saved_to_memory = true;
    logger.info(`[Correction] ${correctionId} → PENDING_FIX_APPROVAL, saved to memory`);
  } catch (err) {
    logger.warn(`[Correction] Failed to save mistake to memory:`, err);
  }

  return entry;
}

/**
 * User approves the proposed fix.
 * Transitions to APPLIED and cleans up.
 */
export function approveFix(correctionId: string): CorrectionEntry {
  const entry = pendingCorrections.get(correctionId);
  if (!entry) {
    throw new Error(`Correction ${correctionId} not found. It may have expired.`);
  }
  if (entry.state !== CorrectionState.PENDING_FIX_APPROVAL) {
    throw new Error(`Correction ${correctionId} is in state ${entry.state}, expected ${CorrectionState.PENDING_FIX_APPROVAL}.`);
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
 * Transitions to DISMISSED — the LLM should ask the user to explain.
 */
export function dismissCorrection(correctionId: string): CorrectionEntry {
  const entry = pendingCorrections.get(correctionId);
  if (!entry) {
    throw new Error(`Correction ${correctionId} not found. It may have expired.`);
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
 * Get the most recent pending correction (for cases where the user
 * responds without referencing a specific correction ID).
 */
export function getMostRecentPendingCorrection(): CorrectionEntry | undefined {
  let latest: CorrectionEntry | undefined;
  for (const entry of pendingCorrections.values()) {
    if (entry.state === CorrectionState.PENDING_ACKNOWLEDGMENT ||
        entry.state === CorrectionState.PENDING_FIX_APPROVAL) {
      if (!latest || entry.created_at > latest.created_at) {
        latest = entry;
      }
    }
  }
  return latest;
}

// ── Cleanup expired corrections (older than 30 minutes) ────────────────────────

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  let cleaned = 0;
  for (const [id, entry] of pendingCorrections.entries()) {
    if (new Date(entry.created_at).getTime() < cutoff) {
      pendingCorrections.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(`[Correction] Cleaned up ${cleaned} expired corrections`);
  }
}, 5 * 60 * 1000);
