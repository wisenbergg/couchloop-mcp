import { jwtVerify, importJWK, JWK } from 'jose';
import { logger } from '../../../utils/logger.js';
import { oauthSecurity } from '../security.js';

/**
 * OAuth token response structure
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/**
 * User information from OAuth provider
 */
export interface UserInfo {
  id: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  locale?: string;
  provider: string;
  raw?: Record<string, any>;
}

/**
 * ID Token claims (OpenID Connect)
 */
export interface IdTokenClaims {
  iss: string;  // Issuer
  sub: string;  // Subject (user ID)
  aud: string | string[];  // Audience
  exp: number;  // Expiration
  iat: number;  // Issued at
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  [key: string]: any;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  additionalParams?: Record<string, string>;
}

/**
 * Abstract base class for OAuth providers
 * Implements common OAuth 2.0/OIDC functionality
 */
export abstract class OAuthProvider {
  abstract readonly name: string;
  abstract readonly authorizationUrl: string;
  abstract readonly tokenUrl: string;
  abstract readonly userInfoUrl: string;
  abstract readonly revokeUrl?: string;
  abstract readonly jwksUrl?: string;

  protected config: ProviderConfig;
  private jwksCache: { keys: JWK[]; cachedAt: number } | null = null;
  private readonly JWKS_CACHE_TTL = 3600000; // 1 hour

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Build authorization URL with required parameters
   */
  buildAuthorizationUrl(params: {
    state: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    nonce?: string;
    scope?: string;
    additionalParams?: Record<string, string>;
  }): string {
    const url = new URL(this.authorizationUrl);

    // Required OAuth parameters
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', params.state);

    // Scope
    const scope = params.scope || this.getDefaultScopes().join(' ');
    url.searchParams.set('scope', scope);

    // PKCE parameters
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', params.codeChallengeMethod || 'S256');
    }

    // OpenID Connect nonce
    if (params.nonce) {
      url.searchParams.set('nonce', params.nonce);
    }

    // Provider-specific additional parameters
    if (this.config.additionalParams) {
      Object.entries(this.config.additionalParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    // Additional parameters from request
    if (params.additionalParams) {
      Object.entries(params.additionalParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    logger.debug(`Built authorization URL for ${this.name}: ${url.toString()}`);
    return url.toString();
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(
    code: string,
    codeVerifier?: string
  ): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
    });

    // Add PKCE verifier if provided
    if (codeVerifier) {
      params.set('code_verifier', codeVerifier);
    }

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`Token exchange failed for ${this.name}: ${error}`);
        throw new Error(`Token exchange failed: ${response.status}`);
      }

      const tokens: TokenResponse = await response.json();

      // Validate ID token if present (OIDC)
      if (tokens.id_token) {
        await this.validateIdToken(tokens.id_token);
      }

      logger.info(`Successfully exchanged code for tokens with ${this.name}`);
      return tokens;
    } catch (error) {
      logger.error(`Error exchanging code with ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`Token refresh failed for ${this.name}: ${error}`);
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const tokens: TokenResponse = await response.json();

      logger.info(`Successfully refreshed token with ${this.name}`);
      return tokens;
    } catch (error) {
      logger.error(`Error refreshing token with ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Get user information from provider
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    try {
      const response = await fetch(this.userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`Failed to get user info from ${this.name}: ${error}`);
        throw new Error(`Failed to get user info: ${response.status}`);
      }

      const data = await response.json();
      const userInfo = this.normalizeUserInfo(data);

      logger.info(`Retrieved user info from ${this.name} for user ${userInfo.id}`);
      return userInfo;
    } catch (error) {
      logger.error(`Error getting user info from ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Revoke token (if supported by provider)
   */
  async revokeToken(token: string, tokenType: 'access_token' | 'refresh_token' = 'access_token'): Promise<void> {
    if (!this.revokeUrl) {
      logger.warn(`Token revocation not supported by ${this.name}`);
      return;
    }

    const params = new URLSearchParams({
      token,
      token_type_hint: tokenType,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await fetch(this.revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        logger.warn(`Token revocation failed for ${this.name}: ${response.status}`);
      } else {
        logger.info(`Successfully revoked token with ${this.name}`);
      }
    } catch (error) {
      logger.error(`Error revoking token with ${this.name}:`, error);
    }
  }

  /**
   * Validate ID token (OpenID Connect)
   */
  protected async validateIdToken(idToken: string): Promise<IdTokenClaims> {
    if (!this.jwksUrl) {
      throw new Error(`JWKS URL not configured for ${this.name}`);
    }

    try {
      // Get JWKS (with caching)
      const jwks = await this.getJWKS();

      // Parse token header to get kid
      const [header] = idToken.split('.');
      const decodedHeader = JSON.parse(Buffer.from(header, 'base64').toString());
      const kid = decodedHeader.kid;

      // Find matching key
      const key = jwks.keys.find(k => k.kid === kid);
      if (!key) {
        throw new Error('No matching key found in JWKS');
      }

      // Import and verify
      const publicKey = await importJWK(key);
      const { payload } = await jwtVerify(idToken, publicKey, {
        issuer: this.getExpectedIssuer(),
        audience: this.config.clientId,
      });

      const claims = payload as unknown as IdTokenClaims;

      // Additional validations
      this.validateIdTokenClaims(claims);

      logger.debug(`ID token validated successfully for ${this.name}`);
      return claims;
    } catch (error) {
      logger.error(`ID token validation failed for ${this.name}:`, error);
      throw new Error('Invalid ID token');
    }
  }

  /**
   * Get JWKS from provider (with caching)
   */
  protected async getJWKS(): Promise<{ keys: JWK[] }> {
    if (!this.jwksUrl) {
      throw new Error(`JWKS URL not configured for ${this.name}`);
    }

    // Check cache
    if (this.jwksCache &&
        Date.now() - this.jwksCache.cachedAt < this.JWKS_CACHE_TTL) {
      return { keys: this.jwksCache.keys };
    }

    try {
      const response = await fetch(this.jwksUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch JWKS: ${response.status}`);
      }

      const jwks = await response.json();

      // Cache the keys
      this.jwksCache = {
        keys: jwks.keys,
        cachedAt: Date.now(),
      };

      logger.debug(`Fetched and cached JWKS for ${this.name}`);
      return jwks;
    } catch (error) {
      logger.error(`Error fetching JWKS for ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Validate redirect URI
   */
  protected validateRedirectUri(uri: string): boolean {
    return oauthSecurity.validateRedirectUri(uri, this.config.clientId);
  }

  /**
   * Get default scopes for this provider
   */
  protected abstract getDefaultScopes(): string[];

  /**
   * Get expected issuer for ID token validation
   */
  protected abstract getExpectedIssuer(): string;

  /**
   * Normalize user info to common format
   */
  protected abstract normalizeUserInfo(data: any): UserInfo;

  /**
   * Additional ID token claims validation
   */
  protected validateIdTokenClaims(claims: IdTokenClaims): void {
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      throw new Error('ID token expired');
    }

    // Check issued at (not in the future)
    if (claims.iat > now + 60) { // Allow 1 minute clock skew
      throw new Error('ID token issued in the future');
    }

    // Provider-specific additional validations can be added in subclasses
  }

  /**
   * Handle provider-specific errors
   */
  protected handleProviderError(error: any): never {
    // Can be overridden in subclasses for provider-specific error handling
    throw error;
  }
}

/**
 * Provider factory
 */
export class ProviderFactory {
  private static providers = new Map<string, typeof OAuthProvider>();

  /**
   * Register a provider
   */
  static register(name: string, providerClass: typeof OAuthProvider): void {
    this.providers.set(name.toLowerCase(), providerClass);
    logger.info(`Registered OAuth provider: ${name}`);
  }

  /**
   * Create provider instance
   */
  static create(name: string, config: ProviderConfig): OAuthProvider {
    const ProviderClass = this.providers.get(name.toLowerCase());

    if (!ProviderClass) {
      throw new Error(`Unknown OAuth provider: ${name}`);
    }

    // @ts-ignore - TypeScript doesn't understand dynamic class instantiation
    return new ProviderClass(config);
  }

  /**
   * Get list of registered providers
   */
  static getProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}