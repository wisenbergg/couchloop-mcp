/**
 * CouchLoop Behavioral Governance Layer - Intervention Engine
 *
 * Handles response blocking, modification, rewriting, and fallback responses
 * based on governance evaluation results
 */

import {
  type EvaluationResult,
  InterventionAction,
  RiskLevel
} from './evaluationEngine.js';
import { loadConfig, type GovernanceConfig } from './config.js';

export interface InterventionResult {
  action: InterventionAction;
  originalResponse: string;
  finalResponse: string;
  modified: boolean;
  reason: string;
  modifications?: ModificationDetail[];
  confidence: number;
}

interface ModificationDetail {
  type: 'removed' | 'replaced' | 'softened' | 'neutralized';
  original: string;
  modified: string;
  reason: string;
}

export class InterventionEngine {
  private config: GovernanceConfig;

  constructor(config?: GovernanceConfig) {
    this.config = config || loadConfig();
  }

  /**
   * Main intervention method - applies appropriate action based on evaluation
   */
  async intervene(
    action: InterventionAction,
    originalResponse: string,
    evaluationResult: EvaluationResult
  ): Promise<InterventionResult> {
    switch (action) {
      case InterventionAction.APPROVE:
        return this.approve(originalResponse, evaluationResult);

      case InterventionAction.BLOCK:
        return this.block(originalResponse, evaluationResult);

      case InterventionAction.MODIFY:
        return this.modify(originalResponse, evaluationResult);

      case InterventionAction.FALLBACK:
        return this.fallback(originalResponse, evaluationResult);

      default:
        // Default to approval if unknown action
        return this.approve(originalResponse, evaluationResult);
    }
  }

  /**
   * Approve response without modification
   */
  private approve(originalResponse: string, evaluation: EvaluationResult): InterventionResult {
    return {
      action: InterventionAction.APPROVE,
      originalResponse,
      finalResponse: originalResponse,
      modified: false,
      reason: 'Response approved - no governance issues detected',
      confidence: evaluation.confidence
    };
  }

  /**
   * Block response and provide safe alternative
   */
  private block(originalResponse: string, evaluation: EvaluationResult): InterventionResult {
    let reason = 'Response blocked due to: ';
    const issues: string[] = [];

    // Compile blocking reasons
    if (evaluation.unsafeReasoning.detected) {
      issues.push('unsafe reasoning patterns');
    }
    if (evaluation.hallucination.detected) {
      issues.push('potential hallucination');
    }
    if (evaluation.inconsistency.detected) {
      issues.push('logical inconsistencies');
    }
    if (evaluation.toneDrift.detected) {
      issues.push('problematic tone drift');
    }

    reason += issues.join(', ');

    // Select appropriate fallback message
    let finalResponse: string;

    if (evaluation.overallRisk === RiskLevel.CRITICAL ||
        (evaluation.unsafeReasoning.detected && evaluation.unsafeReasoning.confidence > 0.8)) {
      // Crisis or high-risk situation
      finalResponse = this.config.fallbackResponses.crisis;
    } else {
      // General blocked response
      finalResponse = this.config.fallbackResponses.blocked;
    }

    return {
      action: InterventionAction.BLOCK,
      originalResponse,
      finalResponse,
      modified: true,
      reason,
      confidence: evaluation.confidence
    };
  }

  /**
   * Modify response to remove or soften problematic content
   */
  private modify(originalResponse: string, evaluation: EvaluationResult): InterventionResult {
    let modifiedResponse = originalResponse;
    const modifications: ModificationDetail[] = [];

    // Apply modifications based on detected issues
    if (evaluation.hallucination.detected && evaluation.hallucination.patterns) {
      modifiedResponse = this.removeHallucinatedContent(
        modifiedResponse,
        evaluation.hallucination.patterns,
        modifications
      );
    }

    if (evaluation.unsafeReasoning.detected && evaluation.unsafeReasoning.patterns) {
      modifiedResponse = this.removeUnsafeContent(
        modifiedResponse,
        evaluation.unsafeReasoning.patterns,
        modifications
      );
    }

    if (evaluation.toneDrift.detected && evaluation.toneDrift.patterns) {
      modifiedResponse = this.neutralizeTone(
        modifiedResponse,
        modifications
      );
    }

    if (evaluation.inconsistency.detected && evaluation.inconsistency.patterns) {
      modifiedResponse = this.softenClaims(
        modifiedResponse,
        evaluation.inconsistency.patterns,
        modifications
      );
    }

    // If modifications were too extensive, use fallback
    if (this.tooMuchRemoved(originalResponse, modifiedResponse)) {
      return this.fallback(originalResponse, evaluation);
    }

    // Add modification prefix if configured
    if (modifiedResponse !== originalResponse && this.config.fallbackResponses.modified) {
      modifiedResponse = this.config.fallbackResponses.modified + '\n\n' + modifiedResponse;
    }

    return {
      action: InterventionAction.MODIFY,
      originalResponse,
      finalResponse: modifiedResponse,
      modified: true,
      reason: `Response modified to address: ${modifications.map(m => m.reason).join(', ')}`,
      modifications,
      confidence: evaluation.confidence
    };
  }

  /**
   * Replace with safe fallback response
   */
  private fallback(originalResponse: string, evaluation: EvaluationResult): InterventionResult {
    // Select contextually appropriate fallback
    let finalResponse: string;
    let reason = 'Using fallback response due to: ';

    if (evaluation.overallRisk === RiskLevel.CRITICAL) {
      finalResponse = this.config.fallbackResponses.crisis;
      reason += 'critical safety concerns';
    } else if (evaluation.unsafeReasoning.detected) {
      finalResponse = this.config.fallbackResponses.crisis;
      reason += 'unsafe reasoning detected';
    } else if (evaluation.overallRisk === RiskLevel.HIGH) {
      finalResponse = this.config.fallbackResponses.blocked;
      reason += 'high risk content';
    } else {
      finalResponse = this.config.fallbackResponses.error;
      reason += 'multiple governance issues';
    }

    return {
      action: InterventionAction.FALLBACK,
      originalResponse,
      finalResponse,
      modified: true,
      reason,
      confidence: evaluation.confidence
    };
  }

  /**
   * Remove hallucinated content from response
   */
  private removeHallucinatedContent(
    response: string,
    patterns: string[],
    modifications: ModificationDetail[]
  ): string {
    let modified = response;

    for (const pattern of patterns) {
      // Extract the problematic phrase from the pattern description
      const match = pattern.match(/: "(.+)"/);
      if (match && match[1]) {
        const problematicPhrase = match[1];

        if (modified.includes(problematicPhrase)) {
          // Remove the sentence containing the problematic phrase
          const sentences = modified.split(/(?<=[.!?])\s+/);
          const filteredSentences = sentences.filter(s => !s.includes(problematicPhrase));

          if (filteredSentences.length < sentences.length) {
            modifications.push({
              type: 'removed',
              original: sentences.find(s => s.includes(problematicPhrase)) || problematicPhrase,
              modified: '',
              reason: 'hallucinated content'
            });
            modified = filteredSentences.join(' ');
          }
        }
      }
    }

    // Replace absolute certainty with hedged language
    const certaintyReplacements: [RegExp, string][] = [
      [/definitely will/gi, 'might'],
      [/absolutely certain/gi, 'possible'],
      [/guaranteed to/gi, 'may'],
      [/proven fact/gi, 'current understanding'],
      [/everyone knows/gi, 'it is commonly believed'],
      [/always works/gi, 'often helps'],
      [/never fails/gi, 'typically effective']
    ];

    for (const [pattern, replacement] of certaintyReplacements) {
      const before = modified;
      modified = modified.replace(pattern, replacement);
      if (before !== modified) {
        modifications.push({
          type: 'replaced',
          original: pattern.source,
          modified: replacement,
          reason: 'reduced false certainty'
        });
      }
    }

    return modified;
  }

  /**
   * Remove unsafe content from response
   */
  private removeUnsafeContent(
    response: string,
    patterns: string[],
    modifications: ModificationDetail[]
  ): string {
    let modified = response;

    for (const pattern of patterns) {
      // Extract the problematic phrase
      const match = pattern.match(/: "(.+)"/);
      if (match && match[1]) {
        const unsafePhrase = match[1];

        // Check if this is critical content that should be removed entirely
        if (pattern.includes('critical') || pattern.includes('Suicide') || pattern.includes('Self-harm')) {
          // Remove entire sentences containing critical unsafe content
          const sentences = modified.split(/(?<=[.!?])\s+/);
          const safeSentences = sentences.filter(s => !s.toLowerCase().includes(unsafePhrase.toLowerCase()));

          if (safeSentences.length < sentences.length) {
            modifications.push({
              type: 'removed',
              original: sentences.find(s => s.toLowerCase().includes(unsafePhrase.toLowerCase())) || unsafePhrase,
              modified: '',
              reason: 'critical safety concern'
            });
            modified = safeSentences.join(' ');
          }
        } else {
          // For non-critical unsafe content, try to soften or replace
          const safeAlternatives: Record<string, string> = {
            'you should definitely': 'you might consider',
            'you must': 'it could be helpful to',
            'stop taking your medication': 'discuss your medication concerns with your doctor',
            "don't need therapy": 'therapy is a personal choice',
            'ignore what they said': 'consider different perspectives',
            "don't tell anyone": 'sharing with trusted people can help'
          };

          for (const [unsafe, safe] of Object.entries(safeAlternatives)) {
            if (modified.toLowerCase().includes(unsafe)) {
              modified = modified.replace(new RegExp(unsafe, 'gi'), safe);
              modifications.push({
                type: 'replaced',
                original: unsafe,
                modified: safe,
                reason: 'unsafe advice neutralized'
              });
            }
          }
        }
      }
    }

    return modified;
  }

  /**
   * Neutralize problematic tone in response
   */
  private neutralizeTone(
    response: string,
    modifications: ModificationDetail[]
  ): string {
    let modified = response;

    // Tone neutralization replacements
    const toneReplacements: [RegExp, string][] = [
      // Over-reassurance
      [/everything will be (fine|perfect|great)/gi, 'things may improve'],
      [/don't worry about anything/gi, "it's natural to have concerns"],
      [/absolutely no risk/gi, 'relatively low risk'],
      [/I promise/gi, 'I believe'],

      // Over-directive
      [/you must/gi, 'you might consider'],
      [/you have to/gi, 'it could help to'],
      [/you need to/gi, 'you may want to'],
      [/it's essential that you/gi, 'it could be beneficial to'],

      // Manipulative
      [/only I can help/gi, 'support is available'],
      [/you need me/gi, 'support can help'],
      [/trust me, not them/gi, 'consider various perspectives'],

      // Dependency-forming
      [/I'll always be here/gi, 'support is available'],
      [/come back to me anytime/gi, 'help is available when needed'],
      [/you can't do this without me/gi, 'support can be helpful']
    ];

    for (const [pattern, replacement] of toneReplacements) {
      const matches = modified.match(pattern);
      if (matches) {
        modified = modified.replace(pattern, replacement);
        modifications.push({
          type: 'neutralized',
          original: matches[0],
          modified: replacement,
          reason: 'tone neutralization'
        });
      }
    }

    // Remove excessive emotional language
    const emotionalWords = /\b(amazing|terrible|horrible|perfect|disaster|catastrophe|miracle)\b/gi;
    const emotionalMatches = modified.match(emotionalWords);
    if (emotionalMatches && emotionalMatches.length > 2) {
      // Replace with more neutral terms
      modified = modified
        .replace(/\bamazing\b/gi, 'positive')
        .replace(/\bterrible\b/gi, 'difficult')
        .replace(/\bhorrible\b/gi, 'challenging')
        .replace(/\bperfect\b/gi, 'good')
        .replace(/\bdisaster\b/gi, 'setback')
        .replace(/\bcatastrophe\b/gi, 'difficulty')
        .replace(/\bmiracle\b/gi, 'improvement');

      modifications.push({
        type: 'neutralized',
        original: 'excessive emotional language',
        modified: 'neutral terms',
        reason: 'emotional de-escalation'
      });
    }

    return modified;
  }

  /**
   * Soften claims to address inconsistencies
   */
  private softenClaims(
    response: string,
    patterns: string[],
    modifications: ModificationDetail[]
  ): string {
    let modified = response;

    // Add hedging language to strong claims
    const hedgeReplacements: [RegExp, string][] = [
      [/\bis\b/gi, 'may be'],
      [/\bare\b/gi, 'might be'],
      [/\bwill\b/gi, 'could'],
      [/\balways\b/gi, 'often'],
      [/\bnever\b/gi, 'rarely'],
      [/\bdefinitely\b/gi, 'probably'],
      [/\bcertainly\b/gi, 'likely']
    ];

    // Only apply hedging to sentences mentioned in contradiction patterns
    for (const pattern of patterns) {
      if (pattern.includes('Contradiction') || pattern.includes('Reversal')) {
        // Extract the current claim from the pattern
        const match = pattern.match(/Current: "(.+?)"/);
        if (match && match[1]) {
          const claim = match[1];

          // Find and soften this claim in the response
          if (modified.includes(claim)) {
            let softenedClaim = claim;
            for (const [original, hedged] of hedgeReplacements) {
              softenedClaim = softenedClaim.replace(original, hedged);
            }

            if (softenedClaim !== claim) {
              modified = modified.replace(claim, softenedClaim);
              modifications.push({
                type: 'softened',
                original: claim,
                modified: softenedClaim,
                reason: 'addressing inconsistency'
              });
            }
          }
        }
      }
    }

    return modified;
  }

  /**
   * Check if too much content was removed
   */
  private tooMuchRemoved(original: string, modified: string): boolean {
    const originalLength = original.length;
    const modifiedLength = modified.length;

    // If more than 60% was removed, use fallback instead
    const removalRatio = (originalLength - modifiedLength) / originalLength;
    return removalRatio > 0.6;
  }

  /**
   * Apply intervention based on evaluation without explicit action
   */
  async autoIntervene(
    originalResponse: string,
    evaluationResult: EvaluationResult
  ): Promise<InterventionResult> {
    // Use the recommended action from evaluation
    const action = evaluationResult.recommendedAction;
    return this.intervene(action, originalResponse, evaluationResult);
  }

  /**
   * Generate explanation for intervention
   */
  generateExplanation(result: InterventionResult): string {
    if (!result.modified) {
      return 'Response approved without modifications.';
    }

    let explanation = `Governance intervention applied (${result.action}): ${result.reason}\n`;

    if (result.modifications && result.modifications.length > 0) {
      explanation += '\nModifications made:\n';
      for (const mod of result.modifications) {
        explanation += `- ${mod.type}: ${mod.reason}\n`;
        if (mod.original && mod.modified) {
          explanation += `  From: "${mod.original}"\n`;
          explanation += `  To: "${mod.modified}"\n`;
        }
      }
    }

    explanation += `\nConfidence: ${(result.confidence * 100).toFixed(1)}%`;

    return explanation;
  }

  /**
   * Update configuration
   */
  updateConfig(config: GovernanceConfig): void {
    this.config = config;
  }
}

export default InterventionEngine;