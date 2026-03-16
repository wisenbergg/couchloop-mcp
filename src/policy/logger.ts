/**
 * Policy Layer — Policy Logger
 *
 * Emits exactly one structured PolicyLogEvent per wrapped tool call.
 */

import { logger } from '../utils/logger.js';
import type { PolicyLogEvent } from './types.js';

export const policyLogger = {
  log(event: PolicyLogEvent): void {
    const entry = {
      policy: true,
      tool: event.tool,
      routedVia: event.routedVia,
      sessionId: event.sessionId,
      durationMs: event.durationMs,
      verifyTriggered: event.verifyTriggered,
      verifyPassed: event.verifyPassed,
      sanitized: event.sanitized,
      blocked: event.blocked,
      partial: event.partial,
      guardNormalized: event.guardNormalized,
      ...(event.error ? { error: event.error } : {}),
    };

    if (event.level === 'error') {
      logger.error('[policy]', entry);
    } else if (event.level === 'warn') {
      logger.warn('[policy]', entry);
    } else {
      logger.info('[policy]', entry);
    }
  },
};
