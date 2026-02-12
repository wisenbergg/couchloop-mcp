/**
 * MCP Tool: pre_review_code
 * Pre-screens AI-generated code to reduce human review burden
 * Detects common issues and generates review summaries
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ReviewAssistant, type ScanResult } from '../developer/scanners/review-assistant.js';
import { ReviewSummaryGenerator, formatReviewSummaryAsMarkdown } from '../developer/reports/review-summary.js';
import { logger } from '../utils/logger.js';

const PreReviewCodeInputSchema = z.object({
  code: z.string()
    .min(1, 'Code cannot be empty')
    .describe('The code snippet to review'),
  language: z.string()
    .default('typescript')
    .describe('Programming language (typescript, javascript, python, java, etc.)'),
  strictness: z.enum(['low', 'medium', 'high'])
    .default('medium')
    .describe('Review strictness level'),
  format: z.enum(['json', 'markdown', 'summary'])
    .default('json')
    .describe('Output format for the review')
});

export type PreReviewCodeInput = z.infer<typeof PreReviewCodeInputSchema>;

export const preReviewCodeTool: Tool = {
  name: 'pre_review_code',
  description: 'Pre-screen AI-generated code to catch obvious issues and reduce human review burden. Detects console logs, commented code, TODOs, missing error handling, hardcoded values, type issues, and code complexity problems.',
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
        description: 'The code snippet to review'
      },
      language: {
        type: 'string',
        default: 'typescript',
        description: 'Programming language (typescript, javascript, python, java, etc.)'
      },
      strictness: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        default: 'medium',
        description: 'Review strictness level - affects which issues are flagged'
      },
      format: {
        type: 'string',
        enum: ['json', 'markdown', 'summary'],
        default: 'json',
        description: 'Output format (json for detailed, markdown for formatted, summary for brief)'
      }
    },
    required: ['code']
  }
};

export async function handlePreReviewCode(input: unknown): Promise<object> {
  try {
    const params = PreReviewCodeInputSchema.parse(input);

    logger.debug(`Pre-review scan: ${params.language} (strictness: ${params.strictness})`);

    // Run code scan
    const scanner = new ReviewAssistant(params.code, params.language);
    const scanResult = scanner.scan();

    // Filter issues based on strictness level
    const filteredResult = filterByStrictness(scanResult, params.strictness);

    // Generate summary
    const summaryGenerator = new ReviewSummaryGenerator(filteredResult, params.code.split('\n').length);
    const summary = summaryGenerator.generate();

    logger.debug(`Found ${filteredResult.totalIssues} issues (${filteredResult.issuesBySeverity.high} critical)`);

    // Format output
    if (params.format === 'markdown') {
      return {
        status: 'success',
        format: 'markdown',
        content: formatReviewSummaryAsMarkdown(summary),
        metrics: summary.metrics
      };
    }

    if (params.format === 'summary') {
      return {
        status: 'success',
        format: 'summary',
        executiveSummary: summary.executiveSummary,
        complexityScore: summary.complexityScore,
        estimatedReviewTime: `${summary.estimatedReviewTime} minutes`,
        riskLevel: summary.riskLevel,
        metrics: summary.metrics,
        topIssues: summary.categoryGroups.slice(0, 3).map(group => ({
          category: group.category,
          count: group.count,
          severity: group.severity
        }))
      };
    }

    // Default JSON format
    return {
      status: 'success',
      format: 'json',
      scan: {
        totalIssues: filteredResult.totalIssues,
        issues: filteredResult.issues,
        summary: filteredResult.issuesBySeverity,
        byType: filteredResult.issuesByType
      },
      review: {
        executiveSummary: summary.executiveSummary,
        complexityScore: summary.complexityScore,
        estimatedReviewTime: `${summary.estimatedReviewTime} minutes`,
        riskLevel: summary.riskLevel,
        categoryGroups: summary.categoryGroups,
        actionItems: summary.actionItems
      },
      metrics: summary.metrics
    };

  } catch (error) {
    logger.error('Pre-review scan error:', error);

    if (error instanceof z.ZodError) {
      return {
        status: 'error',
        error: 'Validation error',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      };
    }

    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to perform pre-review scan'
    };
  }
}

function filterByStrictness(scanResult: ScanResult, strictness: 'low' | 'medium' | 'high') {
  let filtered = { ...scanResult };

  if (strictness === 'low') {
    // Only keep critical issues
    filtered.issues = scanResult.issues.filter((issue) => issue.severity === 'high');
  } else if (strictness === 'medium') {
    // Keep all issues (default)
    filtered.issues = scanResult.issues;
  }
  // 'high' strictness keeps everything

  // Recompile summary
  const issuesByType: Record<string, number> = {};
  const issuesBySeverity: Record<string, number> = { low: 0, medium: 0, high: 0 };

  filtered.issues.forEach((issue) => {
    issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
    issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] ?? 0) + 1;
  });

  filtered.issuesByType = issuesByType;
  (filtered as Record<string, unknown>).issuesBySeverity = issuesBySeverity;
  filtered.totalIssues = filtered.issues.length;

  return filtered;
}

export function createPreReviewCodeTool() {
  return {
    definition: preReviewCodeTool,
    handler: handlePreReviewCode
  };
}
