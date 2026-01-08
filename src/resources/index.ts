import { getSessionSummary } from './session-summary.js';
import { createJourneyStatusHandler } from './journey-status.js';
import { getUserContextResource } from './user-context.js';
import { logger } from '../utils/logger.js';

export async function setupResources() {
  const resources = [
    {
      definition: {
        uri: 'session://current',
        name: 'Current Session',
        description: 'The active session state, if any',
        mimeType: 'application/json',
      },
      handler: getSessionSummary
    },
    {
      definition: {
        uri: 'journey://daily-reflection',
        name: 'Daily Reflection Journey',
        description: 'Full journey definition including all steps',
        mimeType: 'application/json',
      },
      handler: createJourneyStatusHandler('daily-reflection')
    },
    {
      definition: {
        uri: 'journey://gratitude-practice',
        name: 'Gratitude Practice Journey',
        description: 'Full journey definition including all steps',
        mimeType: 'application/json',
      },
      handler: createJourneyStatusHandler('gratitude-practice')
    },
    {
      definition: {
        uri: 'journey://weekly-review',
        name: 'Weekly Review Journey',
        description: 'Full journey definition including all steps',
        mimeType: 'application/json',
      },
      handler: createJourneyStatusHandler('weekly-review')
    },
    {
      definition: {
        uri: 'context://user',
        name: 'User Context',
        description: 'User preferences and recent history',
        mimeType: 'application/json',
      },
      handler: getUserContextResource
    }
  ];

  logger.info(`Prepared ${resources.length} MCP resources`);
  return resources;
}