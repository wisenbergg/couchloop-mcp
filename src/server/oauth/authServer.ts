import { config } from "dotenv";
// Only load .env.local for local development — production & staging use platform env vars
if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
  config({ path: ".env.local" });
}

import bcrypt from "bcryptjs";
import nodeCrypto from "crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { getSupabaseClient, throwOnError } from "../../db/supabase-helpers.js";
import { logger } from "../../utils/logger.js";

interface TokenPayload {
  sub: string; // User ID
  client_id: string;
  scope: string;
  iat?: number;
  exp?: number;
}

export class OAuthServer {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === "production") {
      throw new Error(
        "JWT_SECRET environment variable is required in production",
      );
    }
    this.jwtSecret = secret || nodeCrypto.randomBytes(32).toString("hex");
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || "24h";

    if (!process.env.JWT_SECRET) {
      logger.warn(
        "JWT_SECRET not set - using random secret (tokens will not persist across restarts)",
      );
    }
  }

  /**
   * Validate client credentials
   */
  async validateClient(
    clientId: string,
    clientSecret?: string,
  ): Promise<{ clientId: string; redirectUris: string[] } | null> {
    const supabase = getSupabaseClient();

    try {
      const client = throwOnError(
        await supabase
          .from("oauth_clients")
          .select("*")
          .eq("client_id", clientId)
          .maybeSingle(),
      );

      if (!client) {
        logger.warn(`Invalid client ID: ${clientId}`);
        return null;
      }

      // If secret provided, verify it
      if (clientSecret) {
        const validSecret = await bcrypt.compare(
          clientSecret,
          client.client_secret,
        );
        if (!validSecret) {
          logger.warn(`Invalid client secret for client: ${clientId}`);
          return null;
        }
      }

      return {
        clientId: client.client_id,
        redirectUris: client.redirect_uris,
      };
    } catch (error) {
      logger.error("Error validating client:", error);
      return null;
    }
  }

  /**
   * Generate authorization code for OAuth flow
   */
  async generateAuthCode(
    clientId: string,
    userId: string,
    redirectUri: string,
    scope: string = "read write",
  ): Promise<string> {
    const supabase = getSupabaseClient();
    const code = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    try {
      throwOnError(
        await supabase.from("authorization_codes").insert({
          code,
          user_id: userId,
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          expires_at: expiresAt,
          used: false,
        }).select(),
      );

      logger.info(`Generated auth code for user ${userId}, client ${clientId}`);
      return code;
    } catch (error) {
      logger.error("Error generating auth code:", error);
      throw new Error("Failed to generate authorization code");
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }> {
    const supabase = getSupabaseClient();

    try {
      // Validate client
      const validClient = await this.validateClient(clientId, clientSecret);
      if (!validClient) {
        throw new Error("Invalid client credentials");
      }

      // Get and validate auth code
      const authCode = throwOnError(
        await supabase
          .from("authorization_codes")
          .select("*")
          .eq("code", code)
          .eq("client_id", clientId)
          .maybeSingle(),
      );

      if (!authCode) {
        throw new Error("Invalid authorization code");
      }

      // Check if code is expired (Supabase returns ISO strings)
      if (new Date() > new Date(authCode.expires_at)) {
        throw new Error("Authorization code expired");
      }

      // Check if code was already used
      if (authCode.used) {
        throw new Error("Authorization code already used");
      }

      // Validate redirect URI
      if (authCode.redirect_uri !== redirectUri) {
        throw new Error("Redirect URI mismatch");
      }

      // Mark code as used
      throwOnError(
        await supabase
          .from("authorization_codes")
          .update({ used: true })
          .eq("code", code),
      );

      // Generate tokens
      const accessToken = this.generateAccessToken(
        authCode.user_id,
        clientId,
        authCode.scope || "read write",
      );

      const refreshToken = this.generateRefreshToken(
        authCode.user_id,
        clientId,
        authCode.scope || "read write",
      );

      // Store tokens in database
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

      throwOnError(
        await supabase.from("oauth_tokens").insert({
          user_id: authCode.user_id,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          scope: authCode.scope,
          token_type: "Bearer",
        }).select(),
      );

      logger.info(
        `Issued tokens for user ${authCode.user_id}, client ${clientId}`,
      );

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: 86400, // 24 hours in seconds
        scope: authCode.scope || "read write",
      };
    } catch (error) {
      logger.error("Error exchanging code for token:", error);
      throw error;
    }
  }

  /**
   * Generate access token (JWT)
   */
  private generateAccessToken(
    userId: string,
    clientId: string,
    scope: string,
  ): string {
    const payload: TokenPayload = {
      sub: userId,
      client_id: clientId,
      scope,
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
    } as SignOptions);
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(
    userId: string,
    clientId: string,
    scope: string,
  ): string {
    const payload: TokenPayload = {
      sub: userId,
      client_id: clientId,
      scope,
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: "30d", // Refresh tokens last longer
    } as SignOptions);
  }

  /**
   * Validate access token
   */
  async validateAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      // Verify JWT signature
      const decoded = jwt.verify(token, this.jwtSecret) as TokenPayload;

      // Check if token exists in database and is not expired
      const supabase = getSupabaseClient();
      const dbToken = throwOnError(
        await supabase
          .from("oauth_tokens")
          .select("*")
          .eq("access_token", token)
          .maybeSingle(),
      );

      if (!dbToken || new Date() > new Date(dbToken.expires_at)) {
        return null;
      }

      return decoded;
    } catch (error) {
      logger.debug("Invalid access token:", error);
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
    const supabase = getSupabaseClient();

    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, this.jwtSecret) as TokenPayload;

      // Find existing token
      const existingToken = throwOnError(
        await supabase
          .from("oauth_tokens")
          .select("*")
          .eq("refresh_token", refreshToken)
          .maybeSingle(),
      );

      if (!existingToken) {
        throw new Error("Invalid refresh token");
      }

      // Generate new access token
      const newAccessToken = this.generateAccessToken(
        decoded.sub,
        decoded.client_id,
        decoded.scope,
      );

      // Update token in database
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      throwOnError(
        await supabase
          .from("oauth_tokens")
          .update({
            access_token: newAccessToken,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingToken.id),
      );

      logger.info(`Refreshed token for user ${decoded.sub}`);

      return {
        access_token: newAccessToken,
        token_type: "Bearer",
        expires_in: 86400,
      };
    } catch (error) {
      logger.error("Error refreshing token:", error);
      throw new Error("Failed to refresh token");
    }
  }

  /**
   * Revoke token
   */
  async revokeToken(token: string): Promise<void> {
    const supabase = getSupabaseClient();

    try {
      throwOnError(
        await supabase
          .from("oauth_tokens")
          .delete()
          .eq("access_token", token),
      );

      logger.info("Revoked token");
    } catch (error) {
      logger.error("Error revoking token:", error);
      throw new Error("Failed to revoke token");
    }
  }

  /**
   * Create or get user from external ID
   */
  async getOrCreateUser(externalId: string): Promise<string> {
    const supabase = getSupabaseClient();

    try {
      // Check if user exists
      const existingUser = throwOnError(
        await supabase
          .from("users")
          .select("*")
          .eq("external_id", externalId)
          .maybeSingle(),
      );

      if (existingUser) {
        return existingUser.id;
      }

      // Create new user
      const rows = throwOnError(
        await supabase
          .from("users")
          .insert({
            external_id: externalId,
          })
          .select(),
      );

      const newUser = rows?.[0];
      if (!newUser) {
        throw new Error("Failed to create user");
      }

      logger.info(`Created new user with external ID: ${externalId}`);
      return newUser.id;
    } catch (error) {
      logger.error("Error getting/creating user:", error);
      throw new Error("Failed to get or create user");
    }
  }
}

// Export singleton instance
export const oauthServer = new OAuthServer();
