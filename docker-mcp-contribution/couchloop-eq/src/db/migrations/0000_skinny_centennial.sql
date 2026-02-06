CREATE TABLE IF NOT EXISTS "authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "authorization_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crisis_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" uuid,
	"thread_id" text,
	"crisis_level" integer NOT NULL,
	"response" text,
	"resources" jsonb DEFAULT '[]'::jsonb,
	"escalation_path" text,
	"handled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "governance_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid,
	"action_type" varchar(50) NOT NULL,
	"reason" text,
	"confidence_score" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "governance_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"checkpoint_id" uuid,
	"draft_response" text NOT NULL,
	"evaluation_results" jsonb NOT NULL,
	"intervention_applied" varchar(50),
	"final_response" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "governance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_type" varchar(50) NOT NULL,
	"criteria" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"action" varchar(20) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"content" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"steps" jsonb NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "journeys_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_clients" (
	"client_id" varchar(255) PRIMARY KEY NOT NULL,
	"client_secret" text NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"grant_types" text[] DEFAULT ARRAY['authorization_code']::text[] NOT NULL,
	"scopes" text[] DEFAULT ARRAY['read', 'write']::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_family_id" varchar(255),
	"access_token_hash" text,
	"refresh_token_hash" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp NOT NULL,
	"scope" text,
	"token_type" varchar(50) DEFAULT 'Bearer' NOT NULL,
	"revoked_at" timestamp,
	"revocation_reason" varchar(100),
	"client_id" varchar(255),
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"journey_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"thread_id" text,
	"last_synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" uuid,
	"thread_id" text NOT NULL,
	"source" varchar(20) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"is_test_account" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "users_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_authorization_codes_code" ON "authorization_codes" ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_authorization_codes_user_id" ON "authorization_codes" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_checkpoints_session_id" ON "checkpoints" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_checkpoints_key" ON "checkpoints" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crisis_events_session_id" ON "crisis_events" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crisis_events_crisis_level" ON "crisis_events" ("crisis_level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crisis_events_created_at" ON "crisis_events" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_audit_evaluation_id" ON "governance_audit_log" ("evaluation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_audit_action_type" ON "governance_audit_log" ("action_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_audit_created_at" ON "governance_audit_log" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_evaluations_session_id" ON "governance_evaluations" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_evaluations_intervention" ON "governance_evaluations" ("intervention_applied");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_evaluations_created_at" ON "governance_evaluations" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_rules_rule_type" ON "governance_rules" ("rule_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_rules_active" ON "governance_rules" ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_governance_rules_priority" ON "governance_rules" ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insights_user_id" ON "insights" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insights_session_id" ON "insights" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_user_id" ON "oauth_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_access_token" ON "oauth_tokens" ("access_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_access_hash" ON "oauth_tokens" ("access_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_refresh_hash" ON "oauth_tokens" ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_family_id" ON "oauth_tokens" ("token_family_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_revoked_at" ON "oauth_tokens" ("revoked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_status" ON "sessions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_journey_id" ON "sessions" ("journey_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_thread_id" ON "sessions" ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_mappings_session_id" ON "thread_mappings" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_mappings_thread_id" ON "thread_mappings" ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_mappings_created_at" ON "thread_mappings" ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crisis_events" ADD CONSTRAINT "crisis_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_audit_log" ADD CONSTRAINT "governance_audit_log_evaluation_id_governance_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "governance_evaluations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_evaluations" ADD CONSTRAINT "governance_evaluations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_evaluations" ADD CONSTRAINT "governance_evaluations_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "checkpoints"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insights" ADD CONSTRAINT "insights_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_mappings" ADD CONSTRAINT "thread_mappings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
