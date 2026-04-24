import { z } from 'zod';
import { createHash } from 'crypto';
import { homedir, hostname } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Authentication context that can be passed through MCP tool calls
 * This allows the AI agent to provide user authentication info
 */
export const AuthContextSchema = z.object({
  token: z.string().optional().describe('OAuth access token or session identifier'),
  user_id: z.string().optional().describe('External user identifier from OAuth provider'),
  client_id: z.string().optional().describe('Client application identifier'),
  thread_id: z.string().optional().describe('Stable thread identifier used to scope conversation memory'),
  conversation_id: z.string().optional().describe('Stable conversation identifier for user binding'),
});

export type AuthContext = z.infer<typeof AuthContextSchema>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Normalize auth context from MCP tool args.
 *
 * Some clients send identity in nested transport metadata (for example
 * _auth.authorization or _meta.thread_id) instead of the explicit auth object.
 * This helper merges both paths so identity resolution stays stable.
 */
export function resolveAuthContextFromArgs(
  rawArgs: unknown,
  explicitAuth?: AuthContext,
): AuthContext | undefined {
  const args = asRecord(rawArgs);
  const authObj = asRecord(args?.auth);
  const authMeta = asRecord(args?._auth);
  const headers = asRecord(args?.headers);
  const meta = asRecord(args?._meta);

  const token =
    explicitAuth?.token ??
    (typeof authObj?.token === 'string' ? authObj.token : undefined) ??
    (typeof authMeta?.authorization === 'string' ? authMeta.authorization : undefined) ??
    (typeof args?.authorization === 'string' ? args.authorization : undefined) ??
    (typeof headers?.authorization === 'string' ? headers.authorization : undefined);

  const user_id =
    explicitAuth?.user_id ??
    (typeof authObj?.user_id === 'string' ? authObj.user_id : undefined) ??
    (typeof args?.user_id === 'string' ? args.user_id : undefined) ??
    (typeof meta?.user_id === 'string' ? meta.user_id : undefined) ??
    (typeof meta?.sub === 'string' ? meta.sub : undefined);

  const client_id =
    explicitAuth?.client_id ??
    (typeof authObj?.client_id === 'string' ? authObj.client_id : undefined) ??
    (typeof args?.client_id === 'string' ? args.client_id : undefined) ??
    (typeof meta?.client_id === 'string' ? meta.client_id : undefined);

  const thread_id =
    explicitAuth?.thread_id ??
    (typeof authObj?.thread_id === 'string' ? authObj.thread_id : undefined) ??
    (typeof args?.thread_id === 'string' ? args.thread_id : undefined) ??
    (typeof meta?.thread_id === 'string' ? meta.thread_id : undefined);

  const conversation_id =
    explicitAuth?.conversation_id ??
    (typeof authObj?.conversation_id === 'string' ? authObj.conversation_id : undefined) ??
    (typeof args?.conversation_id === 'string' ? args.conversation_id : undefined) ??
    (typeof meta?.conversation_id === 'string' ? meta.conversation_id : undefined);

  const normalized: AuthContext = {
    ...(token ? { token } : {}),
    ...(user_id ? { user_id } : {}),
    ...(client_id ? { client_id } : {}),
    ...(thread_id ? { thread_id } : {}),
    ...(conversation_id ? { conversation_id } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Local identity file structure for free tier persistence
 */
interface LocalIdentity {
  user_id: string;
  created_at: string;
  machine: string;
  tier: 'free' | 'pro';
}

const IDENTITY_DIR = join(homedir(), '.couchloop-mcp');
const IDENTITY_FILE = join(IDENTITY_DIR, 'identity.json');

function isHostedRuntime(): boolean {
  return Boolean(
    process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID,
  );
}

/**
 * Get or create local identity file for free tier users
 * This provides single-machine persistence without requiring OAuth
 */
function getOrCreateLocalIdentity(): string {
  try {
    // Ensure directory exists
    if (!existsSync(IDENTITY_DIR)) {
      mkdirSync(IDENTITY_DIR, { recursive: true });
    }

    // Check if identity file exists
    if (existsSync(IDENTITY_FILE)) {
      const data = readFileSync(IDENTITY_FILE, 'utf-8');
      const identity: LocalIdentity = JSON.parse(data);
      if (identity.user_id && identity.user_id.startsWith('local_')) {
        return identity.user_id;
      }
    }

    // Create new local identity
    const machineId = createHash('sha256')
      .update(hostname() + ':' + homedir() + ':' + Date.now())
      .digest('hex')
      .substring(0, 24);

    const newIdentity: LocalIdentity = {
      user_id: 'local_' + machineId,
      created_at: new Date().toISOString(),
      machine: hostname(),
      tier: 'free',
    };

    writeFileSync(IDENTITY_FILE, JSON.stringify(newIdentity, null, 2));
    logger.info('Created local identity: ' + newIdentity.user_id + ' at ' + IDENTITY_FILE);
    
    return newIdentity.user_id;
  } catch (error) {
    logger.warn('Failed to create/read local identity file:', error);
    return '';
  }
}

/**
 * Extract user ID from authentication context
 * Implements tiered identity:
 * - Priority 1: OAuth token validation (Pro tier - cross-device)
 * - Priority 2: External user ID + client ID (ChatGPT OAuth)
 * - Priority 3: Local file-based identity (Free tier - single machine)
 * - Priority 4: Conversation-based ID (single window only)
 * - Fallback: Ephemeral IDs (no persistence)
 */
export async function extractUserFromContext(authContext?: AuthContext): Promise<string> {
  // Priority 1: OAuth token validation (Pro tier - future)
  if (authContext?.token) {
    const hash = createHash('sha256').update(authContext.token).digest('hex');
    return 'oauth_' + hash.substring(0, 24);
  }

  // Priority 2: Hash-based persistent ID from external user identifier
  // For ChatGPT: this is the openai/subject that persists across all chat windows
  if (authContext?.user_id && authContext?.client_id) {
    const hash = createHash('sha256')
      .update(authContext.client_id + ':' + authContext.user_id)
      .digest('hex');
    return authContext.client_id + '_' + hash.substring(0, 24);
  }

  // Priority 3: Thread-based identity for hosted MCP deployments.
  // This prevents multiple anonymous clients from collapsing into one shared
  // server-local identity when auth headers are not present.
  if (authContext?.thread_id) {
    const scope = authContext.client_id
      ? `${authContext.client_id}:thread:${authContext.thread_id}`
      : `thread:${authContext.thread_id}`;
    const hash = createHash('sha256').update(scope).digest('hex');
    return 'thread_' + hash.substring(0, 24);
  }

  // Priority 4: Conversation-based ID (single chat window only)
  if (authContext?.client_id && authContext?.conversation_id) {
    const hash = createHash('sha256')
      .update(authContext.client_id + ':conv:' + authContext.conversation_id)
      .digest('hex');
    return 'conv_' + hash.substring(0, 28);
  }

  // Priority 5: Local file-based identity (Free tier)
  // Disabled in hosted runtimes because the server filesystem identity is shared
  // across all anonymous callers and breaks tenant isolation.
  if (isHostedRuntime()) {
    logger.warn('Hosted runtime without auth or thread_id, falling back to ephemeral identity');
  } else {
    const localIdentity = getOrCreateLocalIdentity();
    if (localIdentity) {
      return localIdentity;
    }
  }

  // Priority 6: Ephemeral IDs (no persistence)
  // Provides single-machine persistence for VS Code, Cursor, Claude Desktop, etc.
  logger.warn('Creating ephemeral user - no stable identity provided', {
    client_id: authContext?.client_id,
    has_thread_id: !!authContext?.thread_id,
    has_conversation_id: !!authContext?.conversation_id,
    timestamp: new Date().toISOString()
  });

  const { nanoid } = await import('nanoid');
  return 'ephemeral_' + nanoid(12);
}

/**
 * Get user tier from identity prefix
 */
export function getUserTier(userId: string): 'pro' | 'free' | 'ephemeral' {
  if (userId.startsWith('oauth_')) return 'pro';
  if (userId.startsWith('local_')) return 'free';
  if (userId.startsWith('ephemeral_')) return 'ephemeral';
  // Client-based IDs (chatgpt_, claude_, etc.) could be either
  return 'free';
}

/**
 * Check if user has Pro tier features
 */
export function hasProFeatures(userId: string): boolean {
  return getUserTier(userId) === 'pro';
}

/**
 * Get the local identity file path for debugging/support
 */
export function getIdentityFilePath(): string {
  return IDENTITY_FILE;
}
