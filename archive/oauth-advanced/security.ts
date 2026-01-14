import { randomBytes, createHash } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { logger } from '../../utils/logger.js';

/**
 * State data for CSRF protection
 */
export interface StateData {
  clientId: string;
  redirectUri: string;
  nonce: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
  createdAt: Date;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
  fingerprint?: string; // Browser fingerprint for additional validation
}

/**
 * OAuth Security Manager
 * Handles CSRF protection, state management, and nonce generation
 */
export class OAuthSecurity {
  private stateStore = new Map<string, StateData>();
  private usedNonces = new Set<string>();
  private readonly STATE_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly NONCE_TTL = 60 * 60 * 1000; // 1 hour

  /**
   * Generate a secure state token with embedded data
   * Uses JWT for tamper-proof state management
   */
  async generateStateToken(data: Omit<StateData, 'createdAt' | 'expiresAt'>): Promise<string> {
    const stateId = randomBytes(16).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.STATE_TTL);

    const stateData: StateData = {
      ...data,
      createdAt: now,
      expiresAt,
    };

    // Store in memory for quick validation
    this.stateStore.set(stateId, stateData);

    // Create JWT with state data
    const secret = new TextEncoder().encode(process.env.STATE_SECRET || 'dev-state-secret-change-in-production');

    const jwt = await new SignJWT({
      sid: stateId,
      cid: data.clientId,
      ruri: data.redirectUri,
      nonce: data.nonce,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(secret);

    logger.debug(`Generated state token for client ${data.clientId}`);
    return jwt;
  }

  /**
   * Validate state token and extract data
   * Prevents CSRF attacks by ensuring state matches
   */
  async validateState(token: string): Promise<StateData | null> {
    try {
      const secret = new TextEncoder().encode(process.env.STATE_SECRET || 'dev-state-secret-change-in-production');

      // Verify JWT signature and expiration
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
      });

      const stateId = payload.sid as string;
      const stateData = this.stateStore.get(stateId);

      if (!stateData) {
        logger.warn(`State data not found for ID ${stateId}`);
        return null;
      }

      // Check expiration
      if (new Date() > stateData.expiresAt) {
        logger.warn(`State token expired for ID ${stateId}`);
        this.stateStore.delete(stateId);
        return null;
      }

      // Validate data consistency
      if (stateData.clientId !== payload.cid ||
          stateData.redirectUri !== payload.ruri ||
          stateData.nonce !== payload.nonce) {
        logger.error('State data mismatch - possible tampering detected');
        return null;
      }

      // Remove used state to prevent replay
      this.stateStore.delete(stateId);

      logger.info(`State validation successful for client ${stateData.clientId}`);
      return stateData;
    } catch (error) {
      logger.error('State validation failed:', error);
      return null;
    }
  }

  /**
   * Generate cryptographically secure nonce
   * Used for OpenID Connect flows
   */
  generateNonce(): string {
    const nonce = randomBytes(16).toString('base64url');
    const nonceHash = createHash('sha256').update(nonce).digest('hex');

    // Store nonce hash to prevent replay
    this.usedNonces.add(nonceHash);

    // Clean old nonces periodically
    this.cleanupOldNonces();

    logger.debug('Generated new nonce');
    return nonce;
  }

  /**
   * Validate nonce hasn't been used before
   */
  validateNonce(nonce: string): boolean {
    const nonceHash = createHash('sha256').update(nonce).digest('hex');

    if (this.usedNonces.has(nonceHash)) {
      logger.warn('Nonce replay detected');
      return false;
    }

    this.usedNonces.add(nonceHash);
    return true;
  }

  /**
   * Generate browser fingerprint for additional security
   * Combines multiple browser characteristics
   */
  generateFingerprint(req: any): string {
    const components = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
      req.ip || req.connection.remoteAddress || '',
    ];

    const fingerprint = createHash('sha256')
      .update(components.join('|'))
      .digest('base64url');

    logger.debug('Generated browser fingerprint');
    return fingerprint;
  }

  /**
   * Validate request fingerprint matches stored one
   */
  validateFingerprint(stored: string | undefined, current: string): boolean {
    if (!stored) {
      return true; // No fingerprint stored, skip validation
    }

    const isValid = stored === current;

    if (!isValid) {
      logger.warn('Browser fingerprint mismatch - possible session hijacking');
    }

    return isValid;
  }

  /**
   * Clean up expired states to prevent memory leak
   */
  private cleanupExpiredStates(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [id, state] of this.stateStore.entries()) {
      if (now > state.expiresAt) {
        this.stateStore.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired states`);
    }
  }

  /**
   * Clean up old nonces to prevent memory leak
   */
  private cleanupOldNonces(): void {
    // Keep only last 1000 nonces
    if (this.usedNonces.size > 1000) {
      const toKeep = Array.from(this.usedNonces).slice(-500);
      this.usedNonces.clear();
      toKeep.forEach(nonce => this.usedNonces.add(nonce));
      logger.debug('Cleaned up old nonces');
    }
  }

  /**
   * Validate redirect URI against whitelist
   * Prevents open redirect vulnerabilities
   */
  validateRedirectUri(uri: string, clientId: string): boolean {
    const allowedUris = this.getAllowedRedirectUris(clientId);

    // Exact match required (OAuth 2.1 requirement)
    const isValid = allowedUris.includes(uri);

    if (!isValid) {
      logger.error(`Invalid redirect URI: ${uri} for client ${clientId}`);
    }

    return isValid;
  }

  /**
   * Get allowed redirect URIs for a client
   * In production, this should query from database
   */
  private getAllowedRedirectUris(clientId: string): string[] {
    // TODO: Fetch from database based on clientId
    const uris = process.env[`${clientId.toUpperCase()}_REDIRECT_URIS`];
    return uris ? uris.split(',') : [];
  }

  /**
   * Validate authorization request parameters
   * Comprehensive validation for security
   */
  validateAuthorizationRequest(params: {
    response_type: string;
    client_id: string;
    redirect_uri: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }): { valid: boolean; error?: string } {
    // Response type must be 'code' (OAuth 2.1 - no implicit flow)
    if (params.response_type !== 'code') {
      return {
        valid: false,
        error: 'Invalid response_type. Only "code" is supported'
      };
    }

    // Client ID required
    if (!params.client_id) {
      return {
        valid: false,
        error: 'Missing client_id'
      };
    }

    // Redirect URI required and must be valid
    if (!params.redirect_uri) {
      return {
        valid: false,
        error: 'Missing redirect_uri'
      };
    }

    if (!this.validateRedirectUri(params.redirect_uri, params.client_id)) {
      return {
        valid: false,
        error: 'Invalid redirect_uri'
      };
    }

    // State parameter required (CSRF protection)
    if (!params.state) {
      return {
        valid: false,
        error: 'Missing state parameter'
      };
    }

    // PKCE required for all clients (OAuth 2.1)
    if (!params.code_challenge) {
      return {
        valid: false,
        error: 'Missing code_challenge (PKCE required)'
      };
    }

    // S256 method required (plain is deprecated)
    if (params.code_challenge_method && params.code_challenge_method !== 'S256') {
      return {
        valid: false,
        error: 'Invalid code_challenge_method. Only S256 is supported'
      };
    }

    logger.info(`Authorization request validated for client ${params.client_id}`);
    return { valid: true };
  }

  /**
   * Get statistics about stored states
   */
  getStats(): { states: number; nonces: number } {
    this.cleanupExpiredStates();

    return {
      states: this.stateStore.size,
      nonces: this.usedNonces.size,
    };
  }

  /**
   * Clear all states and nonces (for testing)
   */
  clearAll(): void {
    this.stateStore.clear();
    this.usedNonces.clear();
    logger.debug('Cleared all states and nonces');
  }
}

// Export singleton instance
export const oauthSecurity = new OAuthSecurity();