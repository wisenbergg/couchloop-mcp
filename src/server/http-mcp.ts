/**
 * HTTP MCP Handler
 * Implements MCP protocol over HTTP POST for all clients (ChatGPT, Claude Desktop, etc.)
 * Used by any client connecting to https://mcp.couchloop.com/mcp
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { setupTools } from '../tools/index.js';
import { setupResources } from '../resources/index.js';

// Store sessions by ID
const sessions = new Map<string, any>();

// Prompts definition
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
  },
  {
    name: 'security-audit',
    description: 'Comprehensive security scan of code for vulnerabilities',
    arguments: [
      { name: 'code', description: 'The code to audit', required: true },
      { name: 'language', description: 'Programming language', required: false }
    ]
  },
  {
    name: 'pre-commit-check',
    description: 'Full code quality check before committing - security, smells, and review',
    arguments: [
      { name: 'code', description: 'The code to check', required: true },
      { name: 'language', description: 'Programming language', required: false }
    ]
  },
  {
    name: 'check-outdated-deps',
    description: 'Find outdated or deprecated dependencies in your project',
    arguments: [
      { name: 'packages', description: 'Comma-separated list of packages to check', required: true },
      { name: 'registry', description: 'Package registry (npm, pypi, maven)', required: false }
    ]
  },
  {
    name: 'save-architecture',
    description: 'Store current architecture decisions and technical patterns for future reference',
    arguments: [
      { name: 'content', description: 'Architecture decision or pattern to preserve', required: true },
      { name: 'category', description: 'Category: architecture, requirements, constraints, decisions, technical-patterns', required: false }
    ]
  },
  {
    name: 'retrieve-context',
    description: 'Retrieve stored context - either recent context or search for specific topic',
    arguments: [
      { name: 'search_term', description: 'Optional search term (e.g., "email persistence issue")', required: false },
      { name: 'category', description: 'Filter by category: architecture, requirements, constraints, decisions, technical-patterns', required: false }
    ]
  }
];

// Cache tool and resource definitions at module level for performance
// These are static and don't change, so we only need to load them once
let cachedTools: any[] | null = null;
let cachedResources: any[] | null = null;

/**
 * Get cached tools or load them once
 */
async function getCachedTools() {
  if (!cachedTools) {
    logger.info('Loading tool definitions (one-time initialization)');
    cachedTools = await setupTools();
  }
  return cachedTools;
}

/**
 * Get cached resources or load them once
 */
async function getCachedResources() {
  if (!cachedResources) {
    logger.info('Loading resource definitions (one-time initialization)');
    cachedResources = await setupResources();
  }
  return cachedResources;
}

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
      // Use cached tools and resources for performance (saves ~30ms per request)
      sessions.set(sessionId, {
        tools: await getCachedTools(),
        resources: await getCachedResources(),
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
              },
              prompts: {}
            },
            serverInfo: {
              name: 'couchloop-mcp',
              version: '1.1.3'
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
          // Extract stable identifiers from ChatGPT metadata
          const openaiSession = params._meta?.['openai/session'];
          const openaiSubject = params._meta?.['openai/subject'];

          // Inject auth context using OpenAI's stable identifiers
          const enhancedArguments = {
            ...params.arguments,
            auth: params.arguments?.auth || {
              client_id: 'chatgpt',
              conversation_id: openaiSession || sessionId,  // Use OpenAI session as conversation ID
              user_id: openaiSubject  // Use OpenAI subject as stable user ID (priority 1 in auth hierarchy)
            }
          };

          logger.info('Enhanced arguments with auth:', {
            hasAuth: !!enhancedArguments.auth,
            authUserId: enhancedArguments.auth?.user_id,
            authConversationId: enhancedArguments.auth?.conversation_id,
            toolName: params.name
          });

          const result = await tool.handler(enhancedArguments);

          // Wrap the result in MCP content format
          const response = {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            }
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

      case 'prompts/list': {
        const response = {
          jsonrpc: '2.0',
          id,
          result: {
            prompts
          }
        };

        logger.info('Sending prompts list:', response);
        res.json(response);
        break;
      }

      case 'prompts/get': {
        const prompt = prompts.find(p => p.name === params.name);

        if (!prompt) {
          res.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Prompt not found: ${params.name}`
            }
          });
          return;
        }

        const args = params.arguments || {};
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

          case 'security-audit':
            messages = [{
              role: 'user',
              content: {
                type: 'text',
                text: `Perform a comprehensive security audit on this code:\n\n\`\`\`${args.language || ''}\n${args.code}\n\`\`\`\n\nUse scan_security with scanType "thorough" to detect SQL injection, XSS, hardcoded secrets, and other vulnerabilities.`
              }
            }];
            break;

          case 'pre-commit-check':
            messages = [{
              role: 'user',
              content: {
                type: 'text',
                text: `Run a full pre-commit quality check on this code:\n\n\`\`\`${args.language || ''}\n${args.code}\n\`\`\`\n\nUse all three tools:\n1. scan_security - check for vulnerabilities\n2. pre_review_code - catch console.logs, TODOs, missing error handling\n3. detect_code_smell - find over-engineering and bloat\n\nProvide a summary of issues found.`
              }
            }];
            break;

          case 'check-outdated-deps':
            messages = [{
              role: 'user',
              content: {
                type: 'text',
                text: `Check these packages for outdated versions and deprecated APIs: ${args.packages}${args.registry ? ` (registry: ${args.registry})` : ''}\n\nUse check_versions tool with checkDeprecated=true and includeUpgradePath=true to identify outdated dependencies and migration paths.`
              }
            }];
            break;

          case 'save-architecture':
            messages = [{
              role: 'user',
              content: {
                type: 'text',
                text: `Save this architecture decision for future reference:\n\n${args.content}\n\nUse preserve_context with action "store" and category "${args.category || 'architecture'}" to preserve this context.`
              }
            }];
            break;

          case 'retrieve-context':
            messages = [{
              role: 'user',
              content: {
                type: 'text',
                text: args.search_term 
                  ? `Retrieve stored context matching: "${args.search_term}"${args.category ? ` in category "${args.category}"` : ''}.\n\nUse preserve_context with action "retrieve" and search_term "${args.search_term}".`
                  : `Retrieve recent stored context${args.category ? ` from category "${args.category}"` : ''}.\n\nUse preserve_context with action "retrieve" to get the most recent context.`
              }
            }];
            break;
        }

        const response = {
          jsonrpc: '2.0',
          id,
          result: {
            description: prompt.description,
            messages
          }
        };

        logger.info('Sending prompt:', response);
        res.json(response);
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