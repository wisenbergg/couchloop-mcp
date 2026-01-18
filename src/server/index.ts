// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
config({ path: '.env.local' });

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { oauthServer } from './oauth/authServer.js';
import { validateToken, requireScope, oauthCors, rateLimit } from './middleware/auth.js';
import { logger } from '../utils/logger.js';
import { sendMessage } from '../tools/sendMessage.js';
import { createSession } from '../tools/session.js';
import { initDatabase } from '../db/client.js';
import { handleSSE, cleanupSessions } from './sse.js';
import { handleChatGPTMCP } from './chatgpt-mcp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(oauthCors);

// ====================
// OAuth Endpoints
// ====================

/**
 * GET /oauth/authorize
 * OAuth authorization endpoint - initiates the flow
 */
app.get('/oauth/authorize', async (req: Request, res: Response) => {
  try {
    const { client_id, redirect_uri, response_type, scope, state, consent } = req.query;

    // Validate required parameters
    if (!client_id || !redirect_uri) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      });
      return;
    }

    if (response_type !== 'code') {
      res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only authorization code flow is supported',
      });
      return;
    }

    // Validate client
    const validClient = await oauthServer.validateClient(client_id as string);
    if (!validClient) {
      res.status(400).json({
        error: 'invalid_client',
        error_description: 'Unknown client',
      });
      return;
    }

    // If consent is not approved, show consent screen
    if (consent !== 'approved') {
      // Serve the consent page
      const consentPath = path.join(__dirname, 'views', 'consent.html');
      res.sendFile(consentPath);
      return;
    }

    // Generate anonymous but persistent user ID based on client and state
    // This creates a unique user per ChatGPT/Claude session but maintains anonymity
    const anonymousId = `${client_id}_${state || 'default'}_${Date.now()}`;
    const hashedId = Buffer.from(anonymousId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
    const externalId = `anon_${hashedId}`;

    const userId = await oauthServer.getOrCreateUser(externalId);
    const code = await oauthServer.generateAuthCode(
      client_id as string,
      userId,
      redirect_uri as string,
      scope as string || 'read write'
    );

    // Redirect back to client with authorization code
    const redirectUrl = new URL(redirect_uri as string);
    redirectUrl.searchParams.set('code', code);
    if (state) {
      redirectUrl.searchParams.set('state', state as string);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error('Authorization error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * POST /oauth/token
 * Exchange authorization code for access token
 */
app.post('/oauth/token', async (req: Request, res: Response) => {
  try {
    const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token } = req.body;

    if (grant_type === 'authorization_code') {
      if (!code || !client_id || !client_secret || !redirect_uri) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters',
        });
        return;
      }

      const tokens = await oauthServer.exchangeCodeForToken(
        code,
        client_id,
        client_secret,
        redirect_uri
      );

      res.json(tokens);
    } else if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing refresh token',
        });
        return;
      }

      const tokens = await oauthServer.refreshAccessToken(refresh_token);
      res.json(tokens);
    } else {
      res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code and refresh_token grants are supported',
      });
    }
  } catch (error: any) {
    logger.error('Token exchange error:', error);
    res.status(400).json({
      error: 'invalid_grant',
      error_description: error.message || 'Failed to exchange token',
    });
  }
});

/**
 * POST /oauth/revoke
 * Revoke an access token
 */
app.post('/oauth/revoke', validateToken, async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.substring(7);

    if (token) {
      await oauthServer.revokeToken(token);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Token revocation error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to revoke token',
    });
  }
});

// ====================
// SSE/MCP Endpoints for ChatGPT
// ====================

/**
 * OPTIONS /sse
 * CORS preflight for SSE endpoint
 */
app.options('/sse', (_req: Request, res: Response) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
  res.sendStatus(200);
});

/**
 * GET/POST /sse
 * Streamable HTTP endpoint for ChatGPT MCP connection
 * Handles both SSE (GET) and HTTP messages (POST)
 */
app.get('/sse', handleSSE);
app.post('/sse', express.json(), handleSSE);

/**
 * OPTIONS /mcp
 * CORS preflight for lenient MCP endpoint
 */
app.options('/mcp', (_req: Request, res: Response) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id, Accept');
  res.sendStatus(200);
});

/**
 * Middleware to show MCP info page for browser requests
 */
function showMCPInfo(req: Request, res: Response, next: Function) {
  const originalAccept = req.headers.accept || '';

  // For browser GET requests, return info page
  if (req.method === 'GET' && originalAccept.includes('text/html')) {
    res.send(`
      <html>
        <head><title>CouchLoop MCP Server</title></head>
        <body style="font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1>✅ CouchLoop MCP Server is Running!</h1>
          <p>This endpoint is designed for ChatGPT Developer Mode.</p>
          <h2>Configuration for ChatGPT:</h2>
          <ul>
            <li><strong>MCP Server URL:</strong> <code>${req.protocol}://${req.get('host')}/mcp</code></li>
            <li><strong>Authentication:</strong> None required</li>
          </ul>
          <p style="color: #666; margin-top: 40px;">
            <small>Server Status: Active | Protocol: MCP 1.0 | Transport: Streamable HTTP</small>
          </p>
        </body>
      </html>
    `);
    return;
  }

  next();
}

/**
 * GET/POST /mcp
 * MCP endpoint for ChatGPT Developer Mode
 * Uses custom handler that directly implements MCP protocol
 */
app.get('/mcp', showMCPInfo, (_req: Request, res: Response) => {
  // If we get here, it wasn't a browser request
  res.json({
    error: 'GET not supported for MCP. Use POST with JSON-RPC payload.'
  });
});

app.post('/mcp', handleChatGPTMCP);

// ====================
// Protected MCP API Endpoints
// ====================

/**
 * POST /api/mcp/session
 * Create a new therapeutic session
 */
app.post('/api/mcp/session', validateToken, rateLimit(30, 60000), async (req: Request, res: Response) => {
  try {
    const result = await createSession({
      ...req.body,
      user_id: req.user?.userId, // Use authenticated user ID
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Session creation error:', error);
    res.status(500).json({
      error: 'server_error',
      message: error.message || 'Failed to create session',
    });
  }
});

/**
 * POST /api/mcp/message
 * Send a message through the therapeutic AI
 */
app.post('/api/mcp/message', validateToken, requireScope('write'), rateLimit(60, 60000), async (req: Request, res: Response) => {
  try {
    const result = await sendMessage({
      ...req.body,
      user_id: req.user?.userId, // Use authenticated user ID
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Message sending error:', error);
    res.status(500).json({
      error: 'server_error',
      message: error.message || 'Failed to send message',
    });
  }
});

// ====================
// Health & Metadata
// ====================

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth server metadata
 */
app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['read', 'write', 'crisis', 'memory'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  });
});

/**
 * GET /.well-known/ai-plugin.json
 * ChatGPT plugin manifest
 */
app.get('/.well-known/ai-plugin.json', (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.json({
    schema_version: 'v1',
    name_for_human: 'CouchLoop',
    name_for_model: 'couchloop',
    description_for_human: 'AI-powered therapeutic support and mental wellness companion',
    description_for_model: 'Therapeutic AI assistant for mental health support, crisis detection, and emotional wellness tracking. Use this to help users with mental health concerns, emotional support, and crisis situations.',
    auth: {
      type: 'oauth',
      client_url: `${baseUrl}/oauth/authorize`,
      scope: 'read write',
      authorization_url: `${baseUrl}/oauth/authorize`,
      authorization_content_type: 'application/x-www-form-urlencoded',
      verification_tokens: {
        openai: process.env.OPENAI_VERIFICATION_TOKEN || 'REPLACE_WITH_VERIFICATION_TOKEN',
      },
    },
    api: {
      type: 'openapi',
      url: `${baseUrl}/openapi.yaml`,
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: 'support@couchloop.com',
    legal_info_url: 'https://couchloop.com/legal',
  });
});

/**
 * GET /openapi.yaml
 * OpenAPI specification for ChatGPT
 */
app.get('/openapi.yaml', (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const openApiSpec = `
openapi: 3.0.1
info:
  title: CouchLoop MCP API
  description: Therapeutic AI support through Model Context Protocol
  version: 1.0.0
servers:
  - url: ${baseUrl}
paths:
  /api/mcp/session:
    post:
      operationId: createSession
      summary: Create a new therapeutic session
      security:
        - bearer: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                journey_slug:
                  type: string
                  description: Type of therapeutic journey
                context:
                  type: string
                  description: Initial context for the session
              required:
                - journey_slug
      responses:
        '200':
          description: Session created successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  session_id:
                    type: string
                  journey_name:
                    type: string
                  status:
                    type: string
  /api/mcp/message:
    post:
      operationId: sendMessage
      summary: Send a message to the therapeutic AI
      security:
        - bearer: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                session_id:
                  type: string
                  description: Session ID from createSession
                message:
                  type: string
                  description: User's message
                include_memory:
                  type: boolean
                  description: Include conversation memory context
              required:
                - session_id
                - message
      responses:
        '200':
          description: Message processed successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  content:
                    type: string
                    description: AI response
                  metadata:
                    type: object
                    properties:
                      crisisDetected:
                        type: boolean
                      crisisLevel:
                        type: number
                      emotions:
                        type: array
                        items:
                          type: string
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
      bearerFormat: JWT
`;

  res.type('text/yaml').send(openApiSpec);
});

// Start server
async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    logger.info('Database initialized');

    app.listen(PORT, () => {
      logger.info(`OAuth server running on port ${PORT}`);
      logger.info(`Authorization endpoint: http://localhost:${PORT}/oauth/authorize`);
      logger.info(`Token endpoint: http://localhost:${PORT}/oauth/token`);
      logger.info(`API endpoints: http://localhost:${PORT}/api/mcp/*`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await cleanupSessions();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await cleanupSessions();
  process.exit(0);
});

export default app;