/**
 * Streamable HTTP Transport for MCP Server
 * Enables ChatGPT to connect via SSE and HTTP
 */
import { Server } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { setupTools } from '../tools/index.js';
import { setupResources } from '../resources/index.js';
import { logger } from '../utils/logger.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';

// Store active transports and servers by session ID
const activeSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

/**
 * Create and configure an MCP server instance
 */
async function createMCPServer(): Promise<Server> {
  // Create MCP server instance
  const server = new Server(
    {
      name: 'couchloop-mcp',
      version: '1.0.2',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        experimental: {} // Support experimental features for ChatGPT
      },
    }
  );

  // Set up tools and resources
  const tools = await setupTools();
  const resources = await setupResources();

  // Set up tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => t.definition)
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const tool = tools.find(t => t.definition.name === request.params.name);
    if (!tool) {
      throw new Error(`Tool not found: ${request.params.name}`);
    }
    return await tool.handler(request.params.arguments || {});
  });

  // Set up resource handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map(r => r.definition)
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
    const resource = resources.find(r => r.definition.uri === request.params.uri);
    if (!resource) {
      throw new Error(`Resource not found: ${request.params.uri}`);
    }
    const content = await resource.handler();
    return {
      contents: [{
        uri: request.params.uri,
        mimeType: resource.definition.mimeType || 'application/json',
        text: content
      }]
    };
  });

  return server;
}

/**
 * Handle SSE/HTTP requests for ChatGPT MCP connection
 * This endpoint handles both GET (SSE) and POST (HTTP) requests
 */
export async function handleSSE(req: Request, res: Response) {
  try {
    // Get or generate session ID
    let sessionId = req.headers['x-session-id'] as string;

    // Check if this is an existing session
    let session = activeSessions.get(sessionId);

    if (!session) {
      // Create new session
      sessionId = sessionId || `session_${crypto.randomBytes(16).toString('hex')}`;

      // Create transport with stateful mode (session management)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });

      // Create and configure server
      const server = await createMCPServer();

      // Connect transport to server
      await server.connect(transport);

      // Store session
      session = { transport, server };
      activeSessions.set(sessionId, session);

      logger.info(`New MCP session created: ${sessionId}`);
    }

    // Handle the request through the transport
    await session.transport.handleRequest(req as any, res as any, req.body);

  } catch (error) {
    logger.error('SSE/HTTP handler error:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    logger.error('Request body was:', req.body);

    // Send appropriate error response if not already sent
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to handle MCP request',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: process.env.NODE_ENV !== 'production' ? (error instanceof Error ? error.stack : undefined) : undefined
      });
    }
  }
}

/**
 * Handle lenient MCP requests for ChatGPT compatibility
 * This endpoint is more forgiving with Accept headers
 */
export async function handleMCPLenient(req: Request, res: Response) {
  console.log('=== handleMCPLenient called ===');
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);

  try {
    // Log incoming headers for debugging
    logger.info('MCP Request Headers:', {
      accept: req.headers.accept,
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'x-session-id': req.headers['x-session-id']
    });

    // Normalize Accept header for compatibility
    const originalAccept = req.headers.accept || '';
    if (originalAccept === '*/*' ||
        originalAccept === 'application/json' ||
        originalAccept === 'application/*' ||
        !originalAccept) {
      // Set the required Accept header for MCP
      req.headers.accept = 'application/json, text/event-stream';
      logger.info(`Normalized Accept header from "${originalAccept}" to "${req.headers.accept}"`);
    }

    // Get or generate session ID
    let sessionId = req.headers['x-session-id'] as string;

    // Check if this is an existing session
    let session = activeSessions.get(sessionId);

    if (!session) {
      // Create new session
      sessionId = sessionId || `session_${crypto.randomBytes(16).toString('hex')}`;

      // Create transport with lenient options
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        // Enable JSON-only responses for better compatibility
        enableJsonResponse: true,
      } as any);

      // Create and configure server
      const server = await createMCPServer();

      // Connect transport to server
      await server.connect(transport);

      // Store session
      session = { transport, server };
      activeSessions.set(sessionId, session);

      logger.info(`New lenient MCP session created: ${sessionId}`);
    }

    // Log request details
    if (req.body) {
      logger.info('MCP Request:', {
        method: req.body.method,
        id: req.body.id,
        params: req.body.params
      });
    }

    // Handle the request through the transport
    // Create a modified request object with normalized headers
    const modifiedReq = Object.assign({}, req, {
      headers: Object.assign({}, req.headers)
    });
    await session.transport.handleRequest(modifiedReq as any, res as any, req.body);

  } catch (error) {
    logger.error('Lenient MCP handler error:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    logger.error('Request body was:', req.body);

    // Send appropriate error response if not already sent
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to handle MCP request',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: process.env.NODE_ENV !== 'production' ? (error instanceof Error ? error.stack : undefined) : undefined
      });
    }
  }
}

/**
 * Clean up inactive sessions periodically
 * TODO: Implement session activity tracking and cleanup
 */
setInterval(() => {
  // In production, you'd want to track last activity time and clean up inactive sessions
  // For now, we'll keep all sessions active
  // const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  // for (const [sessionId, session] of activeSessions.entries()) {
  //   if (session.lastActivity < thirtyMinutesAgo) {
  //     session.transport.close();
  //     activeSessions.delete(sessionId);
  //   }
  // }
}, 5 * 60 * 1000); // Run every 5 minutes

/**
 * Graceful shutdown - clean up all sessions
 */
export async function cleanupSessions() {
  logger.info('Cleaning up MCP sessions...');

  for (const [sessionId, session] of activeSessions.entries()) {
    try {
      await session.transport.close();
      logger.info(`Closed session: ${sessionId}`);
    } catch (error) {
      logger.error(`Error closing session ${sessionId}:`, error);
    }
  }

  activeSessions.clear();
}