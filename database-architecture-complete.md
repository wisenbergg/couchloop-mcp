# Complete Database Architecture Documentation

## System Overview

The system consists of two independent production databases serving different purposes:

1. **CouchLoop MCP Database**: Manages MCP (Model Context Protocol) sessions for ChatGPT/Claude integration
2. **Shrink-Chat Database**: Core AI therapy platform with user profiles, conversations, and memories

---

## 1. CouchLoop MCP Database

**Connection**: `postgresql://postgres.tvqjkrghxnxmgaatlnfn:ZBW4naq.unr8qgq*tyx@aws-1-us-east-2.pooler.supabase.com:6543/postgres`
**Host**: aws-1-us-east-2.pooler.supabase.com
**Purpose**: Session management for AI agents using Model Context Protocol

### Tables (10 total)

#### Core Session Management
1. **sessions** - Central table for MCP conversation sessions
   - id (UUID, PK)
   - user_id (UUID, FK → users.id)
   - journey_id (UUID, FK → journeys.id)
   - status (varchar: active|paused|completed|abandoned)
   - current_step (integer)
   - started_at, last_active_at, completed_at (timestamps)
   - metadata (JSONB - session context)
   - thread_id (text - external reference)
   - Referenced by: checkpoints, crisis_events, insights, thread_mappings

2. **checkpoints** - Progress markers within sessions
   - id (UUID, PK)
   - session_id (UUID, FK → sessions.id)
   - step_id (text)
   - key (varchar)
   - value (JSONB - checkpoint data)
   - created_at (timestamp)

3. **insights** - User reflections and learnings
   - id (UUID, PK)
   - user_id (UUID, FK → users.id)
   - session_id (UUID, FK → sessions.id, nullable)
   - content (text)
   - tags (text[])
   - created_at (timestamp)

#### User & Journey Management
4. **users** - MCP user accounts
   - id (UUID, PK)
   - external_id (text - links to external systems)
   - preferences (JSONB)
   - is_test_account (boolean)
   - created_at, updated_at (timestamps)

5. **journeys** - Pre-defined conversation templates
   - id (UUID, PK)
   - slug (varchar - URL-friendly identifier)
   - name, description (text)
   - steps (JSONB - journey structure)
   - estimated_minutes (integer)
   - tags (text[])
   - created_at, updated_at (timestamps)

#### Crisis Management
6. **crisis_events** - Crisis detection and response tracking
   - id (text, PK)
   - session_id (UUID, FK → sessions.id)
   - thread_id (text)
   - crisis_level (integer)
   - response (text)
   - resources (JSONB)
   - escalation_path (text)
   - handled (boolean)
   - created_at (timestamp)

#### OAuth & Authentication
7. **oauth_clients** - Registered OAuth clients
   - client_id (varchar, PK)
   - client_secret (text)
   - name (text)
   - redirect_uris, grant_types, scopes (text[])
   - created_at (timestamp)

8. **oauth_tokens** - OAuth access tokens
   - id (UUID, PK)
   - user_id (UUID, FK → users.id)
   - client_id (varchar)
   - access_token_encrypted, refresh_token_encrypted (text)
   - token_family_id (varchar - for refresh token rotation)
   - expires_at, revoked_at (timestamps)
   - ip_address, user_agent (tracking)

9. **authorization_codes** - OAuth authorization codes
   - id (UUID, PK)
   - code (varchar)
   - user_id (UUID, FK → users.id)
   - client_id (varchar)
   - redirect_uri (text)
   - expires_at (timestamp)
   - used (boolean)

#### Integration
10. **thread_mappings** - Maps MCP sessions to external threads
    - id (text, PK)
    - session_id (UUID, FK → sessions.id)
    - thread_id (text)
    - source (varchar - e.g., 'chatgpt', 'claude')
    - metadata (JSONB)
    - created_at (timestamp)

### Key Relationships
- **users** ← (1:many) → **sessions**
- **journeys** ← (1:many) → **sessions**
- **sessions** ← (1:many) → **checkpoints**
- **sessions** ← (1:many) → **crisis_events**
- **sessions** ← (1:many) → **insights**
- **sessions** ← (1:1) → **thread_mappings**
- **users** ← (1:many) → **oauth_tokens**
- **users** ← (1:many) → **authorization_codes**

---

## 2. Shrink-Chat Production Database

**Connection**: `postgresql://postgres.oqacztfskduxbstnmxnd:YB*-xLec393gb_@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
**Host**: aws-0-us-east-1.pooler.supabase.com
**Purpose**: Core AI therapy platform

### Tables (19 total)

#### Core Conversation System
1. **threads** - Conversation containers
   - id (UUID, PK)
   - created_at, updated_at (timestamps)

2. **messages** - Individual messages in conversations
   - id (UUID, PK)
   - thread_id (UUID, FK → threads.id)
   - user_id (UUID)
   - turn (integer - message sequence)
   - role (text: user|assistant|system)
   - content (text)
   - content_hash (text - deduplication)
   - idempotency_key (text)
   - metadata, conversation_metadata (JSONB)
   - created_at (timestamp)

3. **memory** - AI memory storage with vector embeddings
   - id (UUID, PK)
   - thread_id (UUID, FK → threads.id)
   - message_id (UUID)
   - author_role (text)
   - content, original_content (text)
   - summary (text)
   - embedding (vector - for similarity search)
   - salience (smallint - importance)
   - quality_score (integer)
   - tags (text[])
   - related_memory_ids (UUID[])
   - decay_rate (numeric)
   - consolidation_count (integer)
   - validation_passed (boolean)
   - metadata (JSONB)
   - created_at, last_accessed (timestamps)

#### User Management
4. **profiles** - User profiles with emotional state
   - id (UUID, PK)
   - user_id (UUID)
   - thread_id (UUID)
   - name (text)
   - password_hash (text)
   - emotional_tone, initial_emotional_tone (text[])
   - concerns (text[])
   - emotional_baseline (JSONB)
   - current_crisis_level, initial_crisis_level (text)
   - onboarding_completed, age_verified, parent_consent (boolean)
   - birth_year (integer)
   - parent_email, recovery_email_hash (text)
   - stripe_customer_id, subscription_id (text - billing)
   - subscription_status (text)
   - trial_ends_at, current_period_end (timestamps)
   - auth_method (text)

5. **sso_identities** - Single Sign-On identities
   - User authentication via external providers

6. **refresh_tokens** - Authentication refresh tokens
   - Token management for session persistence

#### Journaling System
7. **journal_entries** - User journal entries
   - id (UUID, PK)
   - user_id (UUID)
   - thread_id (UUID)
   - title, content (text)
   - mood, emotional_tone (varchar)
   - themes (text[])
   - is_private, is_deleted, shared_with_ai (boolean)
   - insights_extracted (boolean)
   - created_at, updated_at (timestamps)

8. **journal_insights** - AI-extracted insights from journals
   - Analysis and patterns from journal entries

9. **journal_idempotency** - Prevents duplicate journal operations
   - Ensures journal operations are idempotent

#### User Engagement
10. **commitments** - User commitments/goals
    - Tracking user therapeutic commitments

11. **user_feedback** - User feedback on sessions
    - Quality and satisfaction tracking

#### Safety & Monitoring
12. **risk_alerts** - Risk and crisis detection alerts
    - Critical safety monitoring

13. **audit_logs** - System audit trail
    - Complete audit logging for compliance

14. **profile_tone_history** - Emotional tone tracking over time
    - Historical emotional state analysis

15. **memory_metrics** - Memory system performance metrics
    - Analytics on memory retrieval and quality

#### Integration & Infrastructure
16. **stripe_webhook_events** - Stripe payment webhooks
    - Payment processing integration

17. **webhook_events** - General webhook processing
    - External system integrations

18. **password_reset_tokens** - Password reset management
    - Authentication recovery

19. **profiles_backup_before_user_id_fix** - Migration backup
    - Data migration safety backup

### Key Relationships
- **threads** ← (1:many) → **messages**
- **threads** ← (1:many) → **memory**
- **profiles.user_id** ← → **messages.user_id**
- **profiles.thread_id** ← → **threads.id**
- **journal_entries.user_id** ← → **profiles.user_id**
- **journal_entries.thread_id** ← → **threads.id**
- **messages.id** ← → **memory.message_id**

---

## Integration Points Between Databases

### 1. Thread Synchronization
- **CouchLoop**: `sessions.thread_id` and `thread_mappings.thread_id`
- **Shrink-Chat**: `threads.id`
- Used to link MCP sessions with Shrink-Chat conversations

### 2. User Identity
- **CouchLoop**: `users.external_id`
- **Shrink-Chat**: `profiles.user_id`
- External ID in MCP can reference Shrink-Chat user

### 3. Crisis Events
- **CouchLoop**: `crisis_events` table tracks crisis detection
- **Shrink-Chat**: `risk_alerts` and `profiles.current_crisis_level`
- Crisis information flows from Shrink-Chat to MCP for monitoring

### 4. API Integration
- **CouchLoop** calls **Shrink-Chat API** at:
  - `https://shrink-chat-wisenbergg-wisenberggs-projects.vercel.app`
- Endpoints for message processing, memory retrieval, crisis detection

---

## Data Flow Architecture

```
User (ChatGPT/Claude)
    ↓
CouchLoop MCP Server
    ├── Creates session in MCP DB
    ├── Generates thread_id
    ↓
Shrink-Chat API
    ├── Creates/updates thread in Shrink-Chat DB
    ├── Processes messages
    ├── Stores memories with embeddings
    ├── Performs crisis detection
    ↓
Response flows back through MCP
    ├── Updates checkpoints
    ├── Records insights
    └── Tracks crisis events
```

---

## Key Technical Details

### CouchLoop MCP Database
- **Session States**: active → paused → completed/abandoned
- **Journey System**: Pre-defined therapeutic workflows
- **OAuth Flow**: Full OAuth2 implementation for ChatGPT/Claude
- **Crisis Levels**: Integer scale for severity tracking

### Shrink-Chat Database
- **Vector Embeddings**: Using pgvector for semantic search
- **Memory Decay**: Implements forgetting curve with decay_rate
- **Emotional Tracking**: Arrays of emotional states over time
- **Subscription Management**: Stripe integration for payments
- **Age Verification**: Parental consent workflow for minors

### Performance Optimizations
- **Connection Pooling**: Both use Supabase pooler endpoints
- **Indexes**: Multiple indexes on foreign keys and search fields
- **JSONB**: Flexible metadata storage without schema changes
- **Vector Indexing**: Optimized for similarity search in memories

### Security Features
- **Encrypted Tokens**: OAuth tokens are encrypted at rest
- **Password Hashing**: Secure password storage in profiles
- **Audit Logging**: Complete audit trail in Shrink-Chat
- **SSL Required**: All connections use SSL
- **Token Rotation**: OAuth refresh token families prevent replay

---

## Environment Variables

### CouchLoop MCP (.env.local)
```
DATABASE_URL=postgresql://postgres.tvqjkrghxnxmgaatlnfn:...
SHRINK_CHAT_API_URL=https://shrink-chat-wisenbergg...
OAUTH_CLIENT_ID=couchloop_chatgpt
JWT_SECRET=...
```

### Shrink-Chat (production)
```
DATABASE_URL=postgresql://postgres.oqacztfskduxbstnmxnd:...
OPENAI_API_KEY=...
CHAT_MODEL=ft:gpt-4.1-2025-04-14:when-i-was:empathy-v5:BXN8XrVV
CRISIS_DETECTION_MODE=enhanced
```

---

## Current Statistics
- **CouchLoop MCP**: 428 sessions stored
- **Session Types**: Integration tests + real ChatGPT conversations
- **Most Recent Session**: January 15, 2026

This architecture enables stateful AI conversations with memory persistence, crisis detection, and therapeutic journey management across multiple AI platforms.