# Self-Correction Governance Approach

## Overview

Instead of complex external pattern matching and intervention, we leverage the LLM's own reasoning capabilities for self-correction when safety issues are detected.

## The Problem with Complex Governance

The previous approach had:
- 2000+ lines of detection code
- Complex pattern matching
- 27% success rate on aggressive tests
- Difficulty distinguishing context
- High maintenance burden

## The Self-Correction Solution

### Core Principle
**Let the LLM fix itself when prompted, rather than trying to fix it externally.**

### How It Works

1. **Initial Response**: Send user message to shrink-chat/LLM
2. **Safety Check**: Evaluate response using shrink-chat's safety indicators
3. **Self-Correction**: If unsafe, prompt LLM to reconsider
4. **Audit Trail**: Log both attempts for compliance

### Implementation

```typescript
// Simplified flow in sendMessage-revised.ts

// 1. Get initial response
const response = await client.sendMessage(threadId, userMessage);

// 2. Check safety
const needsRevision = evaluateNeedsRevision(response);

// 3. If unsafe, request self-correction
if (needsRevision.needed) {
  const revisionPrompt = buildRevisionPrompt(
    needsRevision.reason,
    originalMessage
  );

  const revisedResponse = await client.sendMessage(
    threadId,
    revisionPrompt,
    { conversationType: 'revision' }
  );

  response = revisedResponse;
}

// 4. Log for audit
await logGovernanceEvaluation(sessionId, response, action);
```

## Safety Triggers

### Automatic Revision Triggers
- Crisis level > 8 with confidence > 0.7
- Medication interference patterns
- Self-harm encouragement
- Therapeutic relationship undermining
- Isolation encouragement
- Unhealthy dependency creation
- Inappropriate urgency

### Pattern Examples
```javascript
const dangerousPatterns = [
  /stop.{0,20}taking.{0,20}(medication|meds)/i,
  /kill.{0,20}yourself/i,
  /therapist.{0,20}(wrong|lying)/i,
  /don't.{0,20}tell.{0,20}anyone/i,
  /only.{0,10}i.{0,10}can.{0,10}help/i,
];
```

## Revision Prompts

When revision is needed, we send a prompt like:

```
Upon reflection, my previous response may have contained
[specific issue]. Let me provide a more appropriate response
to: "[original user message]"

Please provide a supportive, safe response that:
- Acknowledges their concerns
- Offers appropriate support without harmful advice
- Maintains professional boundaries
- Encourages healthy coping strategies if relevant
```

## Advantages

### 1. **Simplicity**
- ~500 lines instead of 2000+
- No complex detection algorithms
- Easy to understand and maintain

### 2. **Effectiveness**
- LLMs are good at self-correction when asked
- Context-aware revisions
- Natural language corrections

### 3. **Flexibility**
- Works with any LLM
- Easy to adjust triggers
- Can evolve with model capabilities

### 4. **Audit Trail**
- Both attempts logged
- Clear revision reasons
- Compliance-ready

## Testing

Run the self-correction test:
```bash
npx tsx test-self-correction.ts
```

This tests:
- Safe messages pass through
- Dangerous content triggers revision
- Revisions are logged
- Database records created

## Configuration

### Environment Variables
```env
# Revision thresholds
GOVERNANCE_CRISIS_THRESHOLD=8
GOVERNANCE_CONFIDENCE_THRESHOLD=0.7
GOVERNANCE_ENABLE_SELF_CORRECTION=true
```

### Tuning
- Adjust crisis_level threshold (default: 8)
- Modify confidence threshold (default: 0.7)
- Add/remove dangerous patterns
- Customize revision prompts

## Database Schema

Simplified governance_evaluations table:
```sql
{
  evaluationResults: {
    action: 'revision_requested' | 'revision_applied' | 'approved',
    reason: string,
    confidence: number,
    method: 'self-correction',
    timestamp: string
  },
  interventionApplied: 'revision' | null,
  finalResponse: string | null
}
```

## Migration Path

To switch from complex governance to self-correction:

1. **Keep**: Database tables, logging infrastructure
2. **Simplify**: Replace complex detectors with simple triggers
3. **Add**: Self-correction prompting logic
4. **Remove**: Complex intervention engine

## Success Metrics

- **Safety**: 100% catch rate on explicit dangerous patterns
- **False Positives**: Minimal due to context-aware revision
- **Performance**: Adds one API call for unsafe content only
- **Maintainability**: 75% less code to maintain

## Future Enhancements

1. **Learning**: Track which prompts work best for revision
2. **Personalization**: Adjust revision style per user
3. **Multi-turn**: Allow multiple revision attempts if needed
4. **Feedback Loop**: Use revision success to improve triggers

## Conclusion

By working WITH the LLM's intelligence rather than trying to police it externally, we achieve better safety outcomes with simpler code. The LLM becomes its own safety mechanism when properly prompted.