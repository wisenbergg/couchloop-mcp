import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';

export async function getSessionSummary() {
  try {
    const supabase = getSupabaseClient();

    // NOTE: Resources in MCP don't receive parameters, so we can't pass auth context.
    // Using a mock user ID for now. This will be addressed when we implement
    // a proper session store or modify the MCP server to maintain user context.
    const mockUserId = 'usr_' + nanoid();
    const user = throwOnError(
      await supabase
        .from('users')
        .select('*')
        .eq('external_id', mockUserId)
        .maybeSingle()
    );

    if (!user) {
      return JSON.stringify({
        active: false,
        message: 'No user found',
      }, null, 2);
    }

    // Get active session
    const activeSession = throwOnError(
      await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('last_active_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    if (!activeSession) {
      return JSON.stringify({
        active: false,
        message: 'No active session',
      }, null, 2);
    }

    // Get journey if linked
    let journey: Record<string, unknown> | null = null;
    let currentStep = null;
    if (activeSession.journey_id) {
      journey = throwOnError(
        await supabase
          .from('journeys')
          .select('*')
          .eq('id', activeSession.journey_id)
          .maybeSingle()
      );

      if (journey && journey.steps && (journey.steps as unknown[])[activeSession.current_step]) {
        currentStep = (journey.steps as unknown[])[activeSession.current_step];
      }
    }

    // Get checkpoints
    const sessionCheckpoints = throwOnError(
      await supabase
        .from('checkpoints')
        .select('*')
        .eq('session_id', activeSession.id)
        .order('created_at', { ascending: true })
    );

    return JSON.stringify({
      active: true,
      session: {
        id: activeSession.id,
        status: activeSession.status,
        started_at: activeSession.started_at,
        last_active_at: activeSession.last_active_at,
        current_step_index: activeSession.current_step,
      },
      journey: journey ? {
        name: journey.name,
        slug: journey.slug,
        total_steps: (journey.steps as unknown[] | null)?.length || 0,
      } : null,
      current_step: currentStep,
      checkpoints: (sessionCheckpoints ?? []).map((c: Record<string, unknown>) => ({
        key: c.key,
        created_at: c.created_at,
      })),
    }, null, 2);
  } catch (error) {
    logger.error('Error getting session summary:', error);
    return JSON.stringify({
      error: 'Failed to get session summary',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, null, 2);
  }
}
