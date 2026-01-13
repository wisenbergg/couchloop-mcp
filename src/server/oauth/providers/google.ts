import { OAuthProvider, UserInfo, IdTokenClaims, ProviderConfig } from './base.js';
import { logger } from '../../../utils/logger.js';

/**
 * Google OAuth 2.0 Provider
 * Implements Google Sign-In with OpenID Connect
 */
export class GoogleOAuthProvider extends OAuthProvider {
  readonly name = 'google';
  readonly authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  readonly tokenUrl = 'https://oauth2.googleapis.com/token';
  readonly userInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';
  readonly revokeUrl = 'https://oauth2.googleapis.com/revoke';
  readonly jwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';

  constructor(config: ProviderConfig) {
    super(config);

    // Set Google-specific defaults
    if (!this.config.scopes || this.config.scopes.length === 0) {
      this.config.scopes = this.getDefaultScopes();
    }

    // Google-specific additional parameters
    if (!this.config.additionalParams) {
      this.config.additionalParams = {};
    }

    // Request refresh token
    this.config.additionalParams.access_type = 'offline';

    // Force approval prompt for refresh token on first auth
    if (process.env.GOOGLE_FORCE_APPROVAL === 'true') {
      this.config.additionalParams.prompt = 'consent';
    }
  }

  /**
   * Get default scopes for Google
   */
  protected getDefaultScopes(): string[] {
    return [
      'openid',
      'email',
      'profile',
      // Add additional scopes as needed
      // 'https://www.googleapis.com/auth/calendar.readonly',
      // 'https://www.googleapis.com/auth/drive.file',
    ];
  }

  /**
   * Get expected issuer for Google
   */
  protected getExpectedIssuer(): string {
    return 'https://accounts.google.com';
  }

  /**
   * Normalize Google user info to common format
   */
  protected normalizeUserInfo(data: any): UserInfo {
    return {
      id: data.id || data.sub,
      email: data.email,
      email_verified: data.email_verified || data.verified_email,
      name: data.name,
      picture: data.picture,
      locale: data.locale,
      provider: this.name,
      raw: data,
    };
  }

  /**
   * Additional Google-specific ID token validation
   */
  protected validateIdTokenClaims(claims: IdTokenClaims): void {
    super.validateIdTokenClaims(claims);

    // Google-specific: Check HD claim for G Suite domains
    const allowedDomain = process.env.GOOGLE_ALLOWED_DOMAIN;
    if (allowedDomain && claims.hd !== allowedDomain) {
      throw new Error(`User not from allowed domain: ${allowedDomain}`);
    }

    // Verify email is verified for Google accounts
    if (claims.email && !claims.email_verified) {
      throw new Error('Email not verified');
    }
  }

  /**
   * Google-specific user info enrichment
   * Can fetch additional profile data if needed
   */
  async getEnrichedUserInfo(accessToken: string): Promise<UserInfo> {
    const baseInfo = await this.getUserInfo(accessToken);

    // Could fetch additional Google APIs data here
    // For example: Google+ profile, Calendar info, etc.

    return baseInfo;
  }

  /**
   * Check if user has specific Google service access
   */
  async checkServiceAccess(
    accessToken: string,
    service: 'calendar' | 'drive' | 'gmail'
  ): Promise<boolean> {
    const serviceUrls = {
      calendar: 'https://www.googleapis.com/calendar/v3/users/me/settings',
      drive: 'https://www.googleapis.com/drive/v3/about',
      gmail: 'https://www.googleapis.com/gmail/v1/users/me/profile',
    };

    try {
      const response = await fetch(serviceUrls[service], {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Revoke Google tokens
   * Google supports revoking both access and refresh tokens
   */
  async revokeToken(token: string, tokenType?: 'access_token' | 'refresh_token'): Promise<void> {
    // Google revokes all tokens associated with the grant
    const params = new URLSearchParams({ token });

    try {
      const response = await fetch(this.revokeUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (response.ok) {
        logger.info('Successfully revoked Google tokens');
      } else {
        const error = await response.text();
        logger.error(`Failed to revoke Google token: ${error}`);
      }
    } catch (error) {
      logger.error('Error revoking Google token:', error);
      throw error;
    }
  }

  /**
   * Handle Google-specific errors
   */
  protected handleProviderError(error: any): never {
    // Handle Google-specific error codes
    if (error.error === 'invalid_grant') {
      throw new Error('Authorization code has been used or is invalid');
    }

    if (error.error === 'access_denied') {
      throw new Error('User denied access to Google account');
    }

    throw error;
  }
}