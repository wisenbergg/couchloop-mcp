/**
 * MCP Tool: detect_code_smell
 * Analyzes code for bloat, verbose patterns, and over-engineering
 * Returns actionable suggestions to prevent technical debt
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BloatDetector, type BloatDetectionResult, type CodeSmellWarning } from '../developer/analyzers/bloat-detector.js';
import type { ComplexityMetrics } from '../developer/metrics/complexity-calculator.js';
import { logger } from '../utils/logger.js';

const inputSchema = z.object({
  code: z.string().describe('Code snippet to analyze for bloat patterns'),
  language: z.enum(['javascript', 'typescript', 'python']).default('javascript').describe('Programming language'),
  threshold: z.number().optional().describe('Complexity threshold (0-100, default: 50)'),
  includeMetrics: z.boolean().default(true).describe('Include detailed complexity metrics'),
  includeSuggestions: z.boolean().default(true).describe('Include refactoring suggestions')
});

export const detectCodeSmellTool: Tool = {
  name: 'detect_code_smell',
  description: 'Detect code bloat, verbose patterns, and over-engineered code that creates technical debt. Analyzes complexity metrics and suggests simplifications.',
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
        description: 'Code snippet to analyze for bloat patterns'
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'python'],
        default: 'javascript',
        description: 'Programming language'
      },
      threshold: {
        type: 'number',
        description: 'Complexity threshold (0-100, default: 50)'
      },
      includeMetrics: {
        type: 'boolean',
        default: true,
        description: 'Include detailed complexity metrics'
      },
      includeSuggestions: {
        type: 'boolean',
        default: true,
        description: 'Include refactoring suggestions'
      }
    },
    required: ['code']
  }
};

export async function handleDetectCodeSmell(input: unknown): Promise<object> {
  try {
    const params = inputSchema.parse(input);
    const detector = new BloatDetector(params.threshold || 50);

    // Analyze code
    const result = detector.analyze(params.code, params.language);

    // Format response
    const response: {
      status: string;
      summary: { totalIssues: number; criticalIssues: number; complexityScore: number; recommendation: string };
      metrics?: Record<string, unknown>;
      issues?: Array<Record<string, unknown>>;
      refactoringPriority?: string[];
      issueBreakdown?: { high: number; medium: number; low: number };
      message?: string;
      analysis?: { complexity: string; keyFindings: string[]; actionItems: Array<{ priority: number; action: string; impact: string }> };
    } = {
      status: result.summary.score > 75 ? 'warning' : result.summary.score > 50 ? 'caution' : 'ok',
      summary: {
        totalIssues: result.summary.totalIssues,
        criticalIssues: result.summary.criticalIssues,
        complexityScore: result.summary.score,
        recommendation: result.summary.recommendation
      }
    };

    // Include metrics if requested
    if (params.includeMetrics) {
      response.metrics = {
        cyclomaticComplexity: result.metrics.cyclomaticComplexity,
        cognitiveComplexity: result.metrics.cognitiveComplexity,
        nestingDepth: result.metrics.nestingDepth,
        linesOfCode: result.metrics.linesOfCode,
        maxFunctionLength: result.metrics.maxFunctionLength,
        averageFunctionLength: result.metrics.averageFunctionLength,
        functionCount: result.metrics.functionCount,
        severity: result.metrics.severity
      };
    }

    // Include issues
    if (result.issues.length > 0) {
      response.issues = result.issues.map(issue => ({
        type: issue.type,
        severity: issue.severity,
        line: issue.line,
        pattern: issue.pattern,
        suggestion: issue.suggestion,
        ...(issue.example && { example: issue.example })
      }));
    }

    // Include refactoring priority
    if (params.includeSuggestions && result.refactoringPriority.length > 0) {
      response.refactoringPriority = result.refactoringPriority;
    }

    // Add severity breakdown
    const highSeverity = result.issues.filter(i => i.severity === 'high').length;
    const mediumSeverity = result.issues.filter(i => i.severity === 'medium').length;
    const lowSeverity = result.issues.filter(i => i.severity === 'low').length;

    response.issueBreakdown = {
      high: highSeverity,
      medium: mediumSeverity,
      low: lowSeverity
    };

    // Create summary message
    let message = '';
    if (result.summary.totalIssues === 0) {
      message = 'Clean code! No significant bloat patterns detected.';
    } else if (result.summary.criticalIssues > 0) {
      message = `Found ${result.summary.totalIssues} issues (${result.summary.criticalIssues} critical). Priority refactoring needed.`;
    } else {
      message = `Found ${result.summary.totalIssues} issues. ${result.summary.recommendation}`;
    }

    response.message = message;

    // Add detailed analysis for educational purposes
    if (params.includeSuggestions) {
      response.analysis = {
        complexity: explainComplexity(result.metrics),
        keyFindings: generateKeyFindings(result.issues),
        actionItems: generateActionItems(result)
      };
    }

    return response;

  } catch (error) {
    logger.error('Code smell detection error:', error);
    return {
      error: error instanceof Error ? error.message : 'Failed to analyze code',
      status: 'error'
    };
  }
}

/**
 * Explain complexity metrics in human terms
 */
function explainComplexity(metrics: ComplexityMetrics): string {
  const parts: string[] = [];

  if (metrics.cyclomaticComplexity > 15) {
    parts.push(`High cyclomatic complexity (${metrics.cyclomaticComplexity}). Code has many decision points.`);
  } else if (metrics.cyclomaticComplexity > 10) {
    parts.push(`Moderate cyclomatic complexity (${metrics.cyclomaticComplexity}). Consider simplifying.`);
  }

  if (metrics.nestingDepth > 5) {
    parts.push(`Deep nesting (${metrics.nestingDepth} levels). Use early returns to flatten structure.`);
  } else if (metrics.nestingDepth > 3) {
    parts.push(`Moderate nesting (${metrics.nestingDepth} levels). Could be reduced.`);
  }

  if (metrics.maxFunctionLength > 100) {
    parts.push(`Function length (${metrics.maxFunctionLength} lines). Consider breaking into smaller functions.`);
  }

  if (metrics.cognitiveComplexity > 20) {
    parts.push(`High cognitive complexity (${metrics.cognitiveComplexity}). Difficult to understand and maintain.`);
  }

  return parts.length > 0
    ? parts.join(' ')
    : `Code complexity is within acceptable ranges (score: ${metrics.score}/100).`;
}

/**
 * Generate key findings summary
 */
function generateKeyFindings(issues: CodeSmellWarning[]): string[] {
  const findings: string[] = [];
  const typeCounts = new Map<string, number>();

  for (const issue of issues) {
    typeCounts.set(issue.type, (typeCounts.get(issue.type) || 0) + 1);
  }

  // Convert to findings
  for (const [type, count] of typeCounts.entries()) {
    if (count === 1) {
      findings.push(`1 instance of ${type.replace(/_/g, ' ')}`);
    } else {
      findings.push(`${count} instances of ${type.replace(/_/g, ' ')}`);
    }
  }

  return findings;
}

/**
 * Generate prioritized action items
 */
function generateActionItems(result: BloatDetectionResult): Array<{ priority: number; action: string; impact: string }> {
  const actions: Array<{ priority: number; action: string; impact: string }> = [];
  let priority = 1;

  // High-priority issues first
  const highIssues = result.issues.filter((i: CodeSmellWarning) => i.severity === 'high');
  for (const issue of highIssues.slice(0, 3)) {
    actions.push({
      priority,
      action: `Fix ${issue.type}: ${issue.suggestion}`,
      impact: 'High impact on maintainability'
    });
    priority++;
  }

  // Medium-priority issues
  const mediumIssues = result.issues.filter((i: CodeSmellWarning) => i.severity === 'medium');
  for (const issue of mediumIssues.slice(0, 2)) {
    actions.push({
      priority,
      action: `Address ${issue.type}: ${issue.suggestion}`,
      impact: 'Improves readability'
    });
    priority++;
  }

  // Refactoring priorities from metrics
  if (result.metrics.cyclomaticComplexity > 15) {
    actions.push({
      priority,
      action: 'Extract complex conditional logic into separate functions',
      impact: 'High - reduces cognitive load and improves testability'
    });
    priority++;
  }

  if (result.metrics.nestingDepth > 5) {
    actions.push({
      priority,
      action: 'Use early returns and extract nested blocks',
      impact: 'High - makes code easier to follow'
    });
    priority++;
  }

  if (result.metrics.maxFunctionLength > 100) {
    actions.push({
      priority,
      action: 'Break oversized functions into smaller, focused units (target: 20-30 lines)',
      impact: 'Medium - improves readability and testability'
    });
  }

  return actions;
}
