import { config } from 'dotenv';
import { vi } from 'vitest';

// Load test environment variables
config({ path: '.env.test' });

// Set default environment variables for testing
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/couchloop_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-min-32-characters-for-testing';
process.env.ENABLE_SHRINK_CHAT_INTEGRATION = 'false';
process.env.FALLBACK_TO_LOCAL_PROCESSING = 'true';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Mock logger to avoid console output during tests
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Global test utilities
export const testUtils = {
  generateTestId: () => `test_${Date.now()}_${Math.random().toString(36).substring(7)}`,

  waitFor: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  createMockUser: () => ({
    id: 'test-user-id',
    externalId: 'test-external-id',
    preferences: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }),

  createMockSession: () => ({
    id: 'test-session-id',
    userId: 'test-user-id',
    status: 'active' as const,
    currentStep: 0,
    metadata: {},
    threadId: null,
    journeyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: new Date(),
  }),

  createMockJourney: () => ({
    id: 'test-journey-id',
    slug: 'test-journey',
    name: 'Test Journey',
    description: 'A test journey',
    estimatedMinutes: 10,
    tags: ['test'],
    steps: [
      {
        type: 'prompt',
        content: { prompt: 'Step 1' },
        optional: false,
      },
      {
        type: 'checkpoint',
        content: { key: 'checkpoint1' },
        optional: false,
      },
    ],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
};