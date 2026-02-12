/**
 * MCP Tool: comprehensive_code_review
 * 
 * One-stop code review that bundles ALL code analysis tools:
 * - Security scanning (SQL injection, XSS, secrets, eval)
 * - Code quality (console.logs, TODOs, error handling)
 * - Code smell detection (complexity, bloat, over-engineering)
 * - AI error prevention (hallucinated APIs, build context issues)
 * 
 * User just says "review this code" and gets everything.
 */

import { z } from 'zod';
import { handleScanSecurity } from './scan-security.js';
import { handlePreReviewCode } from './pre-review-code.js';
import { handleDetectCodeSmell } from './detect-code-smell.js';
import { handlePreventAIErrors } from './prevent-ai-errors.js';
import { logger } from '../utils/logger.js';
import { sanitizeCode } from '../utils/inputSanitize.js';

const ComprehensiveCodeReviewInputSchema = z.object({
  code: z.string().describe('Code to review'),
  language: z.string().default('typescript').describe('Programming language'),
  context: z.string().optional().describe('Additional context about the code'),
  auto_fix: z.boolean().default(false).describe('Attempt to auto-fix issues'),
  focus: z.array(z.enum(['security', 'quality', 'smell', 'ai-errors'])).optional()
    .describe('Focus areas (all if not specified)'),
});

export const comprehensiveCodeReviewTool = {
  name: 'comprehensive_code_review',
  description: 'Complete code review in one call: security vulnerabilities, code quality issues, code smells, and AI-generated errors. Just provide the code - no need to call multiple tools.',
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
        description: 'Code to review',
      },
      language: {
        type: 'string',
        description: 'Programming language (default: typescript)',
      },
      context: {
        type: 'string',
        description: 'Additional context about the code',
      },
      auto_fix: {
        type: 'boolean',
        description: 'Attempt to auto-fix issues (default: false)',
      },
      focus: {
        type: 'array',
        items: { type: 'string', enum: ['security', 'quality', 'smell', 'ai-errors'] },
        description: 'Focus areas (all if not specified)',
      },
    },
    required: ['code'],
  },
};

export async function handleComprehensiveCodeReview(args: unknown) {
  try {
    const input = ComprehensiveCodeReviewInputSchema.parse(args);
    // Defense-in-depth: strip null bytes from code input
    const code = sanitizeCode(input.code);
    const focus = input.focus || ['security', 'quality', 'smell', 'ai-errors'];
    
    logger.info('Running comprehensive code review');
    
    const results: Record<string, unknown> = {};
    const allIssues: Array<{ category: string; severity: string; message: string; location?: string }> = [];
    
    // Run all relevant checks in parallel
    const checks = await Promise.allSettled([
      focus.includes('security') ? handleScanSecurity({ code, language: input.language }) : null,
      focus.includes('quality') ? handlePreReviewCode({ code, language: input.language }) : null,
      focus.includes('smell') ? handleDetectCodeSmell({ code, language: input.language }) : null,
      focus.includes('ai-errors') ? handlePreventAIErrors({ 
        code, 
        language: input.language, 
        auto_fix: input.auto_fix,
        check_build_context: true 
      }) : null,
    ]);

    // Process security results
    if (focus.includes('security') && checks[0].status === 'fulfilled' && checks[0].value) {
      const security = checks[0].value as unknown as Record<string, unknown>;
      results.security = security;
      if (Array.isArray(security.vulnerabilities)) {
        security.vulnerabilities.forEach((v: { type: string; severity: string; description: string; line?: number }) => {
          allIssues.push({
            category: 'security',
            severity: v.severity || 'high',
            message: `${v.type}: ${v.description}`,
            location: v.line ? `Line ${v.line}` : undefined,
          });
        });
      }
    }

    // Process quality results
    if (focus.includes('quality') && checks[1].status === 'fulfilled' && checks[1].value) {
      const quality = checks[1].value as Record<string, unknown>;
      results.quality = quality;
      if (Array.isArray(quality.issues)) {
        quality.issues.forEach((i: { type: string; severity: string; message: string; line?: number }) => {
          allIssues.push({
            category: 'quality',
            severity: i.severity || 'medium',
            message: i.message || i.type,
            location: i.line ? `Line ${i.line}` : undefined,
          });
        });
      }
    }

    // Process code smell results
    if (focus.includes('smell') && checks[2].status === 'fulfilled' && checks[2].value) {
      const smell = checks[2].value as Record<string, unknown>;
      results.smell = smell;
      if (Array.isArray(smell.issues)) {
        smell.issues.forEach((i: { type: string; severity: string; message: string }) => {
          allIssues.push({
            category: 'smell',
            severity: i.severity || 'low',
            message: i.message || i.type,
          });
        });
      }
    }

    // Process AI error results
    if (focus.includes('ai-errors') && checks[3].status === 'fulfilled' && checks[3].value) {
      const aiErrors = checks[3].value as Record<string, unknown>;
      results.ai_errors = aiErrors;
      if (Array.isArray(aiErrors.errors)) {
        aiErrors.errors.forEach((e: { name: string; impact: string; description: string }) => {
          allIssues.push({
            category: 'ai-error',
            severity: e.impact || 'high',
            message: `${e.name}: ${e.description}`,
          });
        });
      }
    }

    // Calculate summary
    const criticalCount = allIssues.filter(i => i.severity === 'critical').length;
    const highCount = allIssues.filter(i => i.severity === 'high').length;
    const mediumCount = allIssues.filter(i => i.severity === 'medium' || i.severity === 'low').length;
    
    const overallRisk = criticalCount > 0 ? 'critical' 
      : highCount > 0 ? 'high'
      : mediumCount > 0 ? 'medium'
      : 'low';

    const recommendation = criticalCount > 0 
      ? '🚨 DO NOT USE - Critical issues found. Fix before proceeding.'
      : highCount > 0
      ? '⚠️ CAUTION - High severity issues found. Review and fix recommended.'
      : mediumCount > 0
      ? '📝 Minor issues found. Consider addressing before merge.'
      : '✅ Code looks good!';

    return {
      success: true,
      summary: {
        total_issues: allIssues.length,
        critical: criticalCount,
        high: highCount,
        medium_low: mediumCount,
        overall_risk: overallRisk,
        recommendation,
      },
      issues: allIssues,
      details: results,
      checks_performed: focus,
    };
  } catch (error) {
    logger.error('Error in comprehensive_code_review:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
