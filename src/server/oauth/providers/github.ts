import { OAuthProvider, UserInfo, TokenResponse, ProviderConfig } from './base.js';
import { logger } from '../../../utils/logger.js';

/**
 * GitHub OAuth Provider
 * Note: GitHub doesn't support OpenID Connect, so no ID tokens
 */
export class GitHubOAuthProvider extends OAuthProvider {
  readonly name = 'github';
  readonly authorizationUrl = 'https://github.com/login/oauth/authorize';
  readonly tokenUrl = 'https://github.com/login/oauth/access_token';
  readonly userInfoUrl = 'https://api.github.com/user';
  readonly revokeUrl = undefined; // GitHub doesn't support token revocation via API
  readonly jwksUrl = undefined; // GitHub doesn't use OIDC

  constructor(config: ProviderConfig) {
    super(config);

    if (!this.config.scopes || this.config.scopes.length === 0) {
      this.config.scopes = this.getDefaultScopes();
    }
  }

  /**
   * Get default scopes for GitHub
   */
  protected getDefaultScopes(): string[] {
    return [
      'read:user',    // Read user profile
      'user:email',   // Access email addresses
      // Additional scopes as needed:
      // 'repo',      // Full repository access
      // 'read:org',  // Read organization membership
    ];
  }

  /**
   * GitHub doesn't use OIDC, so no issuer
   */
  protected getExpectedIssuer(): string {
    return '';
  }

  /**
   * Exchange code for token (GitHub-specific)
   */
  async exchangeCode(code: string, codeVerifier?: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
    });

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json', // GitHub requires this for JSON response
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`GitHub token exchange failed: ${error}`);
        throw new Error(`Token exchange failed: ${response.status}`);
      }

      const data = await response.json();

      // GitHub returns a different format, normalize it
      const tokens: TokenResponse = {
        access_token: data.access_token,
        token_type: data.token_type || 'Bearer',
        scope: data.scope,
        // GitHub doesn't provide refresh tokens or expiry
      };

      logger.info('Successfully exchanged code for GitHub token');
      return tokens;
    } catch (error) {
      logger.error('Error exchanging GitHub code:', error);
      throw error;
    }
  }

  /**
   * GitHub doesn't support refresh tokens
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    throw new Error('GitHub does not support refresh tokens');
  }

  /**
   * Get GitHub user info with email addresses
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    try {
      // Get basic user info
      const userResponse = await fetch(this.userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!userResponse.ok) {
        throw new Error(`Failed to get user info: ${userResponse.status}`);
      }

      const userData = await userResponse.json();

      // Get email addresses (separate endpoint)
      let primaryEmail = userData.email;
      let emailVerified = false;

      try {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });

        if (emailResponse.ok) {
          const emails = await emailResponse.json();
          const primary = emails.find((e: any) => e.primary);
          if (primary) {
            primaryEmail = primary.email;
            emailVerified = primary.verified;
          }
        }
      } catch (error) {
        logger.warn('Failed to fetch GitHub email addresses:', error);
      }

      const userInfo = this.normalizeUserInfo({
        ...userData,
        email: primaryEmail,
        email_verified: emailVerified,
      });

      logger.info(`Retrieved GitHub user info for user ${userInfo.id}`);
      return userInfo;
    } catch (error) {
      logger.error('Error getting GitHub user info:', error);
      throw error;
    }
  }

  /**
   * Normalize GitHub user info
   */
  protected normalizeUserInfo(data: any): UserInfo {
    return {
      id: data.id?.toString() || '',
      email: data.email,
      email_verified: data.email_verified || false,
      name: data.name || data.login,
      picture: data.avatar_url,
      locale: undefined, // GitHub doesn't provide locale
      provider: this.name,
      raw: data,
    };
  }

  /**
   * Check if user has access to specific organization
   */
  async checkOrganizationMembership(
    accessToken: string,
    org: string
  ): Promise<boolean> {
    try {
      const response = await fetch(`https://api.github.com/orgs/${org}/members`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (response.status === 204) {
        return true; // User is a member
      }

      return false;
    } catch (error) {
      logger.error(`Error checking GitHub org membership:`, error);
      return false;
    }
  }

  /**
   * Get user's organizations
   */
  async getUserOrganizations(accessToken: string): Promise<any[]> {
    try {
      const response = await fetch('https://api.github.com/user/orgs', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get organizations: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Error getting GitHub organizations:', error);
      return [];
    }
  }

  /**
   * Check repository access
   */
  async checkRepositoryAccess(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Handle GitHub-specific errors
   */
  protected handleProviderError(error: any): never {
    if (error.error === 'bad_verification_code') {
      throw new Error('Invalid or expired authorization code');
    }

    if (error.error === 'incorrect_client_credentials') {
      throw new Error('Invalid client credentials');
    }

    if (error.error === 'redirect_uri_mismatch') {
      throw new Error('Redirect URI mismatch');
    }

    throw error;
  }
}