/**
 * Custom MCP handler for ChatGPT Developer Mode
 * Implements MCP protocol directly over HTTP without StreamableHTTPServerTransport
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { setupTools } from '../tools/index.js';
import { setupResources } from '../resources/index.js';

// Store sessions by ID
const sessions = new Map<string, any>();

/**
 * Handle MCP requests from ChatGPT
 */
export async function handleChatGPTMCP(req: Request, res: Response) {
  try {
    logger.info('ChatGPT MCP Request:', {
      method: req.body?.method,
      id: req.body?.id,
      params: req.body?.params
    });

    // Get or create session
    const sessionId = req.headers['x-session-id'] as string || 'default';

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        tools: await setupTools(),
        resources: await setupResources(),
        initialized: false
      });
    }

    const session = sessions.get(sessionId)!;
    const { method, params, id } = req.body;

    // Handle different MCP methods
    switch (method) {
      case 'initialize': {
        session.initialized = true;

        // Return capabilities
        const response = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params.protocolVersion || '2024-11-05',
            capabilities: {
              tools: {
                listChanged: false
              },
              resources: {
                subscribe: false,
                listChanged: false
              }
            },
            serverInfo: {
              name: 'couchloop-mcp',
              version: '1.0.2'
            }
          }
        };

        logger.info('Sending initialize response:', response);
        res.json(response);
        break;
      }

      case 'tools/list': {
        const response = {
          jsonrpc: '2.0',
          id,
          result: {
            tools: session.tools.map((t: any) => t.definition)
          }
        };

        logger.info('Sending tools list:', response);
        res.json(response);
        break;
      }

      case 'tools/call': {
        const tool = session.tools.find((t: any) => t.definition.name === params.name);

        if (!tool) {
          res.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Tool not found: ${params.name}`
            }
          });
          return;
        }

        try {
          const result = await tool.handler(params.arguments || {});

          const response = {
            jsonrpc: '2.0',
            id,
            result
          };

          logger.info('Tool call result:', response);
          res.json(response);
        } catch (error: any) {
          logger.error('Tool call error:', error);
          res.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: error.message || 'Tool execution failed'
            }
          });
        }
        break;
      }

      case 'resources/list': {
        const response = {
          jsonrpc: '2.0',
          id,
          result: {
            resources: session.resources.map((r: any) => r.definition)
          }
        };

        logger.info('Sending resources list:', response);
        res.json(response);
        break;
      }

      case 'resources/read': {
        const resource = session.resources.find((r: any) => r.definition.uri === params.uri);

        if (!resource) {
          res.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Resource not found: ${params.uri}`
            }
          });
          return;
        }

        try {
          const content = await resource.handler();

          const response = {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [{
                uri: params.uri,
                mimeType: resource.definition.mimeType || 'application/json',
                text: content
              }]
            }
          };

          logger.info('Resource read result:', response);
          res.json(response);
        } catch (error: any) {
          logger.error('Resource read error:', error);
          res.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: error.message || 'Resource read failed'
            }
          });
        }
        break;
      }

      default: {
        res.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        });
      }
    }
  } catch (error) {
    logger.error('ChatGPT MCP handler error:', error);

    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
}