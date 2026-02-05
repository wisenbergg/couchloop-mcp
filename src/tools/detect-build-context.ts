/**
 * MCP Tool: detect_build_context
 * 
 * Detects project configuration to prevent AI agents from making incorrect assumptions.
 * Prevents "Build Context Blindness" - when AI generates code incompatible with the project setup.
 */

import { z } from 'zod';
import { BuildContextDetector } from '../developer/evaluators/build-context-detector.js';
import { logger } from '../utils/logger.js';

const DetectBuildContextInputSchema = z.object({
  project_root: z.string().optional().describe('Project root path (default: current directory)'),
});

export const detectBuildContextTool = {
  name: 'detect_build_context',
  description: 'Detects project build context (module system, TypeScript config, package manager, etc.) to ensure AI-generated code is compatible. Prevents common errors like wrong import syntax, missing extensions, or incompatible APIs.',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      project_root: {
        type: 'string',
        description: 'Project root path (default: current directory)',
      },
    },
    required: [],
  },
};

export async function handleDetectBuildContext(args: unknown) {
  try {
    const input = DetectBuildContextInputSchema.parse(args);
    
    logger.info('Detecting build context');
    
    const detector = new BuildContextDetector(input.project_root);
    const context = await detector.detect();

    return {
      success: true,
      context: {
        language: context.language,
        module_system: context.moduleSystem,
        package_manager: context.packageManager,
        build_tool: context.buildTool,
        typescript_config: context.tsConfig,
        python_version: context.pythonVersion,
        node_version: context.nodeVersion,
        has_typescript: context.hasTypeScript,
        requires_js_extensions: context.requiresJsExtensions,
      },
      errors: context.errors,
      warnings: context.warnings,
      ai_guidance: context.aiGuidance,
      summary: generateSummary(context),
    };
  } catch (error) {
    logger.error('Error in detect_build_context:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function generateSummary(context: { language: string; moduleSystem?: string; hasTypeScript: boolean; requiresJsExtensions: boolean; aiGuidance: string[] }): string {
  const parts: string[] = [];
  
  parts.push(`Language: ${context.language}`);
  if (context.moduleSystem) parts.push(`Module System: ${context.moduleSystem.toUpperCase()}`);
  if (context.hasTypeScript) parts.push('TypeScript: Yes');
  if (context.requiresJsExtensions) parts.push('⚠️ Requires .js extensions in imports');
  
  if (context.aiGuidance.length > 0) {
    parts.push('\nAI Guidance:');
    context.aiGuidance.forEach(g => parts.push(`  - ${g}`));
  }
  
  return parts.join('\n');
}
