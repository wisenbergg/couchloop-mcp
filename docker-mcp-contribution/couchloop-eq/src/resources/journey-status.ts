import { getDb } from '../db/client.js';
import { journeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export function createJourneyStatusHandler(slug: string) {
  return async function getJourneyStatus() {
    try {
      const db = getDb();

      // Get journey by slug
      const [journey] = await db
        .select()
        .from(journeys)
        .where(eq(journeys.slug, slug))
        .limit(1);

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
        estimated_minutes: journey.estimatedMinutes,
        tags: journey.tags,
        steps: journey.steps,
        created_at: journey.createdAt,
        updated_at: journey.updatedAt,
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