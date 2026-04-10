-- Migration: Add missing indexes and foreign key constraints
-- Addresses findings from system audit (April 2026)

-- 1. Missing index on governance_evaluations.checkpoint_id (has FK but no index)
CREATE INDEX IF NOT EXISTS "idx_governance_evaluations_checkpoint_id"
  ON "governance_evaluations" ("checkpoint_id");

-- 2. Missing FK constraint: oauth_tokens.client_id -> oauth_clients.client_id
ALTER TABLE "oauth_tokens"
  ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Missing index on oauth_tokens.client_id for FK join performance
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_client_id"
  ON "oauth_tokens" ("client_id");

-- 4. Missing FK constraint: authorization_codes.client_id -> oauth_clients.client_id
ALTER TABLE "authorization_codes"
  ADD CONSTRAINT "authorization_codes_client_id_oauth_clients_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Missing index on authorization_codes.client_id for FK join performance
CREATE INDEX IF NOT EXISTS "idx_authorization_codes_client_id"
  ON "authorization_codes" ("client_id");
