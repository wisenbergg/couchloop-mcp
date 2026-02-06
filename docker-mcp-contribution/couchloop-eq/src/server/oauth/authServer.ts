import { config } from 'dotenv';
// Load environment variables before class initialization
config({ path: '.env.local' });

import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDb } from '../../db/client.js';
import { users, oauthClients, oauthTokens, authorizationCodes } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../../utils/logger.js';

interface TokenPayload {
  sub: string;  // User ID
  client_id: string;
  scope: string;
  iat?: number;
  exp?: number;
}

export class OAuthServer {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';

    if (!process.env.JWT_SECRET) {
      logger.warn('Using default JWT secret - CHANGE IN PRODUCTION!');
    }
  }

  /**
   * Validate client credentials
   */
  async validateClient(clientId: string, clientSecret?: string): Promise<boolean> {
    const db = getDb();

    try {
      const [client] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1);

      if (!client) {
        logger.warn(`Invalid client ID: ${clientId}`);
        return false;
      }

      // If secret provided, verify it
      if (clientSecret) {
        const validSecret = await bcrypt.compare(clientSecret, client.clientSecret);
        if (!validSecret) {
          logger.warn(`Invalid client secret for client: ${clientId}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error validating client:', error);
      return false;
    }
  }

  /**
   * Generate authorization code for OAuth flow
   */
  async generateAuthCode(
    clientId: string,
    userId: string,
    redirectUri: string,
    scope: string = 'read write'
  ): Promise<string> {
    const db = getDb();
    const code = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    try {
      await db.insert(authorizationCodes).values({
        code,
        userId,
        clientId,
        redirectUri,
        scope,
        expiresAt,
        used: false,
      });

      logger.info(`Generated auth code for user ${userId}, client ${clientId}`);
      return code;
    } catch (error) {
      logger.error('Error generating auth code:', error);
      throw new Error('Failed to generate authorization code');
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }> {
    const db = getDb();

    try {
      // Validate client
      const validClient = await this.validateClient(clientId, clientSecret);
      if (!validClient) {
        throw new Error('Invalid client credentials');
      }

      // Get and validate auth code
      const [authCode] = await db
        .select()
        .from(authorizationCodes)
        .where(
          and(
            eq(authorizationCodes.code, code),
            eq(authorizationCodes.clientId, clientId)
          )
        )
        .limit(1);

      if (!authCode) {
        throw new Error('Invalid authorization code');
      }

      // Check if code is expired
      if (new Date() > authCode.expiresAt) {
        throw new Error('Authorization code expired');
      }

      // Check if code was already used
      if (authCode.used) {
        throw new Error('Authorization code already used');
      }

      // Validate redirect URI
      if (authCode.redirectUri !== redirectUri) {
        throw new Error('Redirect URI mismatch');
      }

      // Mark code as used
      await db
        .update(authorizationCodes)
        .set({ used: true })
        .where(eq(authorizationCodes.code, code));

      // Generate tokens
      const accessToken = this.generateAccessToken(
        authCode.userId,
        clientId,
        authCode.scope || 'read write'
      );

      const refreshToken = this.generateRefreshToken(
        authCode.userId,
        clientId,
        authCode.scope || 'read write'
      );

      // Store tokens in database
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await db.insert(oauthTokens).values({
        userId: authCode.userId,
        accessToken,
        refreshToken,
        expiresAt,
        scope: authCode.scope,
        tokenType: 'Bearer',
      });

      logger.info(`Issued tokens for user ${authCode.userId}, client ${clientId}`);

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 86400, // 24 hours in seconds
        scope: authCode.scope || 'read write',
      };
    } catch (error) {
      logger.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  /**
   * Generate access token (JWT)
   */
  private generateAccessToken(userId: string, clientId: string, scope: string): string {
    const payload: TokenPayload = {
      sub: userId,
      client_id: clientId,
      scope,
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn as any,
    });
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(userId: string, clientId: string, scope: string): string {
    const payload: TokenPayload = {
      sub: userId,
      client_id: clientId,
      scope,
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: '30d' as any, // Refresh tokens last longer
    });
  }

  /**
   * Validate access token
   */
  async validateAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      // Verify JWT signature
      const decoded = jwt.verify(token, this.jwtSecret) as TokenPayload;

      // Check if token exists in database and is not expired
      const db = getDb();
      const [dbToken] = await db
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.accessToken, token))
        .limit(1);

      if (!dbToken || new Date() > dbToken.expiresAt) {
        return null;
      }

      return decoded;
    } catch (error) {
      logger.debug('Invalid access token:', error);
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    const db = getDb();

    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, this.jwtSecret) as TokenPayload;

      // Find existing token
      const [existingToken] = await db
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.refreshToken, refreshToken))
        .limit(1);

      if (!existingToken) {
        throw new Error('Invalid refresh token');
      }

      // Generate new access token
      const newAccessToken = this.generateAccessToken(
        decoded.sub,
        decoded.client_id,
        decoded.scope
      );

      // Update token in database
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db
        .update(oauthTokens)
        .set({
          accessToken: newAccessToken,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(oauthTokens.id, existingToken.id));

      logger.info(`Refreshed token for user ${decoded.sub}`);

      return {
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: 86400,
      };
    } catch (error) {
      logger.error('Error refreshing token:', error);
      throw new Error('Failed to refresh token');
    }
  }

  /**
   * Revoke token
   */
  async revokeToken(token: string): Promise<void> {
    const db = getDb();

    try {
      await db
        .delete(oauthTokens)
        .where(eq(oauthTokens.accessToken, token));

      logger.info('Revoked token');
    } catch (error) {
      logger.error('Error revoking token:', error);
      throw new Error('Failed to revoke token');
    }
  }

  /**
   * Create or get user from external ID
   */
  async getOrCreateUser(externalId: string): Promise<string> {
    const db = getDb();

    try {
      // Check if user exists
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.externalId, externalId))
        .limit(1);

      if (existingUser) {
        return existingUser.id;
      }

      // Create new user
      const [newUser] = await db
        .insert(users)
        .values({
          externalId,
        })
        .returning();

      if (!newUser) {
        throw new Error('Failed to create user');
      }

      logger.info(`Created new user with external ID: ${externalId}`);
      return newUser.id;
    } catch (error) {
      logger.error('Error getting/creating user:', error);
      throw new Error('Failed to get or create user');
    }
  }
}

// Export singleton instance
export const oauthServer = new OAuthServer();