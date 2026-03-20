/**
 * Intent Classifier Module
 *
 * Replaces the monolithic couchloop router with a confidence-based
 * intent classification system. This is a pure function that can be
 * tested independently and improved over time.
 */

import { logger } from '../../utils/logger.js';
import {
  IntentClass,
  IntentResult,
  IntentPattern,
  ClassifierConfig,
  DEFAULT_CLASSIFIER_CONFIG,
} from './types.js';

// Intent patterns with priority and confidence boosts
const INTENT_PATTERNS: IntentPattern[] = [
  // Session Control - HIGH PRIORITY
  {
    intent: 'session_control',
    priority: 10,
    patterns: [
      /\b(end|finish|done|wrap[\s-]?up|close|stop|quit|exit)\b.*\b(session|chat|conversation)?\b/i,
      /\b(start|begin|new|resume|continue)\b.*\b(session|chat|conversation)\b/i,
      /\b(goodbye|bye|see\s+you|talk\s+later|gtg|gotta\s+go)\b/i,
      /\bsession\s*(status|info|details)\b/i,
    ],
    contextClues: ['session_id', 'journey', 'checkpoint'],
  },

  // Memory Control
  {
    intent: 'memory_control',
    priority: 8,
    patterns: [
      /\b(save|store|remember|checkpoint|snapshot)\b/i,
      /\b(recall|retrieve|get|show)\b.*\b(saved|stored|remembered|context)\b/i,
      /\bdon'?t\s+forget\b/i,
      /\bkeep\s+track\b/i,
    ],
    contextClues: ['checkpoint', 'insight', 'context', 'memory'],
  },

  // Verify - PRE-DELIVERY VERIFICATION
  {
    intent: 'verify',
    priority: 9,
    patterns: [
      /\b(verify|validate|check)\s+(this|my|the)\s+(response|code|answer|output|package)\b/i,
      /\b(is\s+this|are\s+these)\s+(correct|right|accurate|true|real)\b/i,
      /\b(double[\s-]?check|fact[\s-]?check)\b/i,
      /\bdoes\s+(this|that)\s+package\s+exist\b/i,
      /\bcheck\s+for\s+(hallucination|errors|mistakes)\b/i,
    ],
    contextClues: ['package', 'hallucination', 'validate', 'accuracy'],
  },

  // Brainstorm - DEV THINKING PARTNER
  {
    intent: 'brainstorm',
    priority: 7,
    patterns: [
      /\b(brainstorm|ideate|think\s+through|map\s+out|explore)\b/i,
      /\b(help\s+me\s+(think|figure|work)\s+(through|out))\b/i,
      /\b(design|architect|plan)\b.*\b(feature|component|system|api)\b/i,
      /\bi\s+have\s+an?\s+idea\b/i,
      /\b(trade[\s-]?offs?|pros\s+and\s+cons|options)\b/i,
      /\b(rubber\s+duck|think\s+out\s+loud)\b/i,
    ],
    contextClues: ['architecture', 'design', 'feature', 'implementation'],
  },

  // Package Audit
  {
    intent: 'package_audit',
    priority: 7,
    patterns: [
      /\b(audit|check|validate)\b.*\b(packages?|dependencies|deps|npm|pypi)\b/i,
      /\b(outdated|deprecated|vulnerable)\b.*\b(packages?|dependencies)?\b/i,
      /\bnpm\s+audit\b/i,
      /\b(upgrade|update)\b.*\b(packages?|dependencies)\b/i,
      /\bsecurity\s+scan\b.*\b(packages?|deps)?\b/i,
    ],
    contextClues: ['npm', 'pypi', 'maven', 'cargo', 'dependencies'],
  },

  // Code Review
  {
    intent: 'code_review',
    priority: 7,
    patterns: [
      /\b(review|check|analyze|audit|inspect)\b.*\b(code|function|file|snippet)?\b/i,
      /\b(security|vulnerability)\b.*\b(check|scan|audit)\b/i,
      /\b(lint|linting|find\s+bugs?|detect\s+issues?)\b/i,
      /\bis\s+(this|it)\s+(safe|secure|ok|good)\b/i,
      /\bwhat'?s\s+wrong\s+with\b/i,
    ],
    contextClues: ['code', 'function', 'class', 'security', 'vulnerability'],
  },

  // Status/Dashboard
  {
    intent: 'status',
    priority: 5,
    patterns: [
      /\b(status|dashboard|overview|progress)\b/i,
      /\b(how\s+am\s+i\s+doing|what'?s\s+my\s+progress)\b/i,
      /\bwhat\s+do\s+you\s+know\s+about\s+me\b/i,
      /\bmy\s+(settings|preferences|history)\b/i,
      /\bwhere\s+should\s+i\s+start\b/i,
    ],
    contextClues: ['progress', 'history', 'settings', 'dashboard'],
  },

  // File Protection
  {
    intent: 'protect',
    priority: 6,
    patterns: [
      /\b(backup|protect|guard|freeze|lock)\b.*\b(file|code)?\b/i,
      /\b(rollback|undo|restore|revert)\b/i,
      /\bcode\s+freeze\b/i,
      /\bsafe\s+mode\b/i,
    ],
    contextClues: ['backup', 'rollback', 'freeze', 'protection'],
  },

  // Conversation Operations (summarize, reframe, etc.)
  {
    intent: 'conversation_ops',
    priority: 4,
    patterns: [
      /\b(summarize|summary|wrap\s+up|key\s+points)\b/i,
      /\b(reframe|rephrase|say\s+differently)\b/i,
      /\b(continue|elaborate|expand)\b/i,
      /\btalk\b.*\b(to\s+you|with\s+you)\b/i,
    ],
    contextClues: ['conversation', 'chat', 'message'],
  },
];

/**
 * Calculate confidence score based on pattern match quality
 */
function calculateConfidence(
  input: string,
  pattern: RegExp,
  intentPattern: IntentPattern,
): number {
  const match = input.match(pattern);
  if (!match) return 0;

  let confidence = 0.5; // Base confidence for any match

  // Boost for priority
  confidence += (intentPattern.priority || 0) * 0.03;

  // Boost for match coverage (how much of the input was matched)
  const matchCoverage = match[0].length / input.length;
  confidence += matchCoverage * 0.2;

  // Boost for exact matches at word boundaries
  if (match[0].toLowerCase() === input.toLowerCase().trim()) {
    confidence += 0.2;
  }

  // Context clues boost (would need actual context to implement fully)
  // For now, just check if any context keywords appear in the input
  if (intentPattern.contextClues) {
    const contextBoost = intentPattern.contextClues.filter(clue =>
      input.toLowerCase().includes(clue.toLowerCase())
    ).length * 0.05;
    confidence += Math.min(contextBoost, 0.15);
  }

  return Math.min(confidence, 1.0); // Cap at 1.0
}

/**
 * Detect if input contains multiple intents
 */
function detectMultiIntent(input: string, patterns: IntentPattern[]): string[] {
  const detectedIntents = new Set<string>();
  const segments = input.split(/\b(and|then|also|plus)\b/i);

  if (segments.length <= 1) return [];

  for (const segment of segments) {
    for (const intentPattern of patterns) {
      for (const pattern of intentPattern.patterns) {
        if (pattern.test(segment)) {
          detectedIntents.add(intentPattern.intent);
          break;
        }
      }
    }
  }

  return Array.from(detectedIntents);
}

/**
 * Main intent classification function
 */
export function classifyIntent(
  input: string,
  config: Partial<ClassifierConfig> = {},
): IntentResult {
  const cfg = { ...DEFAULT_CLASSIFIER_CONFIG, ...config };
  const normalizedInput = input.toLowerCase().trim();

  // Track all matches with confidence scores
  const matches: Array<{ intent: IntentClass; confidence: number; pattern: string }> = [];

  // Check all patterns and calculate confidence
  for (const intentPattern of INTENT_PATTERNS) {
    for (const pattern of intentPattern.patterns) {
      if (pattern.test(normalizedInput)) {
        const confidence = calculateConfidence(normalizedInput, pattern, intentPattern);
        matches.push({
          intent: intentPattern.intent,
          confidence,
          pattern: pattern.source,
        });
      }
    }
  }

  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);

  // Detect multi-intent if enabled
  let multiIntent = false;
  let decomposition: string[] = [];
  if (cfg.enableMultiIntentDetection) {
    decomposition = detectMultiIntent(normalizedInput, INTENT_PATTERNS);
    multiIntent = decomposition.length > 1;
  }

  // Determine primary intent and alternatives
  const primaryMatch = matches[0] || { intent: 'unknown' as IntentClass, confidence: 0 };
  const alternatives = matches
    .slice(1, cfg.maxAlternatives + 1)
    .filter(m => m.confidence > 0.1) // Filter out very low confidence alternatives
    .map(m => ({ intent: m.intent, confidence: m.confidence }));

  // Detect ambiguity if enabled
  let ambiguous = false;
  if (cfg.enableAmbiguityDetection && matches.length > 1) {
    // Consider it ambiguous if top two intents have similar confidence (within 0.15)
    const secondMatch = matches[1];
    if (secondMatch && primaryMatch.confidence - secondMatch.confidence < 0.15) {
      ambiguous = true;
    }
  }

  // Log classification for monitoring
  logger.debug('Intent classification', {
    input: normalizedInput,
    primaryIntent: primaryMatch.intent,
    confidence: primaryMatch.confidence,
    ambiguous,
    multiIntent,
    alternatives: alternatives.length,
    decomposition,
  });

  return {
    primaryIntent: primaryMatch.intent,
    confidence: primaryMatch.confidence,
    ambiguous,
    multiIntent,
    alternatives,
    decomposition: multiIntent ? decomposition : undefined,
  };
}

/**
 * Determine routing strategy based on classification confidence
 */
export function determineRoutingStrategy(
  result: IntentResult,
  config: Partial<ClassifierConfig> = {},
): 'direct' | 'router' | 'clarification' {
  const cfg = { ...DEFAULT_CLASSIFIER_CONFIG, ...config };

  // Multi-intent always goes through router for decomposition
  if (result.multiIntent) {
    return 'router';
  }

  // High confidence: direct route
  if (result.confidence >= cfg.directRouteThreshold) {
    return 'direct';
  }

  // Medium confidence or ambiguous: use router with explanation
  if (result.confidence >= cfg.routerRouteThreshold || result.ambiguous) {
    return 'router';
  }

  // Low confidence: ask for clarification
  return 'clarification';
}