import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import type { Session, Journey, Checkpoint, User } from '../db/schema.js';
import { ListJourneysSchema, GetJourneyStatusSchema } from '../types/journey.js';
import { extractUserFromContext } from '../types/auth.js';
import { handleError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export async function listJourneys(args: unknown) {
  try {
    const input = ListJourneysSchema.parse(args);
    const supabase = getSupabaseClient();

    // Query journeys
    let availableJourneys: Journey[];

    // Filter by tag if provided
    if (input.tag) {
      availableJourneys = throwOnError(
        await supabase
          .from('journeys')
          .select('*')
          .contains('tags', [input.tag]),
      ) ?? [];
    } else {
      availableJourneys = throwOnError(
        await supabase
          .from('journeys')
          .select('*'),
      ) ?? [];
    }

    return {
      journeys: availableJourneys.map(j => ({
        id: j.id,
        slug: j.slug,
        name: j.name,
        description: j.description,
        estimated_minutes: j.estimated_minutes,
        tags: j.tags,
        step_count: j.steps?.length || 0,
      })),
      count: availableJourneys.length,
    };
  } catch (error) {
    logger.error('Error listing journeys:', error);
    return handleError(error);
  }
}

export async function getJourneyStatus(args: unknown) {
  try {
    const input = GetJourneyStatusSchema.parse(args);
    const supabase = getSupabaseClient();

    // Resolve calling user for ownership check
    const externalUserId = await extractUserFromContext(input.auth);
    const user = throwOnError(
      await supabase
        .from('users')
        .select('id')
        .eq('external_id', externalUserId)
        .maybeSingle(),
    ) as Pick<User, 'id'> | null;

    // Get session — scoped to this user
    let sessionQuery = supabase
      .from('sessions')
      .select('*')
      .eq('id', input.session_id);

    if (user) {
      sessionQuery = sessionQuery.eq('user_id', user.id);
    }

    const session = throwOnError(
      await sessionQuery.maybeSingle(),
    ) as Session | null;

    if (!session) {
      throw new NotFoundError('Session', input.session_id);
    }

    // Get journey if linked
    let journey: Journey | null = null;
    const progress = {
      current_step: session.current_step,
      total_steps: 0,
      percent_complete: 0,
    };

    if (session.journey_id) {
      journey = throwOnError(
        await supabase
          .from('journeys')
          .select('*')
          .eq('id', session.journey_id)
          .maybeSingle(),
      ) as Journey | null;

      if (journey && journey.steps) {
        progress.total_steps = journey.steps.length;
        progress.percent_complete = journey.steps.length > 0
          ? Math.round((session.current_step / journey.steps.length) * 100)
          : 0;
      }
    }

    // Get checkpoints
    const sessionCheckpoints = throwOnError(
      await supabase
        .from('checkpoints')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true }),
    ) as Checkpoint[];

    // Calculate time elapsed
    const startTime = new Date(session.started_at).getTime();
    const currentTime = Date.now();
    const timeElapsedMinutes = Math.round((currentTime - startTime) / (1000 * 60));

    return {
      session: {
        id: session.id,
        status: session.status,
        started_at: session.started_at,
        last_active_at: session.last_active_at,
        completed_at: session.completed_at,
      },
      journey: journey ? {
        id: journey.id,
        name: journey.name,
        slug: journey.slug,
        estimated_minutes: journey.estimated_minutes,
      } : null,
      progress: progress,
      checkpoints: sessionCheckpoints.map(c => ({
        id: c.id,
        key: c.key,
        created_at: c.created_at,
      })),
      time_elapsed_minutes: timeElapsedMinutes,
    };
  } catch (error) {
    logger.error('Error getting journey status:', error);
    return handleError(error);
  }
}
