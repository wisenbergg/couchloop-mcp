/**
 * Example: MCP Server with Governance Middleware
 * 
 * This shows how to wrap tool handlers with automatic governance checks.
 * 
 * Usage:
 * 1. Import withGovernance from governance/middleware
 * 2. Wrap tool handlers when registering them
 * 3. Configure enforcement mode (shadow/enforce/log-only)
 */

import { Server } from '@modelcontextprotocol/sdk/server';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { withGovernance, governancePreCheck, governancePostCheck } from '../governance/middleware.js';
import { logger } from '../utils/logger.js';

interface ToolDefinition {
  definition: { name: string };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Option A: Wrap individual tool handlers
 */
function setupToolsWithGovernance(tools: ToolDefinition[]) {
  return tools.map(tool => ({
    ...tool,
    handler: withGovernance(tool.definition.name, tool.handler)
  }));
}

interface CallToolRequest {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

/**
 * Option B: Add governance to the CallToolRequest handler (centralized)
 */
function setupGovernedToolHandler(server: Server, tools: ToolDefinition[]) {
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
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
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            blocked: true,
            reason: 'Governance check failed',
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
    
    // In shadow mode, log but don't block
    if (postCheck.issues.length > 0) {
      logger.info(`[Governance] Issues detected in ${toolName} output:`, postCheck.issues);
    }

    // Add governance metadata to response
    const governedResult = {
      ...(result as Record<string, unknown>),
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
}

/**
 * Option C: MCP Sampling for AI-based governance
 * 
 * This uses MCP's sampling capability to have Claude evaluate responses.
 * Requires client support for sampling/createMessage.
 */
async function aiGovernanceCheck(
  _server: Server,
  content: string,
  context: string
): Promise<{ safe: boolean; concerns: string[] }> {
  // MCP sampling request - asks the client to run an LLM inference
  const samplingRequest = {
    method: 'sampling/createMessage',
    params: {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Evaluate this AI-generated response for safety concerns.
            
Context: ${context}

Response to evaluate:
${content}

Reply with JSON: { "safe": boolean, "concerns": string[] }
Only flag genuine safety issues, not style preferences.`
          }
        }
      ],
      maxTokens: 200,
      temperature: 0.1, // Low temp for consistent evaluation
    }
  };
  
  // This would be sent via server.request() if sampling is supported
  // For now, return a placeholder
  void samplingRequest; // Suppress unused variable warning (example code)
  void content;
  void context;
  return { safe: true, concerns: [] };
}

export { setupToolsWithGovernance, setupGovernedToolHandler, aiGovernanceCheck };
