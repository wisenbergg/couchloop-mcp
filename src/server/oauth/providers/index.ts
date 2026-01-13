import { ProviderFactory } from './base.js';
import { GoogleOAuthProvider } from './google.js';
import { GitHubOAuthProvider } from './github.js';
import { logger } from '../../../utils/logger.js';

/**
 * Register all available OAuth providers
 */
export function registerProviders(): void {
  // Register Google
  ProviderFactory.register('google', GoogleOAuthProvider);

  // Register GitHub
  ProviderFactory.register('github', GitHubOAuthProvider);

  // Additional providers can be registered here
  // ProviderFactory.register('microsoft', MicrosoftOAuthProvider);
  // ProviderFactory.register('apple', AppleOAuthProvider);

  logger.info(`Registered ${ProviderFactory.getProviders().length} OAuth providers`);
}

// Auto-register on module load
registerProviders();

// Export all providers and factory
export { ProviderFactory } from './base.js';
export { GoogleOAuthProvider } from './google.js';
export { GitHubOAuthProvider } from './github.js';
export type {
  OAuthProvider,
  TokenResponse,
  UserInfo,
  IdTokenClaims,
  ProviderConfig,
} from './base.js';