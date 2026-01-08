import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  index,
  boolean,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// User table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalId: text('external_id').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  preferences: jsonb('preferences').$type<{
    timezone?: string;
    preferredJourneyLength?: 'short' | 'medium' | 'long';
  }>().default({}),
});

// Journey templates table
export const journeys = pgTable('journeys', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  steps: jsonb('steps').$type<Array<{
    id: string;
    order: number;
    type: 'prompt' | 'checkpoint' | 'summary';
    content: {
      prompt?: string;
      checkpoint_key?: string;
      instructions?: string;
    };
    optional: boolean;
  }>>().notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull(),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Session table
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  journeyId: uuid('journey_id').references(() => journeys.id),
  status: varchar('status', { length: 20 }).notNull().$type<
    'active' | 'paused' | 'completed' | 'abandoned'
  >().default('active'),
  currentStep: integer('current_step').notNull().default(0),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  metadata: jsonb('metadata').default({}),
  threadId: text('thread_id'), // Shrink-chat thread ID
  lastSyncedAt: timestamp('last_synced_at'), // Last sync with shrink-chat
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_sessions_user_id').on(table.userId),
  statusIdx: index('idx_sessions_status').on(table.status),
  journeyIdIdx: index('idx_sessions_journey_id').on(table.journeyId),
  threadIdIdx: index('idx_sessions_thread_id').on(table.threadId),
}));

// Checkpoint table
export const checkpoints = pgTable('checkpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  stepId: text('step_id').notNull(),
  key: varchar('key', { length: 100 }).notNull(),
  value: jsonb('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionIdIdx: index('idx_checkpoints_session_id').on(table.sessionId),
  keyIdx: index('idx_checkpoints_key').on(table.key),
}));

// Insight table
export const insights = pgTable('insights', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  sessionId: uuid('session_id').references(() => sessions.id),
  content: text('content').notNull(),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_insights_user_id').on(table.userId),
  sessionIdIdx: index('idx_insights_session_id').on(table.sessionId),
}));

// OAuth clients table for registered applications
export const oauthClients = pgTable('oauth_clients', {
  clientId: varchar('client_id', { length: 255 }).primaryKey(),
  clientSecret: text('client_secret').notNull(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull().default(sql`ARRAY[]::text[]`),
  grantTypes: text('grant_types').array().notNull().default(sql`ARRAY['authorization_code']::text[]`),
  scopes: text('scopes').array().notNull().default(sql`ARRAY['read', 'write']::text[]`),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// OAuth tokens table for authentication
export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at').notNull(),
  scope: text('scope'),
  tokenType: varchar('token_type', { length: 50 }).notNull().default('Bearer'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_oauth_tokens_user_id').on(table.userId),
  accessTokenIdx: index('idx_oauth_tokens_access_token').on(table.accessToken),
}));

// Authorization codes for OAuth flow
export const authorizationCodes = pgTable('authorization_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 255 }).notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id),
  clientId: varchar('client_id', { length: 255 }).notNull(),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope'),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  codeIdx: index('idx_authorization_codes_code').on(table.code),
  userIdIdx: index('idx_authorization_codes_user_id').on(table.userId),
}));

// Thread mappings table for MCP-Shrink-chat integration
export const threadMappings = pgTable('thread_mappings', {
  id: text('id').primaryKey().$defaultFn(() => `tm_${crypto.randomUUID()}`),
  sessionId: uuid('session_id').references(() => sessions.id),
  threadId: text('thread_id').notNull(),
  source: varchar('source', { length: 20 }).notNull().$type<'mcp' | 'shrink-chat'>(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionIdIdx: index('idx_thread_mappings_session_id').on(table.sessionId),
  threadIdIdx: index('idx_thread_mappings_thread_id').on(table.threadId),
  createdAtIdx: index('idx_thread_mappings_created_at').on(table.createdAt),
}));

// Crisis events table for tracking crisis detections
export const crisisEvents = pgTable('crisis_events', {
  id: text('id').primaryKey().$defaultFn(() => `ce_${crypto.randomUUID()}`),
  sessionId: uuid('session_id').references(() => sessions.id),
  threadId: text('thread_id'),
  crisisLevel: integer('crisis_level').notNull(),
  response: text('response'),
  resources: jsonb('resources').default([]),
  escalationPath: text('escalation_path'),
  handled: boolean('handled').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionIdIdx: index('idx_crisis_events_session_id').on(table.sessionId),
  crisisLevelIdx: index('idx_crisis_events_crisis_level').on(table.crisisLevel),
  createdAtIdx: index('idx_crisis_events_created_at').on(table.createdAt),
}));

// Type exports for TypeScript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Journey = typeof journeys.$inferSelect;
export type NewJourney = typeof journeys.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Checkpoint = typeof checkpoints.$inferSelect;
export type NewCheckpoint = typeof checkpoints.$inferInsert;

export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;

export type OAuthToken = typeof oauthTokens.$inferSelect;
export type NewOAuthToken = typeof oauthTokens.$inferInsert;

export type AuthorizationCode = typeof authorizationCodes.$inferSelect;
export type NewAuthorizationCode = typeof authorizationCodes.$inferInsert;

export type ThreadMapping = typeof threadMappings.$inferSelect;
export type NewThreadMapping = typeof threadMappings.$inferInsert;

export type CrisisEvent = typeof crisisEvents.$inferSelect;
export type NewCrisisEvent = typeof crisisEvents.$inferInsert;