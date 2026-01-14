import { pgTable, index, foreignKey, pgEnum, uuid, text, varchar, jsonb, timestamp, unique, boolean, integer } from "drizzle-orm/pg-core"
  import { sql } from "drizzle-orm"

export const aalLevel = pgEnum("aal_level", ['aal3', 'aal2', 'aal1'])
export const codeChallengeMethod = pgEnum("code_challenge_method", ['plain', 's256'])
export const factorStatus = pgEnum("factor_status", ['verified', 'unverified'])
export const factorType = pgEnum("factor_type", ['phone', 'webauthn', 'totp'])
export const oauthAuthorizationStatus = pgEnum("oauth_authorization_status", ['expired', 'denied', 'approved', 'pending'])
export const oauthClientType = pgEnum("oauth_client_type", ['confidential', 'public'])
export const oauthRegistrationType = pgEnum("oauth_registration_type", ['manual', 'dynamic'])
export const oauthResponseType = pgEnum("oauth_response_type", ['code'])
export const oneTimeTokenType = pgEnum("one_time_token_type", ['phone_change_token', 'email_change_token_current', 'email_change_token_new', 'recovery_token', 'reauthentication_token', 'confirmation_token'])
export const action = pgEnum("action", ['ERROR', 'TRUNCATE', 'DELETE', 'UPDATE', 'INSERT'])
export const equalityOp = pgEnum("equality_op", ['in', 'gte', 'gt', 'lte', 'lt', 'neq', 'eq'])
export const buckettype = pgEnum("buckettype", ['VECTOR', 'ANALYTICS', 'STANDARD'])


export const checkpoints = pgTable("checkpoints", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull().references(() => sessions.id),
	stepId: text("step_id").notNull(),
	key: varchar("key", { length: 100 }).notNull(),
	value: jsonb("value").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idxCheckpointsKey: index("idx_checkpoints_key").on(table.key),
		idxCheckpointsSessionId: index("idx_checkpoints_session_id").on(table.sessionId),
	}
});

export const authorizationCodes = pgTable("authorization_codes", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	code: varchar("code", { length: 255 }).notNull(),
	userId: uuid("user_id").notNull().references(() => users.id),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	redirectUri: text("redirect_uri").notNull(),
	scope: text("scope"),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	used: boolean("used").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idxAuthorizationCodesCode: index("idx_authorization_codes_code").on(table.code),
		idxAuthorizationCodesUserId: index("idx_authorization_codes_user_id").on(table.userId),
		authorizationCodesCodeUnique: unique("authorization_codes_code_unique").on(table.code),
	}
});

export const journeys = pgTable("journeys", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	slug: varchar("slug", { length: 100 }).notNull(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	steps: jsonb("steps").notNull(),
	estimatedMinutes: integer("estimated_minutes").notNull(),
	tags: text("tags").default('RRAY[').array().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		journeysSlugUnique: unique("journeys_slug_unique").on(table.slug),
	}
});

export const oauthTokens = pgTable("oauth_tokens", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull().references(() => users.id),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token"),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	scope: text("scope"),
	tokenType: varchar("token_type", { length: 50 }).default('Bearer'::character varying).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idxOauthTokensAccessToken: index("idx_oauth_tokens_access_token").on(table.accessToken),
		idxOauthTokensUserId: index("idx_oauth_tokens_user_id").on(table.userId),
	}
});

export const threadMappings = pgTable("thread_mappings", {
	id: text("id").primaryKey().notNull(),
	sessionId: uuid("session_id").references(() => sessions.id),
	threadId: text("thread_id").notNull(),
	source: varchar("source", { length: 20 }).notNull(),
	metadata: jsonb("metadata").default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idxThreadMappingsCreatedAt: index("idx_thread_mappings_created_at").on(table.createdAt),
		idxThreadMappingsSessionId: index("idx_thread_mappings_session_id").on(table.sessionId),
		idxThreadMappingsThreadId: index("idx_thread_mappings_thread_id").on(table.threadId),
	}
});

export const crisisEvents = pgTable("crisis_events", {
	id: text("id").primaryKey().notNull(),
	sessionId: uuid("session_id").references(() => sessions.id),
	threadId: text("thread_id"),
	crisisLevel: integer("crisis_level").notNull(),
	response: text("response"),
	resources: jsonb("resources").default([]),
	escalationPath: text("escalation_path"),
	handled: boolean("handled").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idxCrisisEventsCreatedAt: index("idx_crisis_events_created_at").on(table.createdAt),
		idxCrisisEventsCrisisLevel: index("idx_crisis_events_crisis_level").on(table.crisisLevel),
		idxCrisisEventsSessionId: index("idx_crisis_events_session_id").on(table.sessionId),
	}
});

export const insights = pgTable("insights", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull().references(() => users.id),
	sessionId: uuid("session_id").references(() => sessions.id),
	content: text("content").notNull(),
	tags: text("tags").default('RRAY[').array().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idxInsightsSessionId: index("idx_insights_session_id").on(table.sessionId),
		idxInsightsUserId: index("idx_insights_user_id").on(table.userId),
	}
});

export const oauthClients = pgTable("oauth_clients", {
	clientId: varchar("client_id", { length: 255 }).primaryKey().notNull(),
	clientSecret: text("client_secret").notNull(),
	name: text("name").notNull(),
	redirectUris: text("redirect_uris").default('RRAY[').array().notNull(),
	grantTypes: text("grant_types").default(ARRAY['authorization_code'::text]).array().notNull(),
	scopes: text("scopes").default(ARRAY['read'::text, 'write'::text]).array().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull().references(() => users.id),
	journeyId: uuid("journey_id").references(() => journeys.id),
	status: varchar("status", { length: 20 }).default('active'::character varying).notNull(),
	currentStep: integer("current_step").default(0).notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }).defaultNow().notNull(),
	lastActiveAt: timestamp("last_active_at", { mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	metadata: jsonb("metadata").default({}),
	threadId: text("thread_id"),
	lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => {
	return {
		idxSessionsJourneyId: index("idx_sessions_journey_id").on(table.journeyId),
		idxSessionsStatus: index("idx_sessions_status").on(table.status),
		idxSessionsThreadId: index("idx_sessions_thread_id").on(table.threadId),
		idxSessionsUserId: index("idx_sessions_user_id").on(table.userId),
	}
});

export const users = pgTable("users", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	externalId: text("external_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	preferences: jsonb("preferences").default({}),
},
(table) => {
	return {
		usersExternalIdUnique: unique("users_external_id_unique").on(table.externalId),
	}
});