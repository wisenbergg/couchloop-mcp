/**
 * CouchLoop Behavioral Governance Layer - Hallucination Detector
 *
 * Detects fabricated facts, false certainty, and unsupported claims in LLM responses
 */

import type { DetectionResult, SessionContext } from '../evaluationEngine.js';
import type { CriterionConfig } from '../config.js';

export class HallucinationDetector {
  private config: CriterionConfig;
  private certaintyPatterns: RegExp[];
  private statisticalPatterns: RegExp[];
  private authorityPatterns: RegExp[];
  private absolutePatterns: RegExp[];

  constructor(config: CriterionConfig) {
    this.config = config;

    // Compile regex patterns for performance
    this.certaintyPatterns = [
      /I have (direct|personal|firsthand) experience/i,
      /I (personally|directly) (know|experienced|saw|witnessed)/i,
      /In my (experience|life|years)/i,
      /I can (personally|directly) attest/i,
      /I've (seen|witnessed|observed) this (many times|often|frequently)/i
    ];

    this.statisticalPatterns = [
      /(\d+)% of (people|individuals|studies|research|cases|patients)/i,
      /(\d+) out of (\d+) (people|studies|cases)/i,
      /(studies|research) (consistently |always |invariably )?show/i,
      /according to (recent|latest|new) (research|studies|data)/i,
      /statistically proven/i,
      /data (clearly |definitively |conclusively )?shows/i,
      /peer-reviewed (research|studies) (confirm|prove|demonstrate)/i
    ];

    this.authorityPatterns = [
      /experts (agree|confirm|say|believe) that/i,
      /(all|most) (therapists|doctors|psychologists|psychiatrists) (recommend|agree|say)/i,
      /medical consensus is/i,
      /scientifically proven/i,
      /universally accepted/i,
      /leading authorities (confirm|state|agree)/i,
      /Nobel Prize winning/i,
      /Harvard study/i
    ];

    this.absolutePatterns = [
      /it['']s a (proven|established|known|undeniable) fact that/i,
      /(everyone|nobody) knows that/i,
      /absolutely (certain|guaranteed|proven)/i,
      /(always|never) (works|fails|happens)/i,
      /100% (effective|safe|certain|guaranteed)/i,
      /impossible to/i,
      /definitely will/i,
      /guaranteed to/i,
      /undoubtedly/i,
      /unquestionably/i
    ];

    // Add custom patterns from config
    if (config.patterns) {
      const customPatterns = config.patterns.map(p => new RegExp(p, 'i'));
      this.certaintyPatterns.push(...customPatterns);
    }
  }

  /**
   * Main detection method
   */
  async detect(response: string, context?: SessionContext): Promise<DetectionResult> {
    const detectedPatterns: string[] = [];
    let confidenceScore = 0;
    let detectionCount = 0;

    // Check for false personal experience claims
    const personalClaims = this.detectPersonalClaims(response);
    if (personalClaims.length > 0) {
      detectedPatterns.push(...personalClaims);
      confidenceScore += 0.3;
      detectionCount++;
    }

    // Check for unsupported statistical claims
    const statsClaims = this.detectStatisticalClaims(response);
    if (statsClaims.length > 0) {
      detectedPatterns.push(...statsClaims);
      confidenceScore += 0.25;
      detectionCount++;
    }

    // Check for false authority claims
    const authorityClaims = this.detectAuthorityClaims(response);
    if (authorityClaims.length > 0) {
      detectedPatterns.push(...authorityClaims);
      confidenceScore += 0.2;
      detectionCount++;
    }

    // Check for absolute statements
    const absoluteClaims = this.detectAbsoluteClaims(response);
    if (absoluteClaims.length > 0) {
      detectedPatterns.push(...absoluteClaims);
      confidenceScore += 0.25;
      detectionCount++;
    }

    // Check for fabricated technical terms
    const technicalTerms = this.detectFabricatedTerms(response);
    if (technicalTerms.length > 0) {
      detectedPatterns.push(...technicalTerms);
      confidenceScore += 0.2;
      detectionCount++;
    }

    // Contextual verification if context is provided
    if (context?.conversationHistory) {
      const contextualIssues = await this.verifyAgainstContext(response, context);
      if (contextualIssues.length > 0) {
        detectedPatterns.push(...contextualIssues);
        confidenceScore += 0.3;
        detectionCount++;
      }
    }

    // Normalize confidence score (cap at 1.0)
    confidenceScore = Math.min(confidenceScore, 1.0);

    // Apply threshold
    const detected = confidenceScore >= this.config.threshold;

    return {
      detected,
      confidence: confidenceScore,
      patterns: detectedPatterns,
      details: {
        detectionCount,
        personalClaims: personalClaims.length,
        statisticalClaims: statsClaims.length,
        authorityClaims: authorityClaims.length,
        absoluteClaims: absoluteClaims.length,
        threshold: this.config.threshold
      }
    };
  }

  /**
   * Detect false personal experience claims
   */
  private detectPersonalClaims(response: string): string[] {
    const detected: string[] = [];

    for (const pattern of this.certaintyPatterns) {
      const matches = response.match(pattern);
      if (matches) {
        detected.push(`Personal claim: "${matches[0]}"`);
      }
    }

    return detected;
  }

  /**
   * Detect unsupported statistical claims
   */
  private detectStatisticalClaims(response: string): string[] {
    const detected: string[] = [];

    for (const pattern of this.statisticalPatterns) {
      const matches = response.match(pattern);
      if (matches) {
        // Special check for specific percentages that seem fabricated
        if (matches[0].includes('%')) {
          const percentMatch = matches[0].match(/(\d+)%/);
          if (percentMatch && percentMatch[1]) {
            const percent = parseInt(percentMatch[1]);
            // Suspicious percentages (very specific or round numbers without context)
            if ((percent > 70 && percent < 100 && percent % 5 !== 0) ||
                (percent === 73 || percent === 87 || percent === 92)) {
              detected.push(`Suspicious statistic: "${matches[0]}"`);
              continue;
            }
          }
        }
        detected.push(`Statistical claim: "${matches[0]}"`);
      }
    }

    return detected;
  }

  /**
   * Detect false authority claims
   */
  private detectAuthorityClaims(response: string): string[] {
    const detected: string[] = [];

    for (const pattern of this.authorityPatterns) {
      const matches = response.match(pattern);
      if (matches) {
        detected.push(`Authority claim: "${matches[0]}"`);
      }
    }

    return detected;
  }

  /**
   * Detect absolute statements
   */
  private detectAbsoluteClaims(response: string): string[] {
    const detected: string[] = [];

    for (const pattern of this.absolutePatterns) {
      const matches = response.match(pattern);
      if (matches) {
        detected.push(`Absolute claim: "${matches[0]}"`);
      }
    }

    return detected;
  }

  /**
   * Detect potentially fabricated technical or medical terms
   */
  private detectFabricatedTerms(response: string): string[] {
    const detected: string[] = [];

    // Look for made-up sounding technical terms
    const suspiciousTermPatterns = [
      /neuro-?[a-z]+ive/i,  // Neuro-something-ive
      /psycho-?[a-z]+osis/i,  // Psycho-something-osis
      /[a-z]+pathic [a-z]+syndrome/i,  // X-pathic Y syndrome
      /cognitive [a-z]+ disorder/i,  // Cognitive X disorder (when X is unusual)
      /therapeutic [a-z]+ protocol/i,  // Therapeutic X protocol
    ];

    // Known legitimate terms to exclude
    const legitimateTerms = new Set([
      'cognitive behavioral therapy',
      'psychosis',
      'neurosis',
      'neuropathic',
      'psychopathic',
      'therapeutic intervention protocol'
    ]);

    for (const pattern of suspiciousTermPatterns) {
      const matches = response.match(pattern);
      if (matches) {
        const term = matches[0].toLowerCase();
        if (!legitimateTerms.has(term)) {
          detected.push(`Suspicious term: "${matches[0]}"`);
        }
      }
    }

    return detected;
  }

  /**
   * Verify claims against conversation context
   */
  private async verifyAgainstContext(
    response: string,
    context: SessionContext
  ): Promise<string[]> {
    const issues: string[] = [];

    if (!context.conversationHistory || context.conversationHistory.length === 0) {
      return issues;
    }

    // Check if the AI is claiming knowledge about the user that wasn't provided
    const userInfoClaims = [
      /you (said|mentioned|told me) (earlier |before |previously )?that/i,
      /as you (mentioned|said|explained)/i,
      /based on what you('ve)? (shared|told me|said)/i,
      /you have (a |an )?[a-z]+ (condition|disorder|issue)/i,
      /your [a-z]+ (problem|issue|condition)/i
    ];

    for (const pattern of userInfoClaims) {
      const matches = response.match(pattern);
      if (matches) {
        // Try to verify if this was actually mentioned
        const claimedInfo = matches[0];
        let foundInHistory = false;

        for (const msg of context.conversationHistory) {
          if (msg.role === 'user' && this.fuzzyMatch(claimedInfo, msg.content)) {
            foundInHistory = true;
            break;
          }
        }

        if (!foundInHistory) {
          issues.push(`Unverified claim about user: "${claimedInfo}"`);
        }
      }
    }

    // Check for contradictions with earlier messages
    const currentClaims = this.extractClaims(response);
    const historicalClaims = context.conversationHistory
      .filter(msg => msg.role === 'assistant')
      .flatMap(msg => this.extractClaims(msg.content));

    for (const currentClaim of currentClaims) {
      for (const historicalClaim of historicalClaims) {
        if (this.areContradictory(currentClaim, historicalClaim)) {
          issues.push(`Contradiction detected: Current: "${currentClaim}" vs Earlier: "${historicalClaim}"`);
        }
      }
    }

    return issues;
  }

  /**
   * Extract factual claims from text
   */
  private extractClaims(text: string): string[] {
    const claims: string[] = [];

    // Patterns that indicate factual claims
    const claimPatterns = [
      /[A-Z][^.!?]+ is [^.!?]+[.!?]/g,
      /[A-Z][^.!?]+ are [^.!?]+[.!?]/g,
      /[A-Z][^.!?]+ causes [^.!?]+[.!?]/g,
      /[A-Z][^.!?]+ leads to [^.!?]+[.!?]/g,
      /[A-Z][^.!?]+ results in [^.!?]+[.!?]/g
    ];

    for (const pattern of claimPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        claims.push(...matches);
      }
    }

    return claims;
  }

  /**
   * Check if two claims are contradictory
   */
  private areContradictory(claim1: string, claim2: string): boolean {
    // Simple contradiction detection - can be enhanced
    const normalized1 = claim1.toLowerCase();
    const normalized2 = claim2.toLowerCase();

    // Check for opposite modals
    if (
      (normalized1.includes(' is ') && normalized2.includes(' is not ')) ||
      (normalized1.includes(' is not ') && normalized2.includes(' is ')) ||
      (normalized1.includes(' will ') && normalized2.includes(' will not ')) ||
      (normalized1.includes(' can ') && normalized2.includes(' cannot '))
    ) {
      // Check if they're about the same subject
      const subject1 = normalized1.split(' is ')[0] || normalized1.split(' will ')[0] || normalized1;
      const subject2 = normalized2.split(' is ')[0] || normalized2.split(' will ')[0] || normalized2;

      return this.fuzzyMatch(subject1, subject2);
    }

    return false;
  }

  /**
   * Fuzzy string matching for similarity
   */
  private fuzzyMatch(str1: string, str2: string): boolean {
    const normalized1 = str1.toLowerCase().trim();
    const normalized2 = str2.toLowerCase().trim();

    // Check for substring match
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      return true;
    }

    // Check for high word overlap
    const words1 = new Set(normalized1.split(/\s+/));
    const words2 = new Set(normalized2.split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const overlapRatio = intersection.size / Math.min(words1.size, words2.size);

    return overlapRatio > 0.6;
  }

  /**
   * Update configuration
   */
  updateConfig(config: CriterionConfig): void {
    this.config = config;
  }
}

export default HallucinationDetector;