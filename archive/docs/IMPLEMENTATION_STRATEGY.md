# CouchLoop v1.x → v2.x Implementation Strategy
## Rapid Transformation to Behavioral Governance Layer

---

## Executive Summary

This document outlines the technical implementation strategy to evolve CouchLoop from its current v1.x architecture (session management with pass-through) to the target v2.x architecture (behavioral governance layer for LLMs).

**Current State (v1.x):**
- MCP server managing sessions, journeys, and checkpoints
- Pass-through messaging to shrink-chat API
- Post-generation crisis detection

**Target State (v2.x):**
- Pre-delivery evaluation of all LLM responses
- Response blocking, modification, and replacement
- Four evaluation criteria (hallucination, inconsistency, tone drift, unsafe reasoning)
- True middleware layer between application and LLM

---

## Architecture Gap Analysis

### What Currently Exists
- **Session Management** - Robust session lifecycle
- **Data Capture** - Comprehensive checkpoint system
- **Journey System** - Pre-defined therapeutic workflows
- **Integration Layer** - Working shrink-chat API integration
- **Error Handling** - Circuit breaker, retry strategy
- **Database Schema** - sessions, checkpoints, insights, crisis_events

### Critical Missing Components for v2.x
1. ❌ Draft response interception mechanism
2. ❌ Pre-delivery evaluation engine
3. ❌ Intervention decision framework
4. ❌ Response modification capabilities
5. ❌ Hallucination detection
6. ❌ Inconsistency checker
7. ❌ Tone drift monitoring
8. ❌ Unsafe reasoning detection
9. ❌ Governance audit logging

---

## Implementation Components

### 1. Response Interception Layer

**Location:** `src/governance/interceptor.ts`

```typescript
interface ResponseInterceptor {
  intercept(draftResponse: string, context: Context): InterceptionResult;
}

interface InterceptionResult {
  originalResponse: string;
  evaluationRequired: boolean;
  timestamp: Date;
}
```

**Integration Point:** Modify `src/tools/sendMessage.ts`
- Capture response BEFORE returning to user
- Store draft in new `governance_evaluations` table
- Add evaluation pipeline hook

---

### 2. Evaluation Engine Core

**Location:** `src/governance/evaluationEngine.ts`

```typescript
interface EvaluationEngine {
  evaluate(draft: string, context: SessionContext): EvaluationResult;
}

interface EvaluationResult {
  hallucination: { detected: boolean; confidence: number; patterns: string[] };
  inconsistency: { detected: boolean; confidence: number; conflicts: string[] };
  toneDrift: { detected: boolean; confidence: number; driftScore: number };
  unsafeReasoning: { detected: boolean; confidence: number; patterns: string[] };
  overallRisk: RiskLevel;
  recommendedAction: InterventionAction;
}

enum InterventionAction {
  APPROVE = 'approve',
  BLOCK = 'block',
  MODIFY = 'modify',
  FALLBACK = 'fallback'
}
```

---

### 3. Evaluation Criteria Implementations

#### A. Hallucination Detector
**Location:** `src/governance/detectors/hallucination.ts`

```typescript
class HallucinationDetector {
  private patterns = [
    /I have (direct|personal) experience/i,
    /studies (consistently |always )?show/i,
    /it's a (proven|established) fact that/i,
    /everyone knows that/i,
    /scientifically proven/i
  ];

  detect(response: string, context?: Context): DetectionResult {
    // Check for unsupported certainty
    // Verify factual claims against context
    // Flag fabricated statistics
  }
}
```

#### B. Inconsistency Checker
**Location:** `src/governance/detectors/inconsistency.ts`

```typescript
class InconsistencyChecker {
  async check(response: string, sessionId: string): Promise<DetectionResult> {
    // Load conversation history from checkpoints
    const history = await this.loadHistory(sessionId);

    // Extract key claims from history
    const previousClaims = this.extractClaims(history);

    // Compare current response against previous claims
    const conflicts = this.findConflicts(response, previousClaims);

    return { detected: conflicts.length > 0, conflicts };
  }
}
```

#### C. Tone Drift Monitor
**Location:** `src/governance/detectors/toneDrift.ts`

```typescript
class ToneDriftMonitor {
  monitor(response: string, baselineTone: ToneProfile): DetectionResult {
    // Analyze current response tone
    const currentTone = this.analyzeTone(response);

    // Calculate drift from baseline
    const driftScore = this.calculateDrift(currentTone, baselineTone);

    // Check for manipulation patterns
    const manipulativePatterns = this.detectManipulation(response);

    return {
      detected: driftScore > THRESHOLD,
      driftScore,
      patterns: manipulativePatterns
    };
  }
}
```

#### D. Unsafe Reasoning Detector
**Location:** `src/governance/detectors/unsafeReasoning.ts`

```typescript
class UnsafeReasoningDetector {
  private unsafePatterns = [
    /you should definitely/i,
    /don't tell anyone/i,
    /this will cure/i,
    /stop taking your medication/i,
    /your therapist is wrong/i
  ];

  detect(response: string): DetectionResult {
    // Check for harmful directive language
    // Detect clinical overreach
    // Flag dangerous advice
  }
}
```

---

### 4. Intervention Engine

**Location:** `src/governance/intervention.ts`

```typescript
class InterventionEngine {
  async intervene(
    action: InterventionAction,
    originalResponse: string,
    evaluationResult: EvaluationResult
  ): Promise<string> {
    switch (action) {
      case InterventionAction.APPROVE:
        return originalResponse;

      case InterventionAction.BLOCK:
        return this.getBlockedMessage(evaluationResult);

      case InterventionAction.MODIFY:
        return this.modifyResponse(originalResponse, evaluationResult);

      case InterventionAction.FALLBACK:
        return this.getFallbackResponse(evaluationResult);
    }
  }

  private modifyResponse(response: string, result: EvaluationResult): string {
    // Neutralize tone
    // Remove unsupported claims
    // Soften directive language
    // Maintain therapeutic intent
  }
}
```

---

### 5. Database Schema Updates

**New Tables:**

```sql
-- Governance evaluations
CREATE TABLE governance_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  checkpoint_id UUID REFERENCES checkpoints(id),
  draft_response TEXT NOT NULL,
  evaluation_results JSONB NOT NULL,
  intervention_applied VARCHAR(20),
  final_response TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Governance rules configuration
CREATE TABLE governance_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type VARCHAR(50) NOT NULL,
  criteria JSONB NOT NULL,
  thresholds JSONB NOT NULL,
  action VARCHAR(20) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Audit log for all governance actions
CREATE TABLE governance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID REFERENCES governance_evaluations(id),
  action_type VARCHAR(50) NOT NULL,
  reason TEXT,
  confidence_score DECIMAL(3,2),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

### 6. Integration with sendMessage Tool

**Modified Flow in `src/tools/sendMessage.ts`:**

```typescript
// After receiving response from shrink-chat
const draftResponse = response.content;

// Initialize governance pipeline
const governance = new GovernancePipeline();

// Build evaluation context
const context = await buildContext(session.id);

// Evaluate draft response
const evaluation = await governance.evaluate(draftResponse, context);

// Determine intervention
const action = governance.determineAction(evaluation);

// Apply intervention if needed
const finalResponse = await governance.intervene(action, draftResponse, evaluation);

// Log governance action
await logGovernanceAction(evaluation, action, finalResponse);

// Return governed response
return {
  content: finalResponse,
  governanceApplied: action !== InterventionAction.APPROVE,
  ...response
};
```

---

### 7. Configuration System

**Location:** `src/governance/config.ts`

```typescript
interface GovernanceConfig {
  enabled: boolean;
  criteria: {
    hallucination: { enabled: boolean; threshold: number };
    inconsistency: { enabled: boolean; threshold: number };
    toneDrift: { enabled: boolean; threshold: number };
    unsafeReasoning: { enabled: boolean; threshold: number };
  };
  interventionThresholds: {
    block: number;    // > 0.9 confidence
    modify: number;   // > 0.7 confidence
    warn: number;     // > 0.5 confidence
  };
  fallbackResponses: {
    crisis: string;
    blocked: string;
    error: string;
  };
}
```

---

## Quick Implementation Path

### Step 1: Create Governance Structure
```bash
mkdir -p src/governance/detectors
mkdir -p src/governance/interventions
```

### Step 2: Implement Basic Detectors
1. Start with rule-based pattern matching
2. Add confidence scoring
3. Implement caching for performance

### Step 3: Wire into sendMessage
1. Add interception point after shrink-chat response
2. Run evaluation pipeline
3. Apply intervention if needed
4. Log all actions

### Step 4: Add Database Tables
1. Run migration for new governance tables
2. Set up audit logging
3. Configure retention policies

### Step 5: Testing
1. Create test cases for each detector
2. Test intervention scenarios
3. Verify no regression in existing functionality

---

## Immediate Action Items

### Core Files to Create:
1. `src/governance/evaluationEngine.ts` - Main evaluation pipeline
2. `src/governance/detectors/hallucination.ts` - Hallucination detection
3. `src/governance/detectors/inconsistency.ts` - Consistency checking
4. `src/governance/detectors/toneDrift.ts` - Tone monitoring
5. `src/governance/detectors/unsafeReasoning.ts` - Safety detection
6. `src/governance/intervention.ts` - Response modification
7. `src/governance/config.ts` - Configuration management
8. `src/db/migrations/governance.sql` - Database schema

### Files to Modify:
1. `src/tools/sendMessage.ts` - Add governance pipeline
2. `src/db/schema.ts` - Add governance tables
3. `.env.local` - Add governance configuration

---

## Success Criteria

### Functional Requirements
- ✅ All responses evaluated before delivery
- ✅ Can block harmful responses
- ✅ Can modify problematic content
- ✅ Maintains conversation context
- ✅ Logs all interventions

### Performance Requirements
- ✅ Evaluation completes in < 1 second
- ✅ No blocking of user experience
- ✅ Graceful degradation on failure

### Quality Requirements
- ✅ False positive rate < 10%
- ✅ Critical safety issues caught > 95%
- ✅ Audit trail for all decisions

---

## Testing Strategy

### Unit Tests
```typescript
// Test each detector individually
describe('HallucinationDetector', () => {
  it('detects unsupported certainty claims');
  it('flags fabricated statistics');
  it('handles edge cases gracefully');
});
```

### Integration Tests
```typescript
// Test full pipeline
describe('GovernancePipeline', () => {
  it('evaluates and approves safe responses');
  it('blocks clearly harmful content');
  it('modifies problematic responses');
  it('maintains conversation context');
});
```

### Regression Tests
```typescript
// Ensure existing functionality intact
describe('Session Management', () => {
  it('continues to work with governance enabled');
  it('handles governance failures gracefully');
});
```

---

## Rollout Strategy

### Phase 1: Shadow Mode
- Run governance without intervention
- Log what would have been blocked/modified
- Analyze false positives

### Phase 2: Selective Intervention
- Enable blocking for high-confidence harmful content
- Continue logging other evaluations
- Monitor user impact

### Phase 3: Full Governance
- Enable all intervention types
- Remove pass-through fallback
- Monitor and tune thresholds

---

## Quick Start Commands

```bash
# Create governance structure
mkdir -p src/governance/{detectors,interventions}

# Install any additional dependencies
npm install --save natural compromise sentiment

# Run database migration
npm run db:push

# Start development with governance
GOVERNANCE_ENABLED=true npm run dev

# Run governance tests
npm test -- governance
```

---

**Document Version:** 1.0
**Last Updated:** January 17, 2025
**Status:** Ready for Implementation