/**
 * Streamable HTTP Transport for MCP Server
 * Enables ChatGPT to connect via SSE and HTTP
 */
import { Server } from "@modelcontextprotocol/sdk/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequest,
    CallToolRequestSchema,
    GetPromptRequest,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequest,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import { Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import { setupResources } from "../resources/index.js";
import { setupTools } from "../tools/index.js";
import { logger } from "../utils/logger.js";

// Store active transports and servers by session ID
interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastActivity: number;
}

const activeSessions = new Map<string, SessionEntry>();
const SESSION_TTL_MS: number = parseInt(
  process.env.SESSION_TTL_MS || "1800000",
); // 30 minutes

/**
 * Create and configure an MCP server instance
 */
async function createMCPServer(): Promise<Server> {
  // Create MCP server instance
  const server = new Server(
    {
      name: "couchloop-mcp",
      version: "1.3.1",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        experimental: {}, // Support experimental features for ChatGPT
      },
    },
  );

  // Set up tools and resources
  const tools = await setupTools();
  const resources = await setupResources();

  // Set up tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.definition),
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const tool = tools.find((t) => t.definition.name === request.params.name);
      if (!tool) {
        throw new Error(`Tool not found: ${request.params.name}`);
      }
      const result = await tool.handler(request.params.arguments || {});
      return result as { content: Array<{ type: string; text: string }> };
    },
  );

  // Set up resource handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => r.definition),
  }));

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request: ReadResourceRequest) => {
      const resource = resources.find(
        (r) => r.definition.uri === request.params.uri,
      );
      if (!resource) {
        throw new Error(`Resource not found: ${request.params.uri}`);
      }
      const content = await resource.handler();
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: resource.definition.mimeType || "application/json",
            text: content,
          },
        ],
      };
    },
  );

  // Set up prompt handlers
  const prompts = [
    {
      name: "daily-reflection",
      description:
        "Start a guided daily reflection session to process your day",
      arguments: [
        {
          name: "mood",
          description: "Your current mood (optional)",
          required: false,
        },
      ],
    },
    {
      name: "code-review",
      description:
        "Review code for security issues, code smells, and best practices",
      arguments: [
        { name: "code", description: "The code to review", required: true },
        {
          name: "language",
          description: "Programming language",
          required: false,
        },
      ],
    },
    {
      name: "validate-dependencies",
      description:
        "Validate package dependencies for hallucinated or vulnerable packages",
      arguments: [
        {
          name: "packages",
          description: "Comma-separated list of packages to validate",
          required: true,
        },
      ],
    },
    {
      name: "sprint-kickoff",
      description:
        "Start a new sprint session to capture context and decisions",
      arguments: [
        {
          name: "sprint_name",
          description: "Name or identifier for the sprint",
          required: true,
        },
      ],
    },
    {
      name: "security-audit",
      description: "Comprehensive security scan of code for vulnerabilities",
      arguments: [
        { name: "code", description: "The code to audit", required: true },
        {
          name: "language",
          description: "Programming language",
          required: false,
        },
      ],
    },
    {
      name: "pre-commit-check",
      description:
        "Full code quality check before committing - security, smells, and review",
      arguments: [
        { name: "code", description: "The code to check", required: true },
        {
          name: "language",
          description: "Programming language",
          required: false,
        },
      ],
    },
    {
      name: "check-outdated-deps",
      description: "Find outdated or deprecated dependencies in your project",
      arguments: [
        {
          name: "packages",
          description: "Comma-separated list of packages to check",
          required: true,
        },
        {
          name: "registry",
          description: "Package registry (npm, pypi, maven)",
          required: false,
        },
      ],
    },
    {
      name: "save-architecture",
      description:
        "Store current architecture decisions and technical patterns for future reference",
      arguments: [
        {
          name: "content",
          description: "Architecture decision or pattern to preserve",
          required: true,
        },
        {
          name: "category",
          description:
            "Category: architecture, requirements, constraints, decisions, technical-patterns",
          required: false,
        },
      ],
    },
    {
      name: "retrieve-context",
      description:
        "Retrieve stored context - either recent context or search for specific topic",
      arguments: [
        {
          name: "search_term",
          description: 'Optional search term (e.g., "email persistence issue")',
          required: false,
        },
        {
          name: "category",
          description:
            "Filter by category: architecture, requirements, constraints, decisions, technical-patterns",
          required: false,
        },
      ],
    },
  ];

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts,
  }));

  server.setRequestHandler(
    GetPromptRequestSchema,
    async (request: GetPromptRequest) => {
      const prompt = prompts.find((p) => p.name === request.params.name);
      if (!prompt) {
        throw new Error(`Prompt not found: ${request.params.name}`);
      }

      const args = request.params.arguments || {};

      // Generate prompt messages based on the prompt type
      let messages: Array<{
        role: string;
        content: { type: string; text: string };
      }> = [];

      switch (prompt.name) {
        case "daily-reflection":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Start a daily reflection session${args.mood ? ` (current mood: ${args.mood})` : ""}. Use the create_session tool with journey_slug "daily-reflection".`,
              },
            },
          ];
          break;

        case "code-review":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Review this code for issues:\n\n\`\`\`${args.language || ""}\n${args.code}\n\`\`\`\n\nUse scan_security, pre_review_code, and detect_code_smell tools to analyze.`,
              },
            },
          ];
          break;

        case "validate-dependencies":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Validate these packages: ${args.packages}\n\nUse the validate_packages tool to check if they exist and are safe.`,
              },
            },
          ];
          break;

        case "sprint-kickoff":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Start a new sprint session for "${args.sprint_name}". Use create_session to establish context, then use preserve_context to store the sprint goals.`,
              },
            },
          ];
          break;

        case "security-audit":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Perform a comprehensive security audit on this code:\n\n\`\`\`${args.language || ""}\n${args.code}\n\`\`\`\n\nUse scan_security with scanType "thorough" to detect SQL injection, XSS, hardcoded secrets, and other vulnerabilities.`,
              },
            },
          ];
          break;

        case "pre-commit-check":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Run a full pre-commit quality check on this code:\n\n\`\`\`${args.language || ""}\n${args.code}\n\`\`\`\n\nUse all three tools:\n1. scan_security - check for vulnerabilities\n2. pre_review_code - catch console.logs, TODOs, missing error handling\n3. detect_code_smell - find over-engineering and bloat\n\nProvide a summary of issues found.`,
              },
            },
          ];
          break;

        case "check-outdated-deps":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Check these packages for outdated versions and deprecated APIs: ${args.packages}${args.registry ? ` (registry: ${args.registry})` : ""}\n\nUse check_versions tool with checkDeprecated=true and includeUpgradePath=true to identify outdated dependencies and migration paths.`,
              },
            },
          ];
          break;

        case "save-architecture":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Save this architecture decision for future reference:\n\n${args.content}\n\nUse preserve_context with action "store" and category "${args.category || "architecture"}" to preserve this context.`,
              },
            },
          ];
          break;

        case "retrieve-context":
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: args.search_term
                  ? `Retrieve stored context matching: "${args.search_term}"${args.category ? ` in category "${args.category}"` : ""}.\n\nUse preserve_context with action "retrieve" and search_term "${args.search_term}".`
                  : `Retrieve recent stored context${args.category ? ` from category "${args.category}"` : ""}.\n\nUse preserve_context with action "retrieve" to get the most recent context.`,
              },
            },
          ];
          break;
      }

      return {
        description: prompt.description,
        messages,
      };
    },
  );

  return server;
}

/**
 * Handle SSE/HTTP requests for ChatGPT MCP connection
 * This endpoint handles both GET (SSE) and POST (HTTP) requests
 */
export async function handleSSE(req: Request, res: Response) {
  try {
    // Get or generate session ID
    let sessionId = req.headers["x-session-id"] as string;

    // Check if this is an existing session
    let session = activeSessions.get(sessionId);

    if (!session) {
      // Create new session
      sessionId =
        sessionId || `session_${crypto.randomBytes(16).toString("hex")}`;

      // Create transport with stateful mode (session management)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });

      // Create and configure server
      const server = await createMCPServer();

      // Connect transport to server
      await server.connect(transport);

      // Store session
      session = { transport, server, lastActivity: Date.now() };
      activeSessions.set(sessionId, session);

      logger.info(`New MCP session created: ${sessionId}`);
    }

    // Update activity timestamp
    session.lastActivity = Date.now();

    // Handle the request through the transport
    await session.transport.handleRequest(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      req.body,
    );
  } catch (error) {
    logger.error("SSE/HTTP handler error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: req.body?.id || null,
      });
    }
  }
}

/**
 * Handle lenient MCP requests for ChatGPT compatibility
 * This endpoint is more forgiving with Accept headers
 */
export async function handleMCPLenient(req: Request, res: Response) {
  logger.debug("handleMCPLenient called", {
    method: req.method,
    sessionId: req.headers["x-session-id"],
  });

  try {
    // Log incoming headers for debugging
    logger.info("MCP Request Headers:", {
      accept: req.headers.accept,
      "content-type": req.headers["content-type"],
      "user-agent": req.headers["user-agent"],
      "x-session-id": req.headers["x-session-id"],
    });

    // Normalize Accept header for compatibility
    const originalAccept = req.headers.accept || "";
    if (
      originalAccept === "*/*" ||
      originalAccept === "application/json" ||
      originalAccept === "application/*" ||
      !originalAccept
    ) {
      // Set the required Accept header for MCP
      req.headers.accept = "application/json, text/event-stream";
      logger.info(
        `Normalized Accept header from "${originalAccept}" to "${req.headers.accept}"`,
      );
    }

    // Get or generate session ID
    let sessionId = req.headers["x-session-id"] as string;

    // Check if this is an existing session
    let session = activeSessions.get(sessionId);

    if (!session) {
      // Create new session
      sessionId =
        sessionId || `session_${crypto.randomBytes(16).toString("hex")}`;

      // Create transport with lenient options
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        // Enable JSON-only responses for better compatibility
        enableJsonResponse: true,
      } as { sessionIdGenerator: () => string; enableJsonResponse?: boolean });

      // Create and configure server
      const server = await createMCPServer();

      // Connect transport to server
      await server.connect(transport);

      // Store session
      session = { transport, server, lastActivity: Date.now() };
      activeSessions.set(sessionId, session);

      logger.info(`New lenient MCP session created: ${sessionId}`);
    }

    // Update activity timestamp
    session.lastActivity = Date.now();

    // Log request details
    if (req.body) {
      logger.info("MCP Request:", {
        method: req.body.method,
        id: req.body.id,
        params: req.body.params,
      });
    }

    // Handle the request through the transport
    // Create a modified request object with normalized headers
    const modifiedReq = Object.assign({}, req, {
      headers: Object.assign({}, req.headers),
    });
    await session.transport.handleRequest(
      modifiedReq as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      req.body,
    );
  } catch (error) {
    logger.error("Lenient MCP handler error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: req.body?.id || null,
      });
    }
  }
}

/**
 * Clean up inactive sessions periodically
 */
function cleanupExpiredSessions(): void {
  const now: number = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      try {
        session.transport.close();
      } catch (error) {
        logger.error(`Error closing expired session ${sessionId}:`, error);
      }
      activeSessions.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(
      `Cleaned up ${cleaned} expired sessions. Active: ${activeSessions.size}`,
    );
  }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

/**
 * Graceful shutdown - clean up all sessions
 */
export async function cleanupSessions() {
  logger.info("Cleaning up MCP sessions...");

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
