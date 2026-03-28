import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import { logger } from '../utils/logger.js';

export function createJourneyStatusHandler(slug: string) {
  return async function getJourneyStatus() {
    try {
      const supabase = getSupabaseClient();

      // Get journey by slug
      const journey = throwOnError(
        await supabase
          .from('journeys')
          .select('*')
          .eq('slug', slug)
          .maybeSingle()
      );

      if (!journey) {
        return JSON.stringify({
          error: 'Journey not found',
          slug: slug,
        }, null, 2);
      }

      return JSON.stringify({
        id: journey.id,
        slug: journey.slug,
        name: journey.name,
        description: journey.description,
        estimated_minutes: journey.estimated_minutes,
        tags: journey.tags,
        steps: journey.steps,
        created_at: journey.created_at,
        updated_at: journey.updated_at,
      }, null, 2);
    } catch (error) {
      logger.error(`Error getting journey ${slug}:`, error);
      return JSON.stringify({
        error: 'Failed to get journey',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, null, 2);
    }
  };
}
