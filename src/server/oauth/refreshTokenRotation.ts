import { randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';
import { getDb } from '../../db/client.js';
import { oauthTokens } from '../../db/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { tokenEncryption } from './tokenEncryption.js';
import jwt from 'jsonwebtoken';

/**
 * Token family for tracking refresh token lineage
 */
export interface TokenFamily {
  familyId: string;
  currentTokenHash: string;
  previousTokenHashes: string[];
  userId: string;
  clientId: string;
  createdAt: Date;
  lastRotated: Date;
  rotationCount: number;
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
  };
}

/**
 * Token rotation result
 */
export interface TokenRotationResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Security event types for monitoring
 */
export enum SecurityEvent {
  TOKEN_ROTATED = 'token_rotated',
  TOKEN_REUSE_DETECTED = 'token_reuse_detected',
  TOKEN_FAMILY_REVOKED = 'family_revoked',
  SUSPICIOUS_ROTATION = 'suspicious_rotation',
}

/**
 * Refresh Token Manager with rotation support
 * Implements automatic token rotation and reuse detection
 */
export class RefreshTokenManager {
  private tokenFamilies = new Map<string, TokenFamily>();
  private readonly ACCESS_TOKEN_TTL = parseInt(process.env.ACCESS_TOKEN_TTL || '900'); // 15 minutes
  private readonly REFRESH_TOKEN_TTL = parseInt(process.env.REFRESH_TOKEN_TTL || '2592000'); // 30 days
  private readonly MAX_ROTATION_COUNT = 100; // Prevent infinite rotation
  private readonly REUSE_DETECTION_WINDOW = 2000; // 2 seconds grace period

  /**
   * Generate a new token family for initial authentication
   */
  async createTokenFamily(
    userId: string,
    clientId: string,
    metadata?: TokenFamily['metadata']
  ): Promise<TokenRotationResult> {
    const familyId = randomBytes(16).toString('base64url');
    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = tokenEncryption.hashToken(refreshToken);

    const family: TokenFamily = {
      familyId,
      currentTokenHash: refreshTokenHash,
      previousTokenHashes: [],
      userId,
      clientId,
      createdAt: new Date(),
      lastRotated: new Date(),
      rotationCount: 0,
      metadata,
    };

    // Store family in memory and database
    this.tokenFamilies.set(familyId, family);
    await this.persistTokenFamily(family, refreshToken);

    // Generate access token
    const accessToken = await this.generateAccessToken(userId, clientId);

    logger.info(`Created new token family ${familyId} for user ${userId}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ACCESS_TOKEN_TTL,
      tokenType: 'Bearer',
    };
  }

  /**
   * Rotate refresh token
   * Detects and prevents token reuse attacks
   */
  async rotateRefreshToken(
    oldRefreshToken: string,
    metadata?: TokenFamily['metadata']
  ): Promise<TokenRotationResult> {
    const oldTokenHash = tokenEncryption.hashToken(oldRefreshToken);

    // Find token family
    const family = await this.findTokenFamily(oldTokenHash);

    if (!family) {
      logger.error('Refresh token not found - possible attack');
      throw new Error('Invalid refresh token');
    }

    // Check for token reuse (replay attack)
    if (await this.isTokenReused(family, oldTokenHash)) {
      logger.error(`Token reuse detected for family ${family.familyId}`);
      await this.handleTokenReuse(family);
      throw new Error('Token reuse detected - all tokens revoked');
    }

    // Check rotation count to prevent infinite rotation
    if (family.rotationCount >= this.MAX_ROTATION_COUNT) {
      logger.warn(`Max rotation count reached for family ${family.familyId}`);
      await this.revokeTokenFamily(family.familyId);
      throw new Error('Maximum token rotations exceeded');
    }

    // Check for suspicious rotation patterns
    if (this.detectSuspiciousRotation(family, metadata)) {
      logger.warn(`Suspicious rotation pattern detected for family ${family.familyId}`);
      await this.logSecurityEvent(SecurityEvent.SUSPICIOUS_ROTATION, family);
    }

    // Generate new tokens
    const newRefreshToken = this.generateRefreshToken();
    const newRefreshTokenHash = tokenEncryption.hashToken(newRefreshToken);
    const newAccessToken = await this.generateAccessToken(family.userId, family.clientId);

    // Update token family
    family.previousTokenHashes.push(family.currentTokenHash);
    family.currentTokenHash = newRefreshTokenHash;
    family.lastRotated = new Date();
    family.rotationCount++;

    // Limit history to prevent memory bloat (keep last 10)
    if (family.previousTokenHashes.length > 10) {
      family.previousTokenHashes = family.previousTokenHashes.slice(-10);
    }

    // Update metadata if provided
    if (metadata) {
      family.metadata = { ...family.metadata, ...metadata };
    }

    // Persist changes
    await this.updateTokenFamily(family, newRefreshToken, oldRefreshToken);

    logger.info(`Rotated refresh token for family ${family.familyId}, rotation #${family.rotationCount}`);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.ACCESS_TOKEN_TTL,
      tokenType: 'Bearer',
    };
  }

  /**
   * Check if token has been reused
   * Allows small grace period for legitimate retries
   */
  private async isTokenReused(family: TokenFamily, tokenHash: string): Promise<boolean> {
    // Current token is valid
    if (tokenHash === family.currentTokenHash) {
      return false;
    }

    // Check if it's a recently rotated token (within grace period)
    const timeSinceRotation = Date.now() - family.lastRotated.getTime();
    if (timeSinceRotation < this.REUSE_DETECTION_WINDOW) {
      const lastPrevious = family.previousTokenHashes[family.previousTokenHashes.length - 1];
      if (tokenHash === lastPrevious) {
        logger.debug('Token use within grace period, allowing');
        return false;
      }
    }

    // Check if it's an old token (definite reuse)
    return family.previousTokenHashes.includes(tokenHash);
  }

  /**
   * Handle token reuse detection
   * Revokes entire token family as a security measure
   */
  private async handleTokenReuse(family: TokenFamily): Promise<void> {
    await this.logSecurityEvent(SecurityEvent.TOKEN_REUSE_DETECTED, family);
    await this.revokeTokenFamily(family.familyId);
    await this.notifySecurityTeam(family);
  }

  /**
   * Revoke an entire token family
   * Used when token reuse or other attacks are detected
   */
  async revokeTokenFamily(familyId: string): Promise<void> {
    const family = this.tokenFamilies.get(familyId);

    if (!family) {
      return;
    }

    const db = getDb();

    // Mark all tokens in family as revoked
    await db.update(oauthTokens)
      .set({
        revokedAt: new Date(),
        revocationReason: 'family_revoked',
      })
      .where(eq(oauthTokens.tokenFamilyId, familyId));

    // Remove from memory
    this.tokenFamilies.delete(familyId);

    logger.info(`Revoked token family ${familyId} for user ${family.userId}`);
    await this.logSecurityEvent(SecurityEvent.TOKEN_FAMILY_REVOKED, family);
  }

  /**
   * Revoke all tokens for a user
   * Used in case of account compromise
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    const db = getDb();

    // Revoke all tokens
    await db.update(oauthTokens)
      .set({
        revokedAt: new Date(),
        revocationReason: 'user_revoked_all',
      })
      .where(eq(oauthTokens.userId, userId));

    // Remove from memory
    for (const [familyId, family] of this.tokenFamilies.entries()) {
      if (family.userId === userId) {
        this.tokenFamilies.delete(familyId);
      }
    }

    logger.info(`Revoked all tokens for user ${userId}`);
  }

  /**
   * Find token family by refresh token hash
   */
  private async findTokenFamily(tokenHash: string): Promise<TokenFamily | null> {
    // Check memory cache first
    for (const family of this.tokenFamilies.values()) {
      if (family.currentTokenHash === tokenHash ||
          family.previousTokenHashes.includes(tokenHash)) {
        return family;
      }
    }

    // Check database
    const db = getDb();
    const result = await db.select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.refreshTokenHash, tokenHash),
          eq(oauthTokens.revokedAt, null)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    // Reconstruct family from database
    const token = result[0];
    const family: TokenFamily = {
      familyId: token.tokenFamilyId,
      currentTokenHash: token.refreshTokenHash!,
      previousTokenHashes: [], // Would need separate table for full history
      userId: token.userId,
      clientId: token.clientId,
      createdAt: token.createdAt,
      lastRotated: token.createdAt,
      rotationCount: 0,
      metadata: {
        ipAddress: token.ipAddress || undefined,
        userAgent: token.userAgent || undefined,
      },
    };

    // Cache in memory
    this.tokenFamilies.set(family.familyId, family);

    return family;
  }

  /**
   * Detect suspicious rotation patterns
   */
  private detectSuspiciousRotation(
    family: TokenFamily,
    newMetadata?: TokenFamily['metadata']
  ): boolean {
    // Rapid rotation (more than once per minute)
    const timeSinceLastRotation = Date.now() - family.lastRotated.getTime();
    if (timeSinceLastRotation < 60000) {
      return true;
    }

    // Different IP address
    if (newMetadata?.ipAddress &&
        family.metadata?.ipAddress &&
        newMetadata.ipAddress !== family.metadata.ipAddress) {
      return true;
    }

    // Different device
    if (newMetadata?.deviceId &&
        family.metadata?.deviceId &&
        newMetadata.deviceId !== family.metadata.deviceId) {
      return true;
    }

    return false;
  }

  /**
   * Generate new refresh token
   */
  private generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate new access token (JWT)
   */
  private async generateAccessToken(userId: string, clientId: string): Promise<string> {
    const payload = {
      sub: userId,
      client_id: clientId,
      token_type: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.ACCESS_TOKEN_TTL,
    };

    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    return jwt.sign(payload, secret, { algorithm: 'HS256' });
  }

  /**
   * Persist token family to database
   */
  private async persistTokenFamily(
    family: TokenFamily,
    refreshToken: string
  ): Promise<void> {
    const db = getDb();
    const encryptedToken = await tokenEncryption.encryptToken(refreshToken);

    await db.insert(oauthTokens)
      .values({
        userId: family.userId,
        clientId: family.clientId,
        tokenFamilyId: family.familyId,
        refreshTokenHash: family.currentTokenHash,
        refreshTokenEncrypted: encryptedToken.encrypted,
        accessTokenHash: '', // Will be set separately
        accessTokenEncrypted: '', // Will be set separately
        scope: 'default',
        expiresAt: new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000),
        ipAddress: family.metadata?.ipAddress,
        userAgent: family.metadata?.userAgent,
      });
  }

  /**
   * Update token family in database
   */
  private async updateTokenFamily(
    family: TokenFamily,
    newRefreshToken: string,
    oldRefreshToken: string
  ): Promise<void> {
    const db = getDb();
    const encryptedToken = await tokenEncryption.encryptToken(newRefreshToken);
    const oldTokenHash = tokenEncryption.hashToken(oldRefreshToken);

    // Mark old token as rotated
    await db.update(oauthTokens)
      .set({
        revokedAt: new Date(),
        revocationReason: 'rotated',
      })
      .where(eq(oauthTokens.refreshTokenHash, oldTokenHash));

    // Insert new token
    await this.persistTokenFamily(family, newRefreshToken);
  }

  /**
   * Log security event
   */
  private async logSecurityEvent(
    event: SecurityEvent,
    family: TokenFamily
  ): Promise<void> {
    logger.warn(`Security event: ${event} for family ${family.familyId}, user ${family.userId}`);
    // TODO: Log to audit table
  }

  /**
   * Notify security team of critical events
   */
  private async notifySecurityTeam(family: TokenFamily): Promise<void> {
    // TODO: Send alert to security team
    logger.error(`SECURITY ALERT: Token reuse detected for user ${family.userId}`);
  }

  /**
   * Clean up expired token families
   */
  async cleanupExpiredFamilies(): Promise<void> {
    const db = getDb();
    const expiredDate = new Date(Date.now() - this.REFRESH_TOKEN_TTL * 1000);

    await db.update(oauthTokens)
      .set({
        revokedAt: new Date(),
        revocationReason: 'expired',
      })
      .where(
        and(
          eq(oauthTokens.revokedAt, null),
          eq(oauthTokens.expiresAt, expiredDate)
        )
      );

    logger.debug('Cleaned up expired token families');
  }
}

// Export singleton instance
export const refreshTokenManager = new RefreshTokenManager();