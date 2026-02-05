/**
 * CouchLoop Behavioral Governance Layer - Inconsistency Checker
 *
 * Detects contradictions with earlier turns, sudden reversals in advice,
 * and logical incoherence across conversation history
 */

import type { DetectionResult, SessionContext } from '../evaluationEngine.js';
import type { CriterionConfig } from '../config.js';
import { getDb } from '../../db/client.js';
import { checkpoints } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';

interface Claim {
  content: string;
  type: 'fact' | 'advice' | 'opinion' | 'commitment';
  subject?: string;
  predicate?: string;
  confidence: number;
  messageIndex?: number;
}

interface Contradiction {
  current: Claim;
  previous: Claim;
  type: 'direct' | 'reversal' | 'logical';
  severity: 'low' | 'medium' | 'high';
}

export class InconsistencyChecker {
  private config: CriterionConfig;
  private lookbackLimit: number;

  constructor(config: CriterionConfig) {
    this.config = config;
    this.lookbackLimit = config.metadata?.lookbackLimit || 10;
  }

  /**
   * Main check method - detects inconsistencies with conversation history
   */
  async check(response: string, context?: SessionContext): Promise<DetectionResult> {
    if (!context?.sessionId) {
      // Can't check consistency without context
      return {
        detected: false,
        confidence: 0,
        patterns: [],
        details: { reason: 'No session context provided' }
      };
    }

    // Load conversation history if not provided
    const history = await this.loadConversationHistory(context);

    // Extract claims from current response
    const currentClaims = this.extractClaims(response);

    // Extract claims from history
    const historicalClaims = this.extractHistoricalClaims(history);

    // Find contradictions
    const contradictions = this.findContradictions(currentClaims, historicalClaims);

    // Check for logical incoherence
    const logicalIssues = this.checkLogicalCoherence(response);

    // Check for sudden tone/approach reversals
    const reversals = this.checkReversals(response, history);

    // Calculate confidence score
    const confidence = this.calculateConfidence(contradictions, logicalIssues, reversals);

    // Compile detected patterns
    const patterns: string[] = [
      ...contradictions.map(c => this.formatContradiction(c)),
      ...logicalIssues,
      ...reversals
    ];

    const detected = confidence >= this.config.threshold;

    return {
      detected,
      confidence,
      patterns,
      details: {
        contradictionCount: contradictions.length,
        logicalIssues: logicalIssues.length,
        reversals: reversals.length,
        historicalMessagesChecked: history.length,
        threshold: this.config.threshold
      }
    };
  }

  /**
   * Load conversation history from database
   */
  private async loadConversationHistory(context: SessionContext): Promise<Array<{ role: string; content: string }>> {
    if (context.conversationHistory) {
      return context.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    }

    // Load from database
    const db = getDb();
    const sessionCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, context.sessionId!))
      .orderBy(desc(checkpoints.createdAt))
      .limit(this.lookbackLimit * 2); // Get both user and assistant messages

    const history: Array<{ role: string; content: string }> = [];

    for (const checkpoint of sessionCheckpoints) {
      if (checkpoint.key === 'user-message' || checkpoint.key === 'assistant-message') {
        const value = checkpoint.value as any;
        history.push({
          role: checkpoint.key === 'user-message' ? 'user' : 'assistant',
          content: value.message || value.content || ''
        });
      }
    }

    return history.reverse(); // Return in chronological order
  }

  /**
   * Extract claims from text
   */
  private extractClaims(text: string): Claim[] {
    const claims: Claim[] = [];

    // Extract factual statements
    const factPatterns = [
      /([A-Z][^.!?]+) (is|are|was|were) ([^.!?]+)[.!?]/g,
      /([A-Z][^.!?]+) (will|would|can|could|should) ([^.!?]+)[.!?]/g,
      /([A-Z][^.!?]+) (causes|leads to|results in) ([^.!?]+)[.!?]/g,
    ];

    for (const pattern of factPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({
          content: match[0],
          type: 'fact',
          subject: match[1],
          predicate: match[3],
          confidence: 0.8
        });
      }
    }

    // Extract advice statements
    const advicePatterns = [
      /you (should|must|need to|ought to) ([^.!?]+)[.!?]/gi,
      /I (recommend|suggest|advise) ([^.!?]+)[.!?]/gi,
      /(try|consider|think about) ([^.!?]+)[.!?]/gi,
    ];

    for (const pattern of advicePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({
          content: match[0],
          type: 'advice',
          confidence: 0.9
        });
      }
    }

    // Extract commitments/promises
    const commitmentPatterns = [
      /I (will|can|am going to) ([^.!?]+)[.!?]/gi,
      /we (will|can) ([^.!?]+)[.!?]/gi,
      /(always|never) ([^.!?]+)[.!?]/gi,
    ];

    for (const pattern of commitmentPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({
          content: match[0],
          type: 'commitment',
          confidence: 0.9
        });
      }
    }

    return claims;
  }

  /**
   * Extract claims from historical messages
   */
  private extractHistoricalClaims(history: Array<{ role: string; content: string }>): Claim[] {
    const claims: Claim[] = [];

    history.forEach((msg, index) => {
      if (msg.role === 'assistant') {
        const msgClaims = this.extractClaims(msg.content || '');
        msgClaims.forEach(claim => {
          claim.messageIndex = index;
        });
        claims.push(...msgClaims);
      }
    });

    return claims;
  }

  /**
   * Find contradictions between current and historical claims
   */
  private findContradictions(currentClaims: Claim[], historicalClaims: Claim[]): Contradiction[] {
    const contradictions: Contradiction[] = [];

    for (const current of currentClaims) {
      for (const historical of historicalClaims) {
        // Check for direct contradictions
        if (this.areContradictory(current, historical)) {
          contradictions.push({
            current,
            previous: historical,
            type: 'direct',
            severity: this.assessSeverity(current, historical)
          });
        }

        // Check for reversals in advice
        if (current.type === 'advice' && historical.type === 'advice') {
          if (this.isReversal(current.content, historical.content)) {
            contradictions.push({
              current,
              previous: historical,
              type: 'reversal',
              severity: 'medium'
            });
          }
        }
      }
    }

    return contradictions;
  }

  /**
   * Check if two claims are contradictory
   */
  private areContradictory(claim1: Claim, claim2: Claim): boolean {
    if (!claim1.subject || !claim2.subject) {
      return false;
    }

    // Check if claims are about the same subject
    const sameSubject = this.fuzzyMatch(claim1.subject, claim2.subject);
    if (!sameSubject) {
      return false;
    }

    const text1 = claim1.content.toLowerCase();
    const text2 = claim2.content.toLowerCase();

    // Check for opposite modals
    const opposites = [
      ['is', 'is not'],
      ['are', 'are not'],
      ['will', 'will not'],
      ['can', 'cannot'],
      ['should', 'should not'],
      ['must', 'must not'],
      ['always', 'never'],
      ['all', 'none'],
      ['everyone', 'no one']
    ];

    for (const [pos, neg] of opposites) {
      if (text1 && text2 && pos && neg &&
          ((text1.includes(pos) && text2.includes(neg)) ||
           (text1.includes(neg) && text2.includes(pos)))) {
        return true;
      }
    }

    // Check for contradictory predicates
    if (claim1.predicate && claim2.predicate) {
      const pred1 = claim1.predicate.toLowerCase();
      const pred2 = claim2.predicate.toLowerCase();

      const contradictoryPredicates = [
        ['helpful', 'harmful'],
        ['safe', 'dangerous'],
        ['effective', 'ineffective'],
        ['good', 'bad'],
        ['increase', 'decrease'],
        ['improve', 'worsen']
      ];

      for (const [p1, p2] of contradictoryPredicates) {
        if (p1 && p2 && pred1 && pred2 &&
            ((pred1.includes(p1) && pred2.includes(p2)) ||
             (pred1.includes(p2) && pred2.includes(p1)))) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if advice has been reversed
   */
  private isReversal(current: string, previous: string): boolean {
    const curr = current.toLowerCase();
    const prev = previous.toLowerCase();

    // Extract the core advice (what to do)
    const currAction = this.extractAction(curr);
    const prevAction = this.extractAction(prev);

    if (!currAction || !prevAction) {
      return false;
    }

    // Check if actions are opposites
    const oppositeActions = [
      ['continue', 'stop'],
      ['start', 'stop'],
      ['increase', 'decrease'],
      ['more', 'less'],
      ['focus on', 'avoid'],
      ['embrace', 'resist']
    ];

    // TypeScript requires explicit non-null assertion after the check
    const currActionStr = currAction as string;
    const prevActionStr = prevAction as string;

    for (const [a1, a2] of oppositeActions) {
      if (a1 && a2 &&
          ((currActionStr.includes(a1) && prevActionStr.includes(a2)) ||
           (currActionStr.includes(a2) && prevActionStr.includes(a1)))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract action from advice statement
   */
  private extractAction(advice: string): string | null {
    // Remove common advice prefixes
    let action = advice
      .replace(/you (should|must|need to|ought to) /i, '')
      .replace(/I (recommend|suggest|advise) /i, '')
      .replace(/(try|consider|think about) /i, '');

    const trimmed = action.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Check for logical coherence issues
   */
  private checkLogicalCoherence(response: string): string[] {
    const issues: string[] = [];

    // Check for self-contradictions within the response
    const sentences = response.match(/[^.!?]+[.!?]/g) || [];

    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        const sent1 = sentences[i];
        const sent2 = sentences[j];
        if (sent1 && sent2 && this.areSentencesContradictory(sent1, sent2)) {
          issues.push(`Self-contradiction: "${sent1.trim()}" vs "${sent2.trim()}"`);
        }
      }
    }

    // Check for impossible combinations
    const impossiblePatterns = [
      /always .+ and never/i,
      /both .+ and not/i,
      /completely .+ but also not/i,
      /100% .+ but sometimes/i
    ];

    for (const pattern of impossiblePatterns) {
      if (pattern.test(response)) {
        const match = response.match(pattern);
        if (match) {
          issues.push(`Logical impossibility: "${match[0]}"`);
        }
      }
    }

    // Check for circular reasoning
    if (this.detectCircularReasoning(response)) {
      issues.push('Circular reasoning detected');
    }

    return issues;
  }

  /**
   * Check if two sentences within the same response are contradictory
   */
  private areSentencesContradictory(sent1: string, sent2: string): boolean {
    const s1 = sent1.toLowerCase().trim();
    const s2 = sent2.toLowerCase().trim();

    // Look for opposite statements about the same thing
    const subject1 = this.extractSubject(s1);
    const subject2 = this.extractSubject(s2);

    if (subject1 && subject2 && this.fuzzyMatch(subject1, subject2)) {
      // Check for opposite predicates
      if ((s1.includes(' is ') && s2.includes(' is not ')) ||
          (s1.includes(' will ') && s2.includes(' won\'t ')) ||
          (s1.includes(' can ') && s2.includes(' cannot '))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract subject from sentence
   */
  private extractSubject(sentence: string): string | null {
    const patterns = [
      /^([a-z\s]+) (is|are|will|can|should)/i,
      /^(this|that|it) /i
    ];

    for (const pattern of patterns) {
      const match = sentence.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Detect circular reasoning patterns
   */
  private detectCircularReasoning(text: string): boolean {
    const patterns = [
      /because .+ therefore .+ because/i,
      /this is true because .+ which is true because/i,
      /A causes B.+B causes A/i
    ];

    return patterns.some(p => p.test(text));
  }

  /**
   * Check for sudden reversals in approach or tone
   */
  private checkReversals(response: string, history: Array<{ role: string; content: string }>): string[] {
    const reversals: string[] = [];

    // Get the last assistant message
    const lastAssistantMsg = history
      .filter(msg => msg.role === 'assistant')
      .pop();

    if (!lastAssistantMsg) {
      return reversals;
    }

    // Check for approach reversal
    const lastApproach = this.identifyApproach(lastAssistantMsg.content);
    const currentApproach = this.identifyApproach(response);

    if (lastApproach && currentApproach && lastApproach !== currentApproach) {
      if (this.areApproachesOpposite(lastApproach, currentApproach)) {
        reversals.push(`Approach reversal: from ${lastApproach} to ${currentApproach}`);
      }
    }

    // Check for stance reversal on key topics
    const lastStances = this.extractStances(lastAssistantMsg.content);
    const currentStances = this.extractStances(response);

    for (const [topic, lastStance] of Object.entries(lastStances)) {
      if (currentStances[topic] && currentStances[topic] !== lastStance) {
        reversals.push(`Stance reversal on ${topic}: from ${lastStance} to ${currentStances[topic]}`);
      }
    }

    return reversals;
  }

  /**
   * Identify the therapeutic approach being used
   */
  private identifyApproach(text: string): string | null {
    const approaches: Record<string, string[]> = {
      'directive': ['you must', 'you should', 'you need to', 'it\'s important that you'],
      'exploratory': ['what do you think', 'how do you feel', 'tell me more', 'let\'s explore'],
      'supportive': ['I understand', 'that must be', 'I hear you', 'it\'s okay'],
      'challenging': ['have you considered', 'what if', 'perhaps', 'might it be']
    };

    const textLower = text.toLowerCase();

    for (const [approach, markers] of Object.entries(approaches)) {
      if (markers.some(marker => textLower.includes(marker))) {
        return approach;
      }
    }

    return null;
  }

  /**
   * Check if two approaches are opposite
   */
  private areApproachesOpposite(approach1: string, approach2: string): boolean {
    const opposites = [
      ['directive', 'exploratory'],
      ['supportive', 'challenging']
    ];

    return opposites.some(([a, b]) =>
      (approach1 === a && approach2 === b) || (approach1 === b && approach2 === a)
    );
  }

  /**
   * Extract stances on various topics
   */
  private extractStances(text: string): Record<string, string> {
    const stances: Record<string, string> = {};
    const textLower = text.toLowerCase();

    // Check stance on medication
    if (textLower.includes('medication')) {
      if (textLower.includes('important') || textLower.includes('necessary')) {
        stances['medication'] = 'pro';
      } else if (textLower.includes('optional') || textLower.includes('not necessary')) {
        stances['medication'] = 'neutral';
      } else if (textLower.includes('avoid') || textLower.includes('harmful')) {
        stances['medication'] = 'against';
      }
    }

    // Check stance on therapy
    if (textLower.includes('therapy') || textLower.includes('therapist')) {
      if (textLower.includes('helpful') || textLower.includes('beneficial')) {
        stances['therapy'] = 'positive';
      } else if (textLower.includes('not helpful') || textLower.includes('waste')) {
        stances['therapy'] = 'negative';
      }
    }

    return stances;
  }

  /**
   * Assess severity of contradiction
   */
  private assessSeverity(claim1: Claim, claim2: Claim): 'low' | 'medium' | 'high' {
    // High severity for medical/safety contradictions
    if (claim1.content.match(/medication|treatment|therapy|harm|safety/i)) {
      return 'high';
    }

    // High severity for factual contradictions
    if (claim1.type === 'fact' && claim2.type === 'fact') {
      return 'high';
    }

    // Medium severity for advice reversals
    if (claim1.type === 'advice' && claim2.type === 'advice') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidence(
    contradictions: Contradiction[],
    logicalIssues: string[],
    reversals: string[]
  ): number {
    let confidence = 0;

    // Weight contradictions by severity
    for (const contradiction of contradictions) {
      switch (contradiction.severity) {
        case 'high':
          confidence += 0.3;
          break;
        case 'medium':
          confidence += 0.2;
          break;
        case 'low':
          confidence += 0.1;
          break;
      }
    }

    // Add confidence for logical issues
    confidence += logicalIssues.length * 0.15;

    // Add confidence for reversals
    confidence += reversals.length * 0.2;

    // Cap at 1.0
    return Math.min(confidence, 1.0);
  }

  /**
   * Format contradiction for output
   */
  private formatContradiction(contradiction: Contradiction): string {
    const type = contradiction.type === 'direct' ? 'Contradiction' :
                  contradiction.type === 'reversal' ? 'Reversal' : 'Logical issue';

    return `${type} (${contradiction.severity}): Current: "${contradiction.current.content}" vs Previous: "${contradiction.previous.content}"`;
  }

  /**
   * Fuzzy string matching
   */
  private fuzzyMatch(str1: string, str2: string): boolean {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    // Direct match
    if (s1 === s2) return true;

    // Substring match
    if (s1.includes(s2) || s2.includes(s1)) return true;

    // Word overlap
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const overlapRatio = intersection.size / Math.min(words1.size, words2.size);

    return overlapRatio > 0.6;
  }

  /**
   * Update configuration
   */
  updateConfig(config: CriterionConfig): void {
    this.config = config;
    this.lookbackLimit = config.metadata?.lookbackLimit || 10;
  }
}

export default InconsistencyChecker;