import { Request, Response, NextFunction } from 'express';
import { oauthServer } from '../oauth/authServer.js';
import { logger } from '../../utils/logger.js';

// Extend Express Request to include user context
declare module 'express' {
  interface Request {
    user?: {
      userId: string;
      clientId: string;
      scope: string;
    };
  }
}

/**
 * Middleware to validate OAuth access token
 */
export async function validateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Missing authorization header',
      });
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid authorization format. Use Bearer token',
      });
      return;
    }

    const token = authHeader.substring(7);

    // Validate token
    const tokenPayload = await oauthServer.validateAccessToken(token);

    if (!tokenPayload) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or expired access token',
      });
      return;
    }

    // Attach user context to request
    req.user = {
      userId: tokenPayload.sub,
      clientId: tokenPayload.client_id,
      scope: tokenPayload.scope,
    };

    logger.debug(`Authenticated user ${tokenPayload.sub} from client ${tokenPayload.client_id}`);
    next();
  } catch (error) {
    logger.error('Token validation error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to validate token',
    });
  }
}

/**
 * Middleware to check required scopes
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const userScopes = req.user.scope.split(' ');
    const hasRequiredScope = requiredScopes.some(scope => userScopes.includes(scope));

    if (!hasRequiredScope) {
      res.status(403).json({
        error: 'forbidden',
        message: `Insufficient scope. Required: ${requiredScopes.join(' or ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Optional authentication - sets user if token present but doesn't require it
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token, continue without user context
      next();
      return;
    }

    const token = authHeader.substring(7);
    const tokenPayload = await oauthServer.validateAccessToken(token);

    if (tokenPayload) {
      req.user = {
        userId: tokenPayload.sub,
        clientId: tokenPayload.client_id,
        scope: tokenPayload.scope,
      };
    }

    next();
  } catch (error) {
    // Log error but continue without auth
    logger.debug('Optional auth error (continuing):', error);
    next();
  }
}

/**
 * Rate limiting per user/client
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.user
      ? `user:${req.user.userId}`
      : `ip:${req.ip}`;

    const now = Date.now();
    const limit = rateLimitMap.get(key);

    if (!limit || now > limit.resetAt) {
      // New window
      rateLimitMap.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    if (limit.count >= maxRequests) {
      res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests',
        retryAfter: Math.ceil((limit.resetAt - now) / 1000),
      });
      return;
    }

    limit.count++;
    next();
  };
}

/**
 * CORS middleware for OAuth endpoints
 */
export function oauthCors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const allowedOrigins = [
    'https://chat.openai.com',
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}