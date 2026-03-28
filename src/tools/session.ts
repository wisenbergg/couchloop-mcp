import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import type { Session, Journey, User, Checkpoint } from '../db/schema.js';
import { CreateSessionSchema, ResumeSessionSchema } from '../types/session.js';
import { extractUserFromContext } from '../types/auth.js';
import { handleError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export async function createSession(args: unknown) {
  try {
    const input = CreateSessionSchema.parse(args);
    const supabase = getSupabaseClient();

    // Extract user ID from auth context or generate anonymous user
    const externalUserId = await extractUserFromContext(input.auth);

    const user = throwOnError(
      await supabase
        .from('users')
        .upsert(
          {
            external_id: externalUserId,
            preferences: {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'external_id' },
        )
        .select()
        .single(),
    ) as User;

    // Look up journey if specified
    let journey: Journey | null = null;
    let currentStep = null;
    if (input.journey_slug) {
      const foundJourney = throwOnError(
        await supabase
          .from('journeys')
          .select('*')
          .eq('slug', input.journey_slug)
          .maybeSingle(),
      ) as Journey | null;

      if (!foundJourney) {
        throw new NotFoundError('Journey with slug', input.journey_slug);
      }

      journey = foundJourney;
      // Get first step
      if (journey.steps && journey.steps.length > 0) {
        currentStep = journey.steps[0];
      }
    }

    // Create new session
    const session = throwOnError(
      await supabase
        .from('sessions')
        .insert({
          user_id: user.id,
          journey_id: journey?.id || null,
          status: 'active',
          current_step: 0,
          metadata: { context: input.context },
        })
        .select()
        .single(),
    ) as Session;

    logger.info(`Created new session: ${session.id}`);

    return {
      session_id: session.id,
      journey: journey,
      current_step: currentStep,
      message: journey
        ? `Started ${journey.name}. ${currentStep?.content?.prompt || ''}`
        : 'Started freeform session.',
    };
  } catch (error) {
    logger.error('Error creating session:', error);
    return handleError(error);
  }
}

export async function resumeSession(args: unknown) {
  try {
    const input = ResumeSessionSchema.parse(args);
    const supabase = getSupabaseClient();

    // Find session to resume
    let session: Session | null = null;

    if (input.session_id) {
      // Direct session lookup - skip user validation
      // This allows resuming sessions when MCP clients don't maintain consistent user context
      session = throwOnError(
        await supabase
          .from('sessions')
          .select('*')
          .eq('id', input.session_id)
          .maybeSingle(),
      ) as Session | null;

      if (!session) {
        throw new NotFoundError('Session with ID', input.session_id);
      }
    } else {
      // Resume most recent session - requires user context
      // Extract user ID from auth context or generate anonymous user
      const externalUserId = await extractUserFromContext(input.auth);
      const user = throwOnError(
        await supabase
          .from('users')
          .select('*')
          .eq('external_id', externalUserId)
          .maybeSingle(),
      ) as User | null;

      if (!user) {
        // Create user if doesn't exist
        throwOnError(
          await supabase
            .from('users')
            .insert({
              external_id: externalUserId,
              preferences: {},
            })
            .select()
            .single(),
        );

        return {
          message: 'No previous sessions found for this user. Please create a new session.',
          session: null,
        };
      }

      // Get most recent pausable session for this user
      session = throwOnError(
        await supabase
          .from('sessions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'paused')
          .order('last_active_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ) as Session | null;

      if (!session) {
        throw new NotFoundError('Session to resume for user');
      }
    }

    // Get journey if linked
    let journey: Journey | null = null;
    let currentStep = null;
    if (session.journey_id) {
      journey = throwOnError(
        await supabase
          .from('journeys')
          .select('*')
          .eq('id', session.journey_id)
          .maybeSingle(),
      ) as Journey | null;

      if (journey && journey.steps && journey.steps[session.current_step]) {
        currentStep = journey.steps[session.current_step];
      }
    }

    // Get existing checkpoints
    const existingCheckpoints = throwOnError(
      await supabase
        .from('checkpoints')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true }),
    ) as Checkpoint[];

    // Update session status to active
    throwOnError(
      await supabase
        .from('sessions')
        .update({
          status: 'active',
          last_active_at: new Date().toISOString(),
        })
        .eq('id', session.id)
        .select(),
    );

    logger.info(`Resumed session: ${session.id}`);

    return {
      session: session,
      journey: journey,
      current_step: currentStep,
      checkpoints: existingCheckpoints,
      message: `Resumed session. ${currentStep?.content?.prompt || 'Continue where you left off.'}`,
    };
  } catch (error) {
    logger.error('Error resuming session:', error);
    return handleError(error);
  }
}
