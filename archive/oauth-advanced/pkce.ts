import { createHash, randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';

/**
 * PKCE Challenge data structure
 */
export interface PKCEChallenge {
  challenge: string;
  method: 'S256' | 'plain';
  clientId: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * PKCE (Proof Key for Code Exchange) Manager
 * Implements RFC 7636 for OAuth 2.0 public clients
 * Prevents authorization code interception attacks
 */
export class PKCEManager {
  private challenges = new Map<string, PKCEChallenge>();
  private readonly MIN_VERIFIER_LENGTH = 43;
  private readonly MAX_VERIFIER_LENGTH = 128;
  private readonly CHALLENGE_TTL = 10 * 60 * 1000; // 10 minutes

  /**
   * Generate a cryptographically secure code verifier
   * According to RFC 7636, must be 43-128 characters
   */
  generateVerifier(): string {
    // Generate 32 bytes (will produce 43 chars in base64url)
    const buffer = randomBytes(32);
    const verifier = buffer.toString('base64url');

    if (verifier.length < this.MIN_VERIFIER_LENGTH ||
        verifier.length > this.MAX_VERIFIER_LENGTH) {
      throw new Error('Generated verifier length is out of bounds');
    }

    logger.debug(`Generated PKCE verifier of length ${verifier.length}`);
    return verifier;
  }

  /**
   * Generate code challenge from verifier
   * S256 is mandatory in OAuth 2.1, plain is deprecated
   */
  generateChallenge(verifier: string, method: 'S256' | 'plain' = 'S256'): string {
    if (method === 'plain') {
      logger.warn('Using plain PKCE method is not recommended and will be deprecated');
      return verifier;
    }

    // S256 = BASE64URL(SHA256(verifier))
    const hash = createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');

    logger.debug(`Generated S256 PKCE challenge`);
    return hash;
  }

  /**
   * Store PKCE challenge for later verification
   */
  async storeChallenge(
    authorizationCode: string,
    challenge: string,
    method: 'S256' | 'plain',
    clientId: string
  ): Promise<void> {
    // Clean up expired challenges
    this.cleanupExpiredChallenges();

    const pkceChallenge: PKCEChallenge = {
      challenge,
      method,
      clientId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.CHALLENGE_TTL),
    };

    this.challenges.set(authorizationCode, pkceChallenge);
    logger.info(`Stored PKCE challenge for authorization code ${authorizationCode.substring(0, 8)}...`);
  }

  /**
   * Validate PKCE verifier against stored challenge
   * Uses constant-time comparison to prevent timing attacks
   */
  async validatePKCE(
    authorizationCode: string,
    verifier: string,
    clientId: string
  ): Promise<boolean> {
    const storedChallenge = this.challenges.get(authorizationCode);

    if (!storedChallenge) {
      logger.warn(`No PKCE challenge found for authorization code ${authorizationCode.substring(0, 8)}...`);
      return false;
    }

    // Check expiration
    if (new Date() > storedChallenge.expiresAt) {
      logger.warn(`PKCE challenge expired for authorization code ${authorizationCode.substring(0, 8)}...`);
      this.challenges.delete(authorizationCode);
      return false;
    }

    // Verify client ID matches
    if (storedChallenge.clientId !== clientId) {
      logger.error(`Client ID mismatch in PKCE validation. Expected: ${storedChallenge.clientId}, Got: ${clientId}`);
      return false;
    }

    // Compute challenge from provided verifier
    const computedChallenge = this.generateChallenge(verifier, storedChallenge.method);

    // Use constant-time comparison to prevent timing attacks
    const storedBuffer = Buffer.from(storedChallenge.challenge, 'ascii');
    const computedBuffer = Buffer.from(computedChallenge, 'ascii');

    if (storedBuffer.length !== computedBuffer.length) {
      logger.warn(`PKCE challenge length mismatch`);
      return false;
    }

    let isValid: boolean;
    try {
      // crypto.timingSafeEqual throws if buffers are different lengths
      isValid = storedBuffer.length === computedBuffer.length &&
                crypto.timingSafeEqual(storedBuffer, computedBuffer);
    } catch {
      isValid = false;
    }

    if (isValid) {
      logger.info(`PKCE validation successful for authorization code ${authorizationCode.substring(0, 8)}...`);
      // Remove used challenge
      this.challenges.delete(authorizationCode);
    } else {
      logger.warn(`PKCE validation failed for authorization code ${authorizationCode.substring(0, 8)}...`);
    }

    return isValid;
  }

  /**
   * Get stored challenge (for testing/debugging)
   */
  getChallenge(authorizationCode: string): PKCEChallenge | undefined {
    return this.challenges.get(authorizationCode);
  }

  /**
   * Clean up expired challenges to prevent memory leak
   */
  private cleanupExpiredChallenges(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [code, challenge] of this.challenges.entries()) {
      if (now > challenge.expiresAt) {
        this.challenges.delete(code);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired PKCE challenges`);
    }
  }

  /**
   * Clear all challenges (for testing)
   */
  clearAll(): void {
    this.challenges.clear();
    logger.debug('Cleared all PKCE challenges');
  }

  /**
   * Get statistics about stored challenges
   */
  getStats(): { total: number; expired: number } {
    const now = new Date();
    let expired = 0;

    for (const challenge of this.challenges.values()) {
      if (now > challenge.expiresAt) {
        expired++;
      }
    }

    return {
      total: this.challenges.size,
      expired,
    };
  }
}

// Export singleton instance
export const pkceManager = new PKCEManager();