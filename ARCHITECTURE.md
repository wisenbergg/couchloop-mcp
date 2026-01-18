# CouchLoop Architecture: Behavioral Governance for LLMs

## Document Status

⚠️ **THIS DOCUMENT DEFINES THE TARGET ARCHITECTURE FOR COUCHLOOP**

- **Document Type**: Authoritative Architectural Definition
- **Current Implementation**: Session Management Layer (v1.x) - See [ARCHITECTURE_CURRENT.md](./ARCHITECTURE_CURRENT.md)
- **Target Implementation**: Behavioral Governance Layer (v2.x) - Defined in this document
- **Last Updated**: January 17, 2025

---

## 1. What CouchLoop Is (Authoritative Definition)

CouchLoop is a **behavioral governance layer for LLMs**.

It is **not**:

* A chatbot
* A prompt wrapper
* A moderation-only filter
* A post-response safety checker

It **is**:

* A control layer that sits **between the application and the LLM**
* A system that evaluates **draft model output before delivery**
* A mechanism to **intervene, modify, or block responses** when risk is detected
* Model-agnostic and compatible with multi-model pipelines

**Key invariant:**

> No ungoverned LLM response should ever reach the user.

---

## 2. Core Architectural Placement

### Required call flow

```
Application
   ↓
CouchLoop (governance layer)
   ↓
LLM (any provider)
   ↓
Draft response
   ↑
CouchLoop (evaluation + intervention)
   ↓
Governed response
   ↓
User
```

CouchLoop must have:

* Visibility into the **full draft response**
* Authority to **block, modify, or replace** the response
* Context from prior turns when available

---

## 3. What CouchLoop Evaluates (Minimum Scope)

The governance layer MUST evaluate draft responses for:

### A. Hallucination risk

* Fabricated facts
* False certainty
* Unsupported claims presented as truth

### B. Inconsistency

* Contradictions with earlier turns
* Sudden reversals in advice or stance
* Logical incoherence across turns

### C. Tone drift

* Escalation from neutral to emotionally loaded
* Over-reassurance or over-alarmism
* Manipulative or dependency-forming language

### D. Unsafe reasoning patterns

* Encouraging harmful actions
* Moralizing or shaming
* Overstepping into clinical or authoritative claims

These are **pre-delivery checks**, not moderation after the fact.

---

## 4. Intervention Model

When risk is detected, CouchLoop must be able to:

1. **Block** the response entirely
2. **Rewrite** the response into a safer alternative
3. **Constrain** tone or scope (shorter, more neutral, less directive)
4. **Fallback** to a safe, predefined response pattern

Intervention decisions should be:

* Deterministic where possible
* Auditable
* Logged for downstream analysis

---

## 5. Non-Goals (Important)

The implementation should explicitly avoid:

* Training or fine-tuning base models
* Replacing provider-level safety systems
* Performing clinical diagnosis
* Keyword-only crisis detection
* UI or chat UX concerns

CouchLoop is **infrastructure**, not product UX.

---

## 6. Integration Targets

Initial implementation should support:

* Node.js environments
* Use as:

  * Middleware
  * Service wrapper
  * Sidecar process
* Compatibility with:

  * OpenAI-style APIs
  * Anthropic-style APIs
  * Future MCP integrations

Design for:

* Stateless core with optional context injection
* Clear input/output contracts

---

## 7. Required Interfaces (Conceptual)

### Input to CouchLoop

* Conversation context (optional but preferred)
* Draft LLM response (required)
* Metadata (model, provider, environment, flags)

### Output from CouchLoop

* Approved response OR
* Modified response OR
* Blocked response + reason code

---

## 8. Success Criteria for v1

A correct v1 implementation:

* Intercepts every LLM response before user delivery
* Applies at least basic checks for the four risk categories
* Can block or rewrite responses deterministically
* Works across at least one real LLM provider
* Produces logs suitable for later audit

If CouchLoop ever allows an unchecked response through, it fails its core purpose.

---

## 9. Canonical Language (Use Consistently)

When naming concepts in code, docs, or logs, prefer:

* `governance`
* `intervention`
* `draft_response`
* `governed_response`
* `risk_detection`
* `behavioral_control`

Avoid:

* `therapy`
* `assistant`
* `companion`
* `moderation` (unless explicitly post-response)

---

## 10. North Star Principle

> CouchLoop exists to decide **whether** and **how** an LLM should speak, not just to help it speak better.

All implementation decisions should reinforce this.

---

## Migration Path from Current Implementation

### Current State (v1.x)
The current implementation provides:
- Session and journey management via MCP protocol
- Pass-through messaging to shrink-chat backend
- Post-generation crisis detection and handling
- Checkpoint-based conversation tracking

### Target State (v2.x)
The target implementation will provide:
- Pre-delivery evaluation of all LLM responses
- Response blocking, modification, and replacement
- Governance decisions before user sees content
- Full compliance with the architectural model above

### Transition Strategy
1. **Phase 1**: Current MCP server continues as session layer
2. **Phase 2**: Add evaluation hooks for draft responses
3. **Phase 3**: Implement intervention capabilities
4. **Phase 4**: Full governance layer with all evaluation criteria
5. **Phase 5**: Deprecate pass-through mode

---

## References

- [CLAUDE.md](./CLAUDE.md) - Implementation guide and current state
- [ARCHITECTURE_CURRENT.md](./ARCHITECTURE_CURRENT.md) - Current implementation details
- [User Types & Positioning](./CLAUDE.md#user-types--positioning) - Consumer vs Developer audiences