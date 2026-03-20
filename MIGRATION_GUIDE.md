# CouchLoop V2 Migration Guide

## Overview

This guide describes the safe migration path from the monolithic `couchloop` to the new modular orchestration system (V2). The migration is designed to be gradual, reversible, and observable at every step.

## Current State → Target State

### Before (Monolithic)
```
couchloop → regex patterns → direct tool execution
```

### After (Modular)
```
request → classify → policy → plan → execute → compose
```

## Phase 0: Instrumentation (Week 1) ✅

**Status: COMPLETE** - Infrastructure is now in place.

### What We've Built:
1. **Intent Classifier** (`src/core/intent/classifier.ts`)
   - Confidence-based classification
   - Multi-intent detection
   - Ambiguity detection

2. **Policy Engine** (`src/core/policy/engine.ts`)
   - Rule-based routing decisions
   - Health-aware routing
   - Crisis override support

3. **Execution Planner** (`src/core/planning/planner.ts`)
   - DAG generation
   - Parallel execution support
   - Fallback chains

4. **OpenTelemetry Tracing** (`src/core/telemetry/tracing.ts`)
   - Distributed tracing
   - Performance monitoring
   - Request tracking

5. **Tool Registry** (`src/core/registry/registry.ts`)
   - Tool metadata management
   - Health tracking
   - Capability queries

6. **Feature Flags** (`src/core/feature-flags.ts`)
   - Gradual rollout control
   - A/B testing support
   - Runtime configuration

## Phase 1: Shadow Mode Testing (Week 2)

### 1. Enable V2 in shadow mode (no user impact):

```bash
# Environment variables for shadow mode
export FF_USE_V2_CLASSIFIER=true
export FF_USE_V2_POLICY=true
export FF_USE_V2_PLANNER=true
export FF_USE_V2_TELEMETRY=true
export FF_V2_ROLLOUT_PCT=0  # 0% user traffic
```

### 2. Update primary-tools.ts to support dual mode:

```typescript
import { couchloopV2Tool } from './couchloop-v2.js';
import { featureFlags } from '../core/feature-flags.js';

// In setupTools():
const intentRouterHandler = async (args: Record<string, unknown>) => {
  // Log both paths for comparison
  if (featureFlags.getFlag('useV2Telemetry')) {
    // Run V2 in background, return V1 result
    couchloopV2Tool.handler(args).catch(err =>
      logger.error('V2 shadow execution failed', err)
    );
  }

  // Always return V1 result during shadow mode
  return originalIntentRouterHandler(args);
};
```

### 3. Monitor telemetry to compare V1 vs V2:
- Classification accuracy
- Routing decisions
- Latency differences
- Error rates

## Phase 2: Gradual Rollout (Week 3)

### 1. Start with 10% of traffic:

```bash
export FF_V2_ROLLOUT_PCT=10
export FF_DIRECT_ROUTE_PCT=50  # 50% of high-confidence goes direct
```

### 2. Monitor key metrics:
```sql
-- Success rate comparison
SELECT
  version,
  COUNT(*) as total_requests,
  AVG(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_rate,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency
FROM request_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY version;
```

### 3. Gradual increase schedule:
- Day 1-2: 10% → Monitor closely
- Day 3-4: 25% → Check error rates
- Day 5: 50% → Verify latency
- Day 6: 75% → Full monitoring
- Day 7: 100% → Complete migration

## Phase 3: Enable Direct Routing (Week 4)

### 1. Enable direct routing for high-confidence intents:

```bash
export FF_DIRECT_ROUTE=true
export FF_DIRECT_ROUTE_PCT=100  # All high-confidence goes direct
```

### 2. Expected improvements:
- `status` requests: 500ms → 200ms
- `protect` requests: 500ms → 300ms
- Router bypass rate: >60%

### 3. Monitor router usage:
```typescript
// Should see declining router usage
logger.info('Router usage stats', {
  directRouted: metrics.directCount,
  routerRouted: metrics.routerCount,
  bypassRate: metrics.directCount / (metrics.directCount + metrics.routerCount)
});
```

## Phase 4: Enable Advanced Features (Week 5)

### 1. Parallel execution for multi-intent:

```bash
export FF_PARALLEL_EXECUTION=true
export FF_PARALLEL_EXEC_PCT=50  # Start with 50%
```

### 2. Enable caching for appropriate tools:

```bash
export FF_CACHING=true
```

### 3. Enable adaptive timeouts:

```bash
export FF_ADAPTIVE_TIMEOUTS=true
```

## Rollback Procedures

### Instant Rollback (Any Phase):
```bash
# Disable V2 immediately
export FF_V2_ROLLOUT_PCT=0
export FF_USE_V2_EXECUTOR=false
```

### Gradual Rollback:
```bash
# Reduce traffic gradually
export FF_V2_ROLLOUT_PCT=50  # Then 25, 10, 0
```

### Per-Feature Rollback:
```bash
# Disable specific features
export FF_PARALLEL_EXECUTION=false
export FF_DIRECT_ROUTE=false
```

## Monitoring Checklist

### Key Metrics to Watch:

1. **Latency SLOs**:
   - [ ] End-to-end p95 < 3.0s
   - [ ] Direct route p95 < 1.0s
   - [ ] Router p95 < 800ms

2. **Success Rates**:
   - [ ] Overall success > 99.5%
   - [ ] No increase in timeout rates
   - [ ] No increase in error rates

3. **Classification Quality**:
   - [ ] Confidence calibration accurate
   - [ ] Ambiguity detection working
   - [ ] Multi-intent detection correct

4. **Tool Health**:
   - [ ] Circuit breakers functioning
   - [ ] Fallbacks executing properly
   - [ ] Health metrics updating

## Testing V2 Locally

### 1. Run with full V2 enabled:
```bash
npm run dev:v2
```

### 2. Test specific intents:
```typescript
// Test direct routing
await couchloopV2Handler({
  intent: "check my status",
  trace_id: "test-123"
});

// Test multi-intent
await couchloopV2Handler({
  intent: "save this and review my code",
  context: "function foo() { ... }",
  trace_id: "test-456"
});

// Test ambiguous routing
await couchloopV2Handler({
  intent: "help me",  // Could be brainstorm or conversation
  trace_id: "test-789"
});
```

### 3. View traces:
```bash
# If using Jaeger
open http://localhost:16686

# If using console exporter
npm run dev:v2 2>&1 | grep TRACE
```

## Production Deployment Steps

### 1. Pre-deployment:
- [ ] Run full test suite
- [ ] Review telemetry dashboards
- [ ] Confirm rollback procedures
- [ ] Alert team of deployment

### 2. Deployment:
```bash
# Railway/Vercel deployment with env vars
railway up --environment production
# or
vercel --prod
```

### 3. Post-deployment:
- [ ] Monitor error rates for 30 minutes
- [ ] Check latency metrics
- [ ] Verify trace data flowing
- [ ] Test with production request

## Success Criteria

The migration is complete when:

1. ✅ 100% of traffic on V2
2. ✅ Direct route rate > 60%
3. ✅ P95 latency < 3.0s
4. ✅ Success rate > 99.5%
5. ✅ Multi-intent execution working
6. ✅ All tools registered in registry
7. ✅ Telemetry pipeline operational
8. ✅ Circuit breakers tested
9. ✅ Feature flags controlling rollout
10. ✅ Team confident in new system

## Common Issues and Solutions

### Issue: High latency after migration
**Solution**: Check if parallel execution is disabled. Enable with:
```bash
export FF_PARALLEL_EXECUTION=true
```

### Issue: Classification confidence too low
**Solution**: Review intent patterns, may need tuning:
```typescript
// Adjust confidence thresholds
export FF_DIRECT_ROUTE_THRESHOLD=0.85  # Lower from 0.90
```

### Issue: Circuit breaker opening too frequently
**Solution**: Adjust health thresholds:
```typescript
policyEngine.updateConfig({
  minToolHealthForDirectRoute: 0.90  // From 0.95
});
```

### Issue: Memory usage increasing
**Solution**: Check cache settings:
```bash
export FF_CACHING=false  # Disable if problematic
```

## Team Contacts

- **On-call**: Check PagerDuty rotation
- **V2 Lead**: Update with team lead
- **Monitoring**: Grafana/DataDog dashboards
- **Rollback Authority**: Engineering Manager

## Next Steps After Migration

1. **Week 6**: Enable speculative execution
2. **Week 7**: Implement learning loop
3. **Week 8**: Add route optimization
4. **Week 9**: Enable full parallelization
5. **Week 10**: Remove V1 code

---

**Remember**: This is a gradual migration. Take it slow, monitor everything, and don't hesitate to rollback if metrics degrade.