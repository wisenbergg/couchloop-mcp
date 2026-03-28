/**
 * Database type definitions.
 *
 * These interfaces match the PostgreSQL tables in Supabase.
 * All property names use snake_case to match actual column names.
 */

// ── Core Domain ────────────────────────────────────────────────

export interface User {
  id: string;
  external_id: string;
  is_test_account: boolean;
  created_at: string;
  updated_at: string;
  preferences: {
    timezone?: string;
    preferredJourneyLength?: 'short' | 'medium' | 'long';
  } | null;
}

export interface JourneyStep {
  id: string;
  order: number;
  type: 'prompt' | 'checkpoint' | 'summary';
  content: {
    prompt?: string;
    checkpoint_key?: string;
    instructions?: string;
  };
  optional: boolean;
}

export interface Journey {
  id: string;
  slug: string;
  name: string;
  description: string;
  steps: JourneyStep[];
  estimated_minutes: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  journey_id: string | null;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  current_step: number;
  started_at: string;
  last_active_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
  thread_id: string | null;
  last_synced_at: string | null;
  updated_at: string;
}

export interface Checkpoint {
  id: string;
  session_id: string;
  step_id: string;
  key: string;
  value: unknown;
  created_at: string;
}

export interface Insight {
  id: string;
  user_id: string;
  session_id: string | null;
  content: string;
  tags: string[];
  created_at: string;
}

// ── OAuth ──────────────────────────────────────────────────────

export interface OAuthClient {
  client_id: string;
  client_secret: string;
  name: string;
  redirect_uris: string[];
  grant_types: string[];
  scopes: string[];
  created_at: string;
}

export interface OAuthToken {
  id: string;
  user_id: string;
  token_family_id: string | null;
  access_token_hash: string | null;
  refresh_token_hash: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string;
  scope: string | null;
  token_type: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  client_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthorizationCode {
  id: string;
  code: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  scope: string | null;
  expires_at: string;
  used: boolean;
  created_at: string;
}

// ── Integration ────────────────────────────────────────────────

export interface ThreadMapping {
  id: string;
  session_id: string | null;
  thread_id: string;
  source: 'mcp' | 'shrink-chat';
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CrisisEvent {
  id: string;
  session_id: string | null;
  thread_id: string | null;
  crisis_level: number;
  response: string | null;
  resources: unknown[];
  escalation_path: string | null;
  handled: boolean;
  created_at: string;
}

// ── Governance ─────────────────────────────────────────────────

export interface GovernanceEvaluation {
  id: string;
  session_id: string;
  checkpoint_id: string | null;
  draft_response: string;
  evaluation_results: {
    hallucination: { detected: boolean; confidence: number; patterns: string[] };
    inconsistency: { detected: boolean; confidence: number; patterns: string[] };
    toneDrift: { detected: boolean; confidence: number; patterns: string[] };
    unsafeReasoning: { detected: boolean; confidence: number; patterns: string[] };
    overallRisk: string;
    recommendedAction: string;
    confidence: number;
  };
  intervention_applied: string | null;
  final_response: string | null;
  created_at: string;
}

export interface GovernanceRule {
  id: string;
  rule_type: string;
  criteria: unknown;
  thresholds: unknown;
  action: string;
  active: boolean;
  priority: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface GovernanceAuditLog {
  id: string;
  evaluation_id: string | null;
  action_type: string;
  reason: string | null;
  confidence_score: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ── Deprecated type aliases (backward compat during migration) ──

export type NewUser = Partial<User>;
export type NewSession = Partial<Session>;
export type NewCheckpoint = Partial<Checkpoint>;
export type NewInsight = Partial<Insight>;
export type NewOAuthToken = Partial<OAuthToken>;
export type NewAuthorizationCode = Partial<AuthorizationCode>;
export type NewThreadMapping = Partial<ThreadMapping>;
export type NewCrisisEvent = Partial<CrisisEvent>;
export type NewGovernanceEvaluation = Partial<GovernanceEvaluation>;
export type NewGovernanceRule = Partial<GovernanceRule>;
export type NewGovernanceAuditLog = Partial<GovernanceAuditLog>;
