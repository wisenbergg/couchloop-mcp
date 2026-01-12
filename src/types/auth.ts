import { z } from 'zod';

/**
 * Authentication context that can be passed through MCP tool calls
 * This allows the AI agent to provide user authentication info
 */
export const AuthContextSchema = z.object({
  /**
   * OAuth access token or session identifier
   * This will be validated against the OAuth tokens table
   */
  token: z.string().optional().describe('OAuth access token or session identifier'),

  /**
   * External user identifier (from OAuth provider)
   * Used as a fallback if token validation fails
   */
  user_id: z.string().optional().describe('External user identifier from OAuth provider'),

  /**
   * Client identifier (ChatGPT, Claude, etc.)
   * Helps track which AI agent is making the request
   */
  client_id: z.string().optional().describe('Client application identifier'),
});

export type AuthContext = z.infer<typeof AuthContextSchema>;

/**
 * Extract user ID from authentication context
 * Returns a mock user ID if no context is provided (backward compatibility)
 */
export async function extractUserFromContext(authContext?: AuthContext): Promise<string> {
  // If we have a user_id directly, use it
  if (authContext?.user_id) {
    return authContext.user_id;
  }

  // If we have a token, we could validate it here
  // For now, we'll extract a user ID from the token if it's a JWT-like structure
  if (authContext?.token) {
    // TODO: Implement proper JWT validation and extraction
    // For now, just use the token as a user identifier
    return `oauth_${authContext.token.substring(0, 16)}`;
  }

  // Fallback to anonymous user with optional client tracking
  const clientPrefix = authContext?.client_id ? `${authContext.client_id}_` : '';
  const { nanoid } = await import('nanoid');
  return `usr_${clientPrefix}${nanoid(8)}`;
}