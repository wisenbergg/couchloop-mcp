# Confidence Score Functions Reference

> **Last Updated**: January 8, 2026  
> **Codebase**: shrink-chat `staging` branch  
> **Total Functions**: 39 distinct confidence-producing functions/sources

This document provides an exhaustive list of all functions in the shrink-chat codebase that produce confidence scores, organized by domain.

---

## 1. Crisis Detection & Risk Assessment

| Function | File | Produces | Scale | Description |
|----------|------|----------|-------|-------------|
| `detectCrisisUnified()` | `src/lib/crisisDetectionUnified.ts` | `crisisResult.confidence` | 0.0-1.0 | Unified crisis detection confidence combining pattern, cumulative, and AI assessment |
| `analyzeCumulativeRisk()` | `src/lib/crisisInterventionAI.ts` | `cumulativeScore` | 0.0-1.0 | Analyzes conversation history for escalating crisis patterns |
| `detectCrisisSignalsEnhanced()` | `src/lib/sophisticatedCrisisDetection.ts` | `result.confidence` | 0.0-1.0 | Sophisticated multi-layer crisis detection with false-positive filtering |
| `analyzeCrisisIntelligence()` | `src/lib/crisisIntelligenceSystem.ts` | `confidenceScore` | 0.0-1.0 | Comprehensive crisis intelligence with risk/protective factors |
| `calculateConfidenceScore()` | `src/lib/crisisIntelligenceSystem.ts:545` | confidence | 0.0-1.0 | Calculates confidence based on history length and state changes |
| `RiskScorer.calculateScore()` | `src/lib/mcp/riskScorer.ts` | `score`, `confidence` | 0.0-1.0 | MCP risk scoring with context factors and recommendations |
| `RiskScorer.calculateConfidence()` | `src/lib/mcp/riskScorer.ts:636` | confidence | 0.0-1.0 | Private method calculating confidence from risk and context factors |

### Crisis Level Thresholds (riskScorer.ts)

```typescript
// Risk level determination thresholds
if (score >= 0.9) return RiskLevel.CRITICAL;
if (score >= 0.7) return RiskLevel.HIGH;
if (score >= 0.5) return RiskLevel.MEDIUM;
if (score >= 0.2) return RiskLevel.LOW;
return RiskLevel.NONE;
```

---

## 2. Memory Retrieval & Relevance

| Function | File | Produces | Scale | Description |
|----------|------|----------|-------|-------------|
| `scoreMemoryRelevance()` | `src/lib/memory/EnhancedMemoryRetrieval.ts:195` | `final_score` | 0.0-1.0 | Scores memory relevance with recency, context, and semantic weighting |
| `calculateContextScore()` | `src/lib/memory/EnhancedMemoryRetrieval.ts:291` | context score | 0.0-1.0 | Calculates context-based relevance for memories |
| `calculateRecencyScore()` | `src/lib/memory/EnhancedMemoryRetrieval.ts:394` | recency score | 0.0-0.5 | Exponential decay with 7-day half-life |
| `calculateRelevanceScore()` | `src/lib/memory/EnhancedMemoryRetrieval.ts:406` | relevance score | 0.0-1.0 | Keyword-based topic relevance calculation |
| `calculateEfficientSemanticRelevance()` | `src/lib/memory/EnhancedMemoryRetrieval.ts` | semantic relevance | 0.0-1.0 | Word overlap and question-answer pattern matching |
| `get_relevant_memories` (SQL RPC) | `supabase/migrations/*.sql` | `similarity_score` | 0.0-1.0 | Vector similarity using pgvector cosine distance |
| `scoreJournalSnippet()` | `src/lib/memory/salienceConfig.ts` | salience score | 0-100 | Scores journal snippets for memory importance |
| `fetchSafeRecall()` | `src/lib/voice/safeRetrieval.ts` | `confidence` | 0.0-1.0 | Wrapper producing confidence from memory recall scores |
| `isLowConfidence()` | `src/lib/voice/safeRetrieval.ts` | boolean | threshold 0.62 | Checks if retrieval confidence is below threshold |

### Recency Decay Formula

```typescript
// Exponential decay with 7-day half-life
function calculateRecencyScore(memory: any): number {
  const memoryDate = new Date(memory.created_at);
  const now = new Date();
  const daysDiff = (now.getTime() - memoryDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysDiff / 7) * 0.5;
}
```

---

## 3. RAG (Retrieval-Augmented Generation)

| Function | File | Produces | Scale | Description |
|----------|------|----------|-------|-------------|
| `rag_confidence` calculation | `app/api/shrink/route.ts:1349` | `rag_confidence` | 0.0-1.0 | Memory retrieval confidence passed to voice controller |
| `meta.rag_confidence` | Response object | `rag_confidence` | 0.0-1.0 | Exposed in API response for client-side use |
| `vectorMemoryContext.continuityScore` | `src/lib/core.ts` | `continuityScore` | 0.0-1.0 | Conversation continuity assessment |

### RAG Confidence Threshold

```typescript
// Low confidence threshold for fallback behavior
const CONFIDENCE_THRESHOLD = 0.62;

export function isLowConfidence(r: RetrievalResult, threshold = CONFIDENCE_THRESHOLD): boolean {
  return (r?.confidence ?? 0) < threshold || (r?.hits?.length ?? 0) === 0;
}
```

---

## 4. Emotional Analysis

| Function | File | Produces | Scale | Description |
|----------|------|----------|-------|-------------|
| `calculateEmotionalScore()` | `src/lib/emotionalAnalyticsAPI.ts:626` | emotional score | -10 to +10 | Converts emotional tone array to numeric score |
| `calculateEmotionalBaseline()` | `src/lib/emotionalTrendAnalysis.ts` | `averageConfidence` | 0.0-1.0 | User's baseline emotional confidence |
| `analyzeEmotionalTrend()` | `src/lib/emotionalTrendAnalysis.ts` | trend data | varies | Trend analysis with confidence values |
| `calculateVolatilityScore()` | `src/lib/emotionalAnalyticsAPI.ts:671` | volatility | 0-100 | Standard deviation of emotional scores |
| `calculateTrendDirection()` | `src/lib/emotionalAnalyticsAPI.ts:653` | direction | enum | `'improving'` \| `'stable'` \| `'declining'` \| `'volatile'` |
| `calculateProgressScore()` | `src/lib/emotionalAnalyticsAPI.ts:709` | progress score | 0-100 | Overall user progress metric |
| `getEmotionalHistory()` | `src/lib/emotionalTrendAnalysis.ts` | `entry.confidence_score` | 0.0-1.0 | Historical emotional confidence per entry |

### Emotional Score Mapping

```typescript
function calculateEmotionalScore(emotionalTones: string[]): number {
  // Maps emotional tones to numeric values
  // Positive emotions: +1 to +5
  // Negative emotions: -1 to -5
  // Returns weighted average
}
```

---

## 5. Therapeutic Quality

| Function | File | Produces | Scale | Description |
|----------|------|----------|-------|-------------|
| `calculateTherapeuticQualityScore()` | `src/lib/assistantTherapeuticAnalytics.ts:319` | quality score | 0.0-1.0 | Composite therapeutic quality from multiple metrics |
| `calculateEffectivenessScore()` | `src/lib/assistantTherapeuticAnalytics.ts:467` | effectiveness | 0.0-1.0 | Measures assistant response effectiveness |
| `analyzeAssistantPerformance()` | `src/lib/assistantTherapeuticAnalytics.ts` | `averageConfidence`, `qualityScore` | 0.0-1.0 | Performance metrics with confidence |
| `calculateProgressScore()` | `src/lib/crisisIntelligenceSystem.ts:723` | progress score | 0-100 | Therapeutic progress from emotional trends |

### Quality Score Composition

```typescript
function calculateTherapeuticQualityScore(metrics: {
  therapeuticConsistency: number;
  averageConfidence: number;
  userOutcomeCorrelation: UserOutcomeCorrelation;
  crisisResponseQuality?: CrisisResponseQuality;
}): number {
  // Base score from consistency and confidence
  let score = (therapeuticConsistency * 0.4) + (averageConfidence * 0.3);
  
  // User outcome impact
  const outcomeImpact = userOutcomeCorrelation.userTrendImprovement > 0 ? 0.2 : 0;
  score += outcomeImpact;
  
  // Crisis response bonus
  if (crisisResponseQuality) {
    const crisisBonus = crisisResponseQuality.escalationAppropriate ? 0.1 : -0.1;
    score += crisisBonus;
  }
  
  return Math.max(0, Math.min(1, score));
}
```

---

## 6. Depth Signal & User Intent

| Function | File | Produces | Scale | Description |
|----------|------|----------|-------|-------------|
| `computeDepthScore()` | `src/lib/depthSignal.ts:164` | `score` | 0-100 | Async depth score from message intensity |
| `computeDepthScoreSync()` | `src/lib/depthSignal.ts:179` | `score` | 0-100 | Sync version of depth score |
| `calculateSubtleDistressScore()` | `src/lib/enhancedCrisisOptimization.ts:1025` | distress score | 0-10 | Subtle distress indicators for crisis fallback |

### Depth Score Conversion

```typescript
export async function computeDepthScore(userMessage: string): Promise<{ score: number; label: string }> {
  const context = await getContextualLoadingMessage(userMessage);
  return {
    score: context.intensity * 10, // Convert 1-10 scale to 0-100
    label: context.loadingMessage
  };
}
```

---

## 7. Voice Controller & UI

| Function | File | Produces | Scale | Description |
|----------|------|----------|-------|-------------|
| `getConfidenceLevel()` | `src/components/chat/ConfidenceBasedResponse.tsx:52` | level | `'high'` \| `'medium'` \| `'low'` | Maps 0-1 score to display level |
| `getConfidenceMessage()` | `src/components/VoiceFeedback.tsx:93` | message | string | User-facing confidence message |

### Confidence Level Thresholds

```typescript
function getConfidenceLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}
```

---

## 8. Database Functions (SQL/RPC)

| Function | Table/RPC | Produces | Scale | Description |
|----------|-----------|----------|-------|-------------|
| `get_relevant_memories` | SQL RPC | `similarity_score` | 0.0-1.0 | pgvector cosine similarity |
| `get_enhanced_memories` | SQL RPC | `similarity_score` | 0.0-1.0 | Enhanced memory with quality filtering |
| `profile_tone_history` | Table column | `confidence_score` | 0.0-1.0 | Stored emotional tone confidence |
| `memory.quality_score` | Table column | `quality_score` | 0-100 | Memory quality for filtering |

### Vector Similarity Calculation (SQL)

```sql
-- Cosine similarity using pgvector
SELECT 
  id,
  content,
  summary,
  (1 - (m.embedding <=> query_vector))::float AS similarity_score,
  created_at
FROM memory m
WHERE m.thread_id = query_thread_id
  AND (1 - (m.embedding <=> query_vector)) >= match_threshold
ORDER BY similarity_score DESC
LIMIT match_count;
```

---

## Summary by Domain

| Domain | Function Count | Key Scores |
|--------|----------------|------------|
| **Crisis Detection** | 7 | `crisisResult.confidence`, `cumulativeScore`, `RiskScore.confidence` |
| **Memory Retrieval** | 9 | `similarity_score`, `relevanceScore`, `final_score`, `salience` |
| **RAG/Context** | 3 | `rag_confidence`, `continuityScore` |
| **Emotional Analysis** | 7 | `emotionalScore`, `volatilityScore`, `averageConfidence` |
| **Therapeutic Quality** | 4 | `qualityScore`, `effectivenessScore`, `progressScore` |
| **Depth/Intent** | 3 | `depthScore`, `distressScore` |
| **UI Display** | 2 | `confidenceLevel`, `confidenceMessage` |
| **Database** | 4 | `similarity_score`, `quality_score`, `confidence_score` |

---

## Usage Patterns

### Client-Side Confidence Access

```typescript
// From API response
const response = await fetch('/api/shrink', { ... });
const data = await response.json();

// Access confidence scores
console.log(data.meta.rag_confidence);           // 0.0-1.0
console.log(data.crisis_confidence);              // 0.0-1.0
console.log(data.memory_high_relevance_count);    // integer
```

### Server-Side Confidence Generation

```typescript
// In core.ts or route handlers
import { detectCrisisUnified } from '@/lib/crisisDetectionUnified';
import { scoreMemoryRelevance } from '@/lib/memory/EnhancedMemoryRetrieval';

const crisisResult = await detectCrisisUnified(prompt, conversationHistory);
console.log(crisisResult.confidence); // 0.0-1.0

const memoryScore = await scoreMemoryRelevance(memory, context, options);
console.log(memoryScore.final_score); // 0.0-1.0
```

---

## Related Documentation

- [MCP Integration Guide](./MCP_SHRINK_CHAT_INTEGRATION_GUIDE.md) - API response format with confidence fields
- [Memory System Architecture](./memory-system-architecture.md) - Memory retrieval scoring details
- [Crisis Detection System](./SOPHISTICATED_CRISIS_DETECTION_SOLUTION.md) - Crisis confidence calculation
