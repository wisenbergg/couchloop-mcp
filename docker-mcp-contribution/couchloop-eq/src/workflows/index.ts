import { dailyReflection } from './definitions/daily-reflection.js';
import { gratitudePractice } from './definitions/gratitude-practice.js';
import { weeklyReview } from './definitions/weekly-review.js';
import { Journey } from '../types/journey.js';

// Export all journey definitions
export const journeyDefinitions: Journey[] = [
  dailyReflection,
  gratitudePractice,
  weeklyReview,
];

// Map for easy lookup by slug
export const journeysBySlug = new Map<string, Journey>(
  journeyDefinitions.map(j => [j.slug, j])
);

// Export individual journeys
export { dailyReflection, gratitudePractice, weeklyReview };