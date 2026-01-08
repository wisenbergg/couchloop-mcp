#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { setupTools } from './tools/index.js';
import { setupResources } from './resources/index.js';
import { logger } from './utils/logger.js';
import { initDatabase } from './db/client.js';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize server
async function main() {
  try {
    logger.info('Starting CouchLoop MCP Server...');

    // Initialize database connection
    await initDatabase();
    logger.info('Database connection established');

    // Create MCP server instance
    const server = new Server(
      {
        name: 'couchloop-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Set up tools
    const tools = await setupTools();

    // Set up tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map(t => t.definition)
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const tool = tools.find(t => t.definition.name === request.params.name);
      if (!tool) {
        throw new Error(`Tool ${request.params.name} not found`);
      }

      const result = await tool.handler(request.params.arguments || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    });

    logger.info('Tools registered');

    // Set up resources
    const resources = await setupResources();

    // Set up resource handlers
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resources.map(r => r.definition)
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
      const resource = resources.find(r => r.definition.uri === request.params.uri);
      if (!resource) {
        throw new Error(`Resource ${request.params.uri} not found`);
      }

      const contents = await resource.handler();
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: 'application/json',
          text: contents
        }]
      };
    });

    logger.info('Resources registered');

    // Start the server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('CouchLoop MCP Server is running');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down server...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down server...');
      await server.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});