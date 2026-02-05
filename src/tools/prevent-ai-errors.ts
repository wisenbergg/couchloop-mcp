/**
 * MCP Tool: prevent_ai_errors
 * 
 * Intercepts and prevents common AI coding errors before they cause problems.
 * Catches hallucinated packages, build context issues, deprecated patterns, and more.
 */

import { z } from 'zod';
import { AIErrorPreventer } from '../developer/evaluators/ai-error-preventer.js';
import { logger } from '../utils/logger.js';

const PreventAIErrorsInputSchema = z.object({
  code: z.string().describe('Code to analyze for AI errors'),
  language: z.string().default('typescript').describe('Programming language'),
  auto_fix: z.boolean().default(false).describe('Attempt to auto-fix detected issues'),
  check_build_context: z.boolean().default(true).describe('Detect and respect build context'),
  patterns: z.array(z.string()).optional().describe('Specific error patterns to check (all if not specified)'),
});

export const preventAIErrorsTool = {
  name: 'prevent_ai_errors',
  description: 'Intercepts and prevents common AI coding errors: hallucinated packages, incorrect imports, deprecated APIs, build context blindness, and more. Run this on any AI-generated code before using it.',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code to analyze for AI errors',
      },
      language: {
        type: 'string',
        description: 'Programming language (default: typescript)',
      },
      auto_fix: {
        type: 'boolean',
        description: 'Attempt to auto-fix detected issues (default: false)',
      },
      check_build_context: {
        type: 'boolean',
        description: 'Detect and respect build context (default: true)',
      },
      patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific error patterns to check (all if not specified)',
      },
    },
    required: ['code'],
  },
};

export async function handlePreventAIErrors(args: unknown) {
  try {
    const input = PreventAIErrorsInputSchema.parse(args);
    
    logger.info('Running AI error prevention check');
    
    const preventer = new AIErrorPreventer();
    const result = await preventer.preventErrors(input.code, input.language, {
      autoFix: input.auto_fix,
      checkBuildContext: input.check_build_context,
      patterns: input.patterns,
    });

    return {
      success: true,
      errors_found: result.errors.length,
      errors: result.errors.map(e => ({
        id: e.pattern.id,
        name: e.pattern.name,
        impact: e.pattern.impact,
        category: e.pattern.category,
        description: e.pattern.description,
        locations: e.locations,
        suggestion: e.suggestion,
        fixed: e.fixed,
      })),
      warnings: result.warnings,
      prevented_errors: result.preventedErrors,
      build_context: result.buildContext ? {
        language: result.buildContext.language,
        module_system: result.buildContext.moduleSystem,
        package_manager: result.buildContext.packageManager,
        requires_js_extensions: result.buildContext.requiresJsExtensions,
        ai_guidance: result.buildContext.aiGuidance,
      } : null,
      fixed: result.fixed,
      fixed_code: result.fixedCode,
    };
  } catch (error) {
    logger.error('Error in prevent_ai_errors:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
