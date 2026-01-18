import { z } from 'zod';
import { createHash } from 'crypto';

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

  /**
   * Stable conversation identifier for user binding
   * Used to generate persistent user IDs for MCP clients without OAuth
   */
  conversation_id: z.string().optional().describe('Stable conversation identifier for user binding'),
});

export type AuthContext = z.infer<typeof AuthContextSchema>;

/**
 * Extract user ID from authentication context
 * Implements secure hash-based persistent identity for MCP clients
 * Falls back to ephemeral IDs only when no stable context is available
 */
export async function extractUserFromContext(authContext?: AuthContext): Promise<string> {
  // Priority 1: Explicit user_id from OAuth provider
  if (authContext?.user_id) {
    return authContext.user_id;
  }

  // Priority 2: JWT token validation (future OAuth implementation)
  if (authContext?.token) {
    // TODO: Implement proper JWT validation and extraction
    // For now, use token as a temporary identifier
    return `oauth_${authContext.token.substring(0, 16)}`;
  }

  // Priority 3: Hash-based persistent ID for MCP clients
  // This ensures the same user gets the same ID across all sessions
  if (authContext?.client_id && authContext?.conversation_id) {
    const hash = createHash('sha256')
      .update(`${authContext.client_id}:${authContext.conversation_id}`)
      .digest('hex');
    // Use mcp_ prefix to identify these as MCP-generated stable IDs
    return `mcp_${hash.substring(0, 28)}`;
  }

  // Fallback: Create ephemeral user with warning
  // These should be cleaned up periodically as they indicate missing context
  console.warn('Creating ephemeral user - no stable identity provided', {
    client_id: authContext?.client_id,
    has_conversation_id: !!authContext?.conversation_id,
    timestamp: new Date().toISOString()
  });

  const { nanoid } = await import('nanoid');
  // Use ephemeral_ prefix to clearly identify temporary users
  return `ephemeral_${nanoid(12)}`;
}