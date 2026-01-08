#!/usr/bin/env node
import { config } from 'dotenv';
import { initDatabase, getDb, closeDatabase } from './client.js';
import { journeys } from './schema.js';
import { journeyDefinitions } from '../workflows/index.js';
import { logger } from '../utils/logger.js';

// Load environment variables
config({ path: '.env.local' });

async function seedDatabase() {
  try {
    logger.info('Starting database seed...');

    // Initialize database
    await initDatabase();
    const db = getDb();

    // Insert journey definitions
    logger.info('Inserting journey definitions...');

    for (const journey of journeyDefinitions) {
      await db
        .insert(journeys)
        .values({
          slug: journey.slug,
          name: journey.name,
          description: journey.description,
          steps: journey.steps,
          estimatedMinutes: journey.estimatedMinutes,
          tags: journey.tags,
        })
        .onConflictDoUpdate({
          target: journeys.slug,
          set: {
            name: journey.name,
            description: journey.description,
            steps: journey.steps,
            estimatedMinutes: journey.estimatedMinutes,
            tags: journey.tags,
            updatedAt: new Date(),
          },
        });

      logger.info(`✓ Seeded journey: ${journey.name}`);
    }

    logger.info(`Successfully seeded ${journeyDefinitions.length} journeys`);

    // Close database connection
    await closeDatabase();

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