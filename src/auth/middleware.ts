import { jwtVerify } from 'jose';
import { AuthenticationError } from '../utils/errors.js';
import crypto from 'crypto';

// Only validate JWT_SECRET when running as web server (not in MCP mode)
const isMCPMode = process.env.MCP_MODE === 'true';

let JWT_SECRET: Uint8Array;
if (!isMCPMode) {
  // Ensure JWT_SECRET is properly set for web server mode
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable must be set when not in MCP mode');
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
  JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
} else {
  // MCP mode doesn't use JWT auth - generate random bytes that will never match
  JWT_SECRET = new TextEncoder().encode(crypto.randomBytes(32).toString('hex'));
}

export interface AuthContext {
  userId: string;
  clientId: string;
  scope: string;
}

export async function validateToken(authHeader?: string): Promise<AuthContext> {
  if (!authHeader) {
    throw new AuthenticationError('No authorization header');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Invalid authorization header format');
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    return {
      userId: payload.sub as string,
      clientId: payload.client_id as string,
      scope: payload.scope as string,
    };
  } catch (error) {
    throw new AuthenticationError('Invalid or expired token');
  }
}

export function extractAuthHeader(args: any): string | undefined {
  // MCP protocol might pass auth in various ways
  // Check common patterns
  if (args?._auth?.authorization) {
    return args._auth.authorization;
  }
  if (args?.authorization) {
    return args.authorization;
  }
  if (args?.headers?.authorization) {
    return args.headers.authorization;
  }

  // In production mode, require authentication
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }

  // In development, allow unauthenticated requests
  return 'Bearer development-token';
}