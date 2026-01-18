/**
 * Middleware to handle Chrome's Local Network Access restrictions
 * https://developer.chrome.com/blog/local-network-access
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';

/**
 * Local Network Access headers middleware
 * Adds necessary headers for Chrome's Private Network Access feature
 */
export function localNetworkAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log when requests come from public contexts to local network
  const origin = req.headers.origin || 'no-origin';
  const isLocalRequest =
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.includes('.local') ||
    origin.includes('192.168.') ||
    origin.includes('10.') ||
    origin.includes('172.');

  if (!isLocalRequest && origin !== 'no-origin') {
    logger.info(`[Local Network Access] Request from public origin: ${origin}`);
  }

  // Set headers for Local Network Access
  // These headers inform the browser about the server's network location
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  // Handle preflight requests for Private Network Access
  if (req.method === 'OPTIONS') {
    const requestPrivateNetwork = req.headers['access-control-request-private-network'];

    if (requestPrivateNetwork === 'true') {
      logger.info('[Local Network Access] Handling private network preflight request');

      // Explicitly allow private network access
      res.setHeader('Access-Control-Allow-Private-Network', 'true');

      // Ensure CORS headers are set
      const allowedOrigins = [
        'https://chat.openai.com',
        'https://claude.ai',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173', // Vite default
        'http://localhost:8080',
        'http://mcp.local:3000',
      ];

      const requestOrigin = req.headers.origin;

      // For development, be more permissive
      if (process.env.NODE_ENV === 'development') {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
      } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      }

      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Session-Id, X-Source, X-Idempotency-Key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      // Respond to preflight immediately
      res.status(204).end();
      return;
    }
  }

  next();
}

/**
 * Enhanced CORS configuration for development
 * More permissive for local development, stricter for production
 */
export function enhancedCors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const origin = req.headers.origin;

  if (isDevelopment) {
    // In development, allow all origins but log them
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    if (origin) {
      logger.debug(`[CORS] Development request from: ${origin}`);
    }
  } else {
    // In production, use strict allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'https://chat.openai.com',
      'https://claude.ai',
    ];

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }

  // Standard CORS headers
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Session-Id, X-Source, X-Idempotency-Key, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Private Network Access header
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}