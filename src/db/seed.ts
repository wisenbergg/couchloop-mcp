#!/usr/bin/env node
import { config } from 'dotenv';
import { initDatabase } from './client.js';
import { getSupabaseClient, throwOnError } from './supabase-helpers.js';
import { journeyDefinitions } from '../workflows/index.js';
import { logger } from '../utils/logger.js';

// Load environment variables
config({ path: '.env.local' });

async function seedDatabase() {
  try {
    logger.info('Starting database seed...');

    // Initialize database
    await initDatabase();
    const supabase = getSupabaseClient();

    // Insert journey definitions
    logger.info('Inserting journey definitions...');

    for (const journey of journeyDefinitions) {
      throwOnError(
        await supabase
          .from('journeys')
          .upsert(
            {
              slug: journey.slug,
              name: journey.name,
              description: journey.description,
              steps: journey.steps,
              estimated_minutes: journey.estimatedMinutes,
              tags: journey.tags,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'slug' },
          )
          .select(),
      );

      logger.info(`✓ Seeded journey: ${journey.name}`);
    }

    logger.info(`Successfully seeded ${journeyDefinitions.length} journeys`);

    logger.info('Database seed completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Database seed failed:', error);
    process.exit(1);
  }
}

// Run the seed if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase();
}

export { seedDatabase };
