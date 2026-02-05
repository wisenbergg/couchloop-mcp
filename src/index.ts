#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { setupTools } from './tools/index.js';
import { setupResources } from './resources/index.js';
import { logger } from './utils/logger.js';
import { initDatabase, getDb } from './db/client.js';
import { governancePreCheck, governancePostCheck } from './governance/middleware.js';
import { governanceAuditLog } from './db/schema.js';

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
          prompts: {},
        },
      }
    );

    // Set up tools
    const tools = await setupTools();

    // Set up tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map(t => t.definition)
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const toolName = request.params.name;
      const args = request.params.arguments || {};
      
      const tool = tools.find(t => t.definition.name === toolName);
      if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
      }

      // ═══════════════════════════════════════════════
      // GOVERNANCE PRE-CHECK
      // ═══════════════════════════════════════════════
      const preCheck = await governancePreCheck(toolName, args);
      
      if (!preCheck.allowed) {
        logger.warn(`[Governance] BLOCKED ${toolName}:`, preCheck.issues);
        
        // Log to audit
        try {
          const db = getDb();
          await db.insert(governanceAuditLog).values({
            actionType: 'pre_check_block',
            reason: preCheck.issues.join('; '),
            confidenceScore: Math.round(preCheck.confidence * 100),
            metadata: {
              tool: toolName,
              issues: preCheck.issues,
              blocked: true,
            },
          });
        } catch (auditError) {
          logger.warn('Failed to log governance audit:', auditError);
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              blocked: true,
              reason: 'Governance pre-check failed',
              issues: preCheck.issues,
              confidence: preCheck.confidence,
            }, null, 2)
          }]
        };
      }

      // ═══════════════════════════════════════════════
      // EXECUTE TOOL
      // ═══════════════════════════════════════════════
      const result = await tool.handler(args);

      // ═══════════════════════════════════════════════
      // GOVERNANCE POST-CHECK
      // ═══════════════════════════════════════════════
      const postCheck = await governancePostCheck(toolName, result);
      
      if (postCheck.issues.length > 0) {
        logger.info(`[Governance] Issues detected in ${toolName} output:`, postCheck.issues);
        
        // Log to audit (but don't block - shadow mode)
        try {
          const db = getDb();
          await db.insert(governanceAuditLog).values({
            actionType: 'post_check_warning',
            reason: postCheck.issues.join('; '),
            confidenceScore: Math.round(postCheck.confidence * 100),
            metadata: {
              tool: toolName,
              issues: postCheck.issues,
              blocked: false,
            },
          });
        } catch (auditError) {
          logger.warn('Failed to log governance audit:', auditError);
        }
      }

      // Add governance metadata to response
      const governedResult = {
        ...(typeof result === 'object' && result !== null ? result : { value: result }),
        _governance: {
          checked: true,
          issues: postCheck.issues,
          confidence: postCheck.confidence,
        }
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(governedResult, null, 2) }]
      };
    });

    logger.info('Tools registered');

    // Set up resources
    const resources = await setupResources();

    // Set up resource handlers
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resources.map(r => r.definition)
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
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

    // Set up prompts
    const prompts = [
      {
        name: 'daily-reflection',
        description: 'Start a guided daily reflection session to process your day',
        arguments: [
          { name: 'mood', description: 'Your current mood (optional)', required: false }
        ]
      },
      {
        name: 'code-review',
        description: 'Review code for security issues, code smells, and best practices',
        arguments: [
          { name: 'code', description: 'The code to review', required: true },
          { name: 'language', description: 'Programming language', required: false }
        ]
      },
      {
        name: 'validate-dependencies',
        description: 'Validate package dependencies for hallucinated or vulnerable packages',
        arguments: [
          { name: 'packages', description: 'Comma-separated list of packages to validate', required: true }
        ]
      },
      {
        name: 'sprint-kickoff',
        description: 'Start a new sprint session to capture context and decisions',
        arguments: [
          { name: 'sprint_name', description: 'Name or identifier for the sprint', required: true }
        ]
      }
    ];

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (request: { params: { name: string; arguments?: Record<string, string> } }) => {
      const prompt = prompts.find(p => p.name === request.params.name);
      if (!prompt) {
        throw new Error(`Prompt not found: ${request.params.name}`);
      }

      const args = request.params.arguments || {};
      let messages: Array<{ role: string; content: { type: string; text: string } }> = [];

      switch (prompt.name) {
        case 'daily-reflection':
          messages = [{
            role: 'user',
            content: {
              type: 'text',
              text: `Start a daily reflection session${args.mood ? ` (current mood: ${args.mood})` : ''}. Use the create_session tool with journey_slug "daily-reflection".`
            }
          }];
          break;

        case 'code-review':
          messages = [{
            role: 'user',
            content: {
              type: 'text',
              text: `Review this code for issues:\n\n\`\`\`${args.language || ''}\n${args.code}\n\`\`\`\n\nUse scan_security, pre_review_code, and detect_code_smell tools to analyze.`
            }
          }];
          break;

        case 'validate-dependencies':
          messages = [{
            role: 'user',
            content: {
              type: 'text',
              text: `Validate these packages: ${args.packages}\n\nUse the validate_packages tool to check if they exist and are safe.`
            }
          }];
          break;

        case 'sprint-kickoff':
          messages = [{
            role: 'user',
            content: {
              type: 'text',
              text: `Start a new sprint session for "${args.sprint_name}". Use create_session to establish context, then use preserve_context to store the sprint goals.`
            }
          }];
          break;
      }

      return {
        description: prompt.description,
        messages
      };
    });

    logger.info('Prompts registered');

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