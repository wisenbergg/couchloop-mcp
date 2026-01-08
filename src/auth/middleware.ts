import { jwtVerify } from 'jose';
import { AuthenticationError } from '../utils/errors.js';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret-min-32-characters-long');

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