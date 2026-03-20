/**
 * Intent Classification Types
 *
 * Core types for the intent classification system that replaces
 * the monolithic couchloop router with confidence-based routing.
 */

export type IntentClass =
  | 'session_control'
  | 'memory_control'
  | 'verify'
  | 'brainstorm'
  | 'package_audit'
  | 'code_review'
  | 'status'
  | 'protect'
  | 'conversation_ops'
  | 'multi_intent'
  | 'unknown';

export interface IntentAlternative {
  intent: IntentClass;
  confidence: number;
}

export interface IntentResult {
  primaryIntent: IntentClass;
  confidence: number;
  ambiguous: boolean;
  multiIntent: boolean;
  alternatives: IntentAlternative[];
  decomposition?: string[];
}

export interface IntentPattern {
  intent: IntentClass;
  patterns: RegExp[];
  priority?: number; // Higher priority patterns are checked first
  contextClues?: string[]; // Additional context hints
}

export interface ClassifierConfig {
  // Confidence thresholds for routing decisions
  directRouteThreshold: number;     // >= this: direct route (default: 0.90)
  routerRouteThreshold: number;     // >= this: use router with explanation (default: 0.55)
  clarificationThreshold: number;   // < this: ask for clarification (default: 0.55)

  // Feature flags
  enableMultiIntentDetection: boolean;
  enableAmbiguityDetection: boolean;
  enableContextualHints: boolean;

  // Performance settings
  maxAlternatives: number; // Max number of alternatives to return (default: 3)
  cacheClassifications: boolean;
  cacheTTLSeconds: number;
}

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  directRouteThreshold: 0.90,
  routerRouteThreshold: 0.55,
  clarificationThreshold: 0.55,
  enableMultiIntentDetection: true,
  enableAmbiguityDetection: true,
  enableContextualHints: true,
  maxAlternatives: 3,
  cacheClassifications: true,
  cacheTTLSeconds: 120,
};