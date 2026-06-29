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
import { isReservedClientId } from "./ssoIdentity.js";

interface TokenPayload {
  sub: string; // User ID
  client_id: string;
  scope: string;
  iat?: number;
  exp?: number;
}

interface SubjectLink {
  user_id: string;
}

type CodeChallengeMethod = "plain" | "S256";
type TokenEndpointAuthMethod = "none" | "client_secret_post";

interface DynamicClientRegistrationInput {
  clientName?: string;
  redirectUris: string[];
  grantTypes?: string[];
  scopes?: string[];
  tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
}

interface DynamicClientRegistrationResult {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  scope: string;
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
  ): Promise<{ clientId: string; redirectUris: string[]; scopes: string[]; grantTypes: string[] } | null> {
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
        scopes: Array.isArray(client.scopes) ? client.scopes : [],
        grantTypes: Array.isArray(client.grant_types) ? client.grant_types : [],
      };
    } catch (error) {
      logger.error("Error validating client:", error);
      return null;
    }
  }

  /**
   * Registers a dynamic OAuth client for MCP hosts that do not support
   * pre-provisioned client IDs.
   */
  async registerDynamicClient(
    input: DynamicClientRegistrationInput,
  ): Promise<DynamicClientRegistrationResult> {
    const supabase = getSupabaseClient();

    const tokenEndpointAuthMethod: TokenEndpointAuthMethod =
      input.tokenEndpointAuthMethod === "client_secret_post"
        ? "client_secret_post"
        : "none";

    const grantTypes =
      input.grantTypes && input.grantTypes.length > 0
        ? Array.from(new Set(input.grantTypes))
        : ["authorization_code", "refresh_token"];

    const scopes =
      input.scopes && input.scopes.length > 0
        ? Array.from(new Set(input.scopes))
        : ["read", "write"];

    const clientName =
      input.clientName && input.clientName.trim().length > 0
        ? input.clientName.trim()
        : "Dynamic MCP Client";

    const clientId = `mcp_${nodeCrypto.randomUUID()}`;
    // Minted ids are always mcp_*, but assert defensively that they never collide
    // with the reserved SSO sentinel client_id.
    if (isReservedClientId(clientId)) {
      throw new Error("Refusing to register reserved client_id");
    }
    const rawClientSecret = nodeCrypto.randomBytes(32).toString("base64url");
    const hashedClientSecret = await bcrypt.hash(rawClientSecret, 12);

    throwOnError(
      await supabase.from("oauth_clients").insert({
        client_id: clientId,
        client_secret: hashedClientSecret,
        name: clientName,
        redirect_uris: input.redirectUris,
        grant_types: grantTypes,
        scopes,
      }).select(),
    );

    const clientIdIssuedAt = Math.floor(Date.now() / 1000);

    return {
      client_id: clientId,
      client_id_issued_at: clientIdIssuedAt,
      client_secret:
        tokenEndpointAuthMethod === "client_secret_post"
          ? rawClientSecret
          : undefined,
      client_secret_expires_at:
        tokenEndpointAuthMethod === "client_secret_post" ? 0 : undefined,
      client_name: clientName,
      redirect_uris: input.redirectUris,
      grant_types: grantTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      scope: scopes.join(" "),
    };
  }

  /**
   * Generate authorization code for OAuth flow
   */
  async generateAuthCode(
    clientId: string,
    userId: string,
    redirectUri: string,
    scope: string = "read write",
    codeChallenge?: string,
    codeChallengeMethod?: CodeChallengeMethod,
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
          code_challenge: codeChallenge || null,
          code_challenge_method: codeChallengeMethod || null,
          expires_at: expiresAt,
          used: false,
        }).select(),
      );

      logger.info(`Generated auth code for user ${userId}, client ${clientId}`);
      return code;
    } catch (error) {
      // Backward compatibility for databases that do not yet have PKCE columns.
      const message = error instanceof Error ? error.message : "";
      if (message.includes("code_challenge") || message.includes("code_challenge_method")) {
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

        logger.warn(
          "Generated auth code without PKCE columns; apply migration 0006_add_pkce_to_authorization_codes.sql",
        );
        return code;
      }

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
    clientSecret: string | undefined,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }> {
    const supabase = getSupabaseClient();

    try {
      const usingClientSecret = typeof clientSecret === "string" && clientSecret.length > 0;

      // Validate client
      const validClient = usingClientSecret
        ? await this.validateClient(clientId, clientSecret)
        : await this.validateClient(clientId);
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

      const storedCodeChallenge =
        typeof authCode.code_challenge === "string" && authCode.code_challenge.length > 0
          ? authCode.code_challenge
          : null;
      const storedChallengeMethod =
        authCode.code_challenge_method === "S256" || authCode.code_challenge_method === "plain"
          ? authCode.code_challenge_method
          : "plain";

      // Public-client path, require PKCE when no client secret is supplied.
      if (!usingClientSecret) {
        if (!storedCodeChallenge) {
          throw new Error("PKCE is required when client_secret is not provided");
        }
        if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
          throw new Error("Invalid or missing code_verifier");
        }

        const expectedChallenge =
          storedChallengeMethod === "S256"
            ? nodeCrypto.createHash("sha256").update(codeVerifier).digest("base64url")
            : codeVerifier;

        if (expectedChallenge !== storedCodeChallenge) {
          throw new Error("Invalid code_verifier");
        }
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
      const user = throwOnError(
        await supabase
          .from("users")
          .upsert(
            {
              external_id: externalId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "external_id" },
          )
          .select("id")
          .single(),
      ) as { id: string } | null;

      if (!user) {
        throw new Error("Failed to resolve user");
      }

      logger.info(`Resolved user for external ID: ${externalId}`);
      return user.id;
    } catch (error) {
      logger.error("Error getting/creating user:", error);
      throw new Error("Failed to get or create user");
    }
  }

  /**
   * Resolve stable internal user UUID for a client+issuer+subject tuple.
   * Falls back to external_id strategy if mapping table is not yet available.
   */
  async resolveOrCreateUserForSubject(
    clientId: string,
    issuer: string,
    subject: string,
  ): Promise<string> {
    const supabase = getSupabaseClient();
    const subjectHash = nodeCrypto
      .createHash("sha256")
      .update(`${issuer}:${clientId}:${subject}`)
      .digest("hex");

    try {
      const existingLink = throwOnError(
        await supabase
          .from("oauth_subject_links")
          .select("user_id")
          .eq("client_id", clientId)
          .eq("issuer", issuer)
          .eq("subject_hash", subjectHash)
          .maybeSingle(),
      ) as SubjectLink | null;

      if (existingLink?.user_id) {
        return existingLink.user_id;
      }

      const externalId = `stable_${clientId}_${subjectHash.substring(0, 24)}`;
      const userId = await this.getOrCreateUser(externalId);

      throwOnError(
        await supabase
          .from("oauth_subject_links")
          .upsert(
            {
              client_id: clientId,
              issuer,
              subject_hash: subjectHash,
              user_id: userId,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "client_id,issuer,subject_hash",
              ignoreDuplicates: true,
            },
          )
          .select("user_id"),
      );

      const resolvedLink = throwOnError(
        await supabase
          .from("oauth_subject_links")
          .select("user_id")
          .eq("client_id", clientId)
          .eq("issuer", issuer)
          .eq("subject_hash", subjectHash)
          .single(),
      ) as SubjectLink;

      return resolvedLink.user_id;
    } catch (error) {
      logger.warn(
        "Stable subject mapping unavailable, falling back to external_id path",
        error,
      );

      // Graceful fallback during phased rollout if table is not yet applied.
      const externalId = `stable_${clientId}_${subjectHash.substring(0, 24)}`;
      return this.getOrCreateUser(externalId);
    }
  }
}

// Export singleton instance
export const oauthServer = new OAuthServer();
