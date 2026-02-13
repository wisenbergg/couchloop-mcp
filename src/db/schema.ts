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
  isTestAccount: boolean('is_test_account').notNull().default(true),
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
  // Compound index for the hottest query: WHERE user_id=? AND status=? ORDER BY last_active_at DESC
  userStatusActiveIdx: index('idx_sessions_user_status_active').on(table.userId, table.status, table.lastActiveAt),
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
  // Covering index: every query filters sessionId + orders by createdAt
  sessionCreatedIdx: index('idx_checkpoints_session_created').on(table.sessionId, table.createdAt),
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
  // Covering index: all queries filter userId + order by createdAt DESC
  userCreatedIdx: index('idx_insights_user_created').on(table.userId, table.createdAt),
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
// Note: Advanced fields kept for database compatibility but not used
export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),

  // Token family tracking (unused - for advanced OAuth)
  tokenFamilyId: varchar('token_family_id', { length: 255 }),

  // Hash fields (unused - for advanced OAuth)
  accessTokenHash: text('access_token_hash'),
  refreshTokenHash: text('refresh_token_hash'),

  // Encrypted fields (unused - for advanced OAuth)
  accessTokenEncrypted: text('access_token_encrypted'),
  refreshTokenEncrypted: text('refresh_token_encrypted'),

  // Basic OAuth fields (actively used)
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),

  expiresAt: timestamp('expires_at').notNull(),
  scope: text('scope'),
  tokenType: varchar('token_type', { length: 50 }).notNull().default('Bearer'),

  // Revocation tracking (unused - for advanced OAuth)
  revokedAt: timestamp('revoked_at'),
  revocationReason: varchar('revocation_reason', { length: 100 }),

  // Security metadata
  clientId: varchar('client_id', { length: 255 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Only indexes for actively-used columns
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
}));

// Governance evaluations table - tracks all governance checks and interventions
export const governanceEvaluations = pgTable('governance_evaluations', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => sessions.id).notNull(),
  checkpointId: uuid('checkpoint_id').references(() => checkpoints.id),
  draftResponse: text('draft_response').notNull(),
  evaluationResults: jsonb('evaluation_results').$type<{
    hallucination: { detected: boolean; confidence: number; patterns: string[] };
    inconsistency: { detected: boolean; confidence: number; patterns: string[] };
    toneDrift: { detected: boolean; confidence: number; patterns: string[] };
    unsafeReasoning: { detected: boolean; confidence: number; patterns: string[] };
    overallRisk: string;
    recommendedAction: string;
    confidence: number;
  }>().notNull(),
  interventionApplied: varchar('intervention_applied', { length: 50 }),
  finalResponse: text('final_response'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionIdIdx: index('idx_governance_evaluations_session_id').on(table.sessionId),
}));

// Governance rules configuration table
export const governanceRules = pgTable('governance_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleType: varchar('rule_type', { length: 50 }).notNull(),
  criteria: jsonb('criteria').notNull(),
  thresholds: jsonb('thresholds').notNull(),
  action: varchar('action', { length: 20 }).notNull(), // block, modify, warn
  active: boolean('active').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (_table) => ({
  // Only 8 rows — full table scan is fine, no indexes needed
}));

// Governance audit log table - detailed record of all governance actions
export const governanceAuditLog = pgTable('governance_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  evaluationId: uuid('evaluation_id').references(() => governanceEvaluations.id),
  actionType: varchar('action_type', { length: 50 }).notNull(),
  reason: text('reason'),
  confidenceScore: integer('confidence_score'), // 0-100
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (_table) => ({
  // Insert-only table — no query indexes needed
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

export type GovernanceEvaluation = typeof governanceEvaluations.$inferSelect;
export type NewGovernanceEvaluation = typeof governanceEvaluations.$inferInsert;

export type GovernanceRule = typeof governanceRules.$inferSelect;
export type NewGovernanceRule = typeof governanceRules.$inferInsert;

export type GovernanceAuditLog = typeof governanceAuditLog.$inferSelect;
export type NewGovernanceAuditLog = typeof governanceAuditLog.$inferInsert;