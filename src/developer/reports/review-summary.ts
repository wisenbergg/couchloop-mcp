/**
 * Review Summary Generator
 * Generates executive summaries, categorized problem lists, and review complexity estimates
 */

import { CodeIssue, ScanResult } from '../scanners/review-assistant.js';

export interface IssueCategoryGroup {
  category: string;
  severity: 'low' | 'medium' | 'high';
  count: number;
  issues: CodeIssue[];
  fixTime: number; // in minutes
}

export interface ReviewSummary {
  executiveSummary: string;
  categoryGroups: IssueCategoryGroup[];
  complexityScore: number; // 0-100
  estimatedReviewTime: number; // in minutes
  riskLevel: 'low' | 'medium' | 'high';
  actionItems: string[];
  fixableSuggestions: Array<{
    line: number;
    current: string;
    suggested: string;
  }>;
  metrics: {
    totalIssues: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    codeQualityScore: number; // 0-100
  };
}

export class ReviewSummaryGenerator {
  private scanResult: ScanResult;
  private codeLines: number;

  constructor(scanResult: ScanResult, codeLines: number = 0) {
    this.scanResult = scanResult;
    this.codeLines = codeLines;
  }

  generate(): ReviewSummary {
    const categoryGroups = this.groupIssuesByCategory();
    const complexityScore = this.calculateComplexityScore();
    const estimatedReviewTime = this.estimateReviewTime(categoryGroups);
    const riskLevel = this.determineRiskLevel();
    const actionItems = this.generateActionItems(categoryGroups);
    const fixableSuggestions = this.compileSuggestions();
    const metrics = this.calculateMetrics();

    const executiveSummary = this.generateExecutiveSummary(
      complexityScore,
      riskLevel,
      metrics
    );

    return {
      executiveSummary,
      categoryGroups,
      complexityScore,
      estimatedReviewTime,
      riskLevel,
      actionItems,
      fixableSuggestions,
      metrics
    };
  }

  private groupIssuesByCategory(): IssueCategoryGroup[] {
    const groups: Record<string, IssueCategoryGroup> = {};

    const typeToCategory: Record<string, { category: string; severity: 'low' | 'medium' | 'high' }> = {
      'console_log': { category: 'Debug Statements', severity: 'low' },
      'commented_code': { category: 'Code Cleanup', severity: 'low' },
      'todo': { category: 'Incomplete Work', severity: 'medium' },
      'fixme': { category: 'Urgent Fixes', severity: 'high' },
      'missing_error_handling': { category: 'Error Handling', severity: 'high' },
      'hardcoded_value': { category: 'Configuration', severity: 'high' },
      'missing_types': { category: 'Type Safety', severity: 'medium' },
      'unreachable_code': { category: 'Dead Code', severity: 'medium' },
      'nested_complexity': { category: 'Code Complexity', severity: 'medium' }
    };

    this.scanResult.issues.forEach(issue => {
      const categoryInfo = typeToCategory[issue.type] || {
        category: issue.type,
        severity: issue.severity
      };

      const key = categoryInfo.category;

      if (!groups[key]) {
        groups[key] = {
          category: categoryInfo.category,
          severity: categoryInfo.severity,
          count: 0,
          issues: [],
          fixTime: this.estimateCategoryFixTime(categoryInfo.category)
        };
      }

      groups[key].count++;
      groups[key].issues.push(issue);
    });

    // Sort by severity (high > medium > low), then by count
    return Object.values(groups).sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.count - a.count;
    });
  }

  private estimateCategoryFixTime(category: string): number {
    const timeMap: Record<string, number> = {
      'Debug Statements': 1,
      'Code Cleanup': 2,
      'Incomplete Work': 15,
      'Urgent Fixes': 20,
      'Error Handling': 10,
      'Configuration': 5,
      'Type Safety': 3,
      'Dead Code': 2,
      'Code Complexity': 15
    };
    return timeMap[category] || 5;
  }

  private calculateComplexityScore(): number {
    let score = 0;

    // Base score from issue count
    const issueCount = this.scanResult.totalIssues;
    if (issueCount === 0) score = 95;
    else if (issueCount <= 3) score = 80;
    else if (issueCount <= 10) score = 60;
    else if (issueCount <= 20) score = 40;
    else score = 20;

    // Adjust for severity mix
    const { high, medium, low } = this.scanResult.issuesBySeverity;
    const highImpact = (high || 0) * 15;
    const mediumImpact = (medium || 0) * 8;
    const lowImpact = (low || 0) * 2;

    score = Math.max(0, score - (highImpact + mediumImpact + lowImpact) / 10);

    // Adjust for critical issue types
    const criticalTypes = ['hardcoded_value', 'missing_error_handling', 'fixme'];
    const criticalCount = this.scanResult.issues.filter(i =>
      criticalTypes.includes(i.type)
    ).length;

    score = Math.max(0, score - criticalCount * 5);

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private estimateReviewTime(groups: IssueCategoryGroup[]): number {
    const baseTime = 10; // 10 minutes base review time

    // Add time for each issue group
    const groupTime = groups.reduce((total, group) => {
      return total + group.fixTime;
    }, 0);

    // Additional time based on code size
    const sizeAdjustment = Math.ceil(this.codeLines / 100) * 2;

    return baseTime + groupTime + sizeAdjustment;
  }

  private determineRiskLevel(): 'low' | 'medium' | 'high' {
    const { high, medium } = this.scanResult.issuesBySeverity;

    if ((high || 0) > 0) return 'high';
    if ((medium || 0) > 3) return 'high';
    if ((medium || 0) > 0) return 'medium';
    return 'low';
  }

  private generateActionItems(groups: IssueCategoryGroup[]): string[] {
    const items: string[] = [];

    groups.forEach((group, _index) => {
      const priority = group.severity === 'high' ? 'MUST' : group.severity === 'medium' ? 'SHOULD' : 'CONSIDER';

      items.push(
        `${priority} fix ${group.count} ${group.category.toLowerCase()} issue(s)`
      );

      // Add specific guidance for critical categories
      if (group.category === 'Urgent Fixes') {
        items.push(`  → Required before merge: ${group.issues.map(i => `Line ${i.line}`).join(', ')}`);
      }

      if (group.category === 'Configuration') {
        items.push(`  → Replace hardcoded values with environment variables`);
      }

      if (group.category === 'Error Handling') {
        items.push(`  → Add proper error handlers to prevent runtime failures`);
      }
    });

    if (items.length === 0) {
      items.push('✓ No action items - code is clean');
    }

    return items;
  }

  private compileSuggestions(): Array<{
    line: number;
    current: string;
    suggested: string;
  }> {
    const suggestions: Array<{ line: number; current: string; suggested: string }> = [];

    this.scanResult.issues.forEach(issue => {
      if (issue.suggestion) {
        suggestions.push({
          line: issue.line,
          current: issue.code,
          suggested: issue.suggestion
        });
      }
    });

    return suggestions.slice(0, 10); // Limit to top 10 suggestions
  }

  private calculateMetrics() {
    const { high, medium, low } = this.scanResult.issuesBySeverity;
    const total = this.scanResult.totalIssues;

    // Code quality score: 100 - (issues with weighted penalty)
    // High severity issues (security, critical bugs) have steep penalty
    // Medium issues (code quality) have moderate penalty
    // Low issues (style, minor) have small penalty
    const qualityPenalty = ((high || 0) * 20) + ((medium || 0) * 8) + ((low || 0) * 2);
    const codeQualityScore = Math.max(0, 100 - qualityPenalty);

    return {
      totalIssues: total,
      criticalCount: high || 0,
      warningCount: medium || 0,
      infoCount: low || 0,
      codeQualityScore
    };
  }

  private generateExecutiveSummary(
    _complexityScore: number,
    riskLevel: 'low' | 'medium' | 'high',
    metrics: ReviewSummary['metrics']
  ): string {
    if (metrics.totalIssues === 0) {
      return `Perfect! No issues detected. Code quality score: ${metrics.codeQualityScore}/100. Ready for review.`;
    }

    const riskEmoji = {
      low: '✓',
      medium: '⚠',
      high: '❌'
    };

    const parts = [
      `${riskEmoji[riskLevel]} Risk Level: ${riskLevel.toUpperCase()}`,
      `Code Quality: ${metrics.codeQualityScore}/100`,
      `Issues Found: ${metrics.totalIssues} (${metrics.criticalCount} critical, ${metrics.warningCount} warnings, ${metrics.infoCount} info)`
    ];

    if (metrics.criticalCount > 0) {
      parts.push(`Action Required: ${metrics.criticalCount} critical issue(s) must be fixed before merge`);
    }

    if (metrics.warningCount > 0) {
      parts.push(`Review Needed: ${metrics.warningCount} warning(s) should be addressed`);
    }

    return parts.join(' | ');
  }
}

export function formatReviewSummaryAsMarkdown(summary: ReviewSummary): string {
  let markdown = `# Code Review Summary\n\n`;

  markdown += `## Executive Summary\n${summary.executiveSummary}\n\n`;

  markdown += `## Metrics\n`;
  markdown += `- **Code Quality Score**: ${summary.metrics.codeQualityScore}/100\n`;
  markdown += `- **Complexity Score**: ${summary.complexityScore}/100\n`;
  markdown += `- **Risk Level**: ${summary.riskLevel.toUpperCase()}\n`;
  markdown += `- **Estimated Review Time**: ${summary.estimatedReviewTime} minutes\n`;
  markdown += `- **Total Issues**: ${summary.metrics.totalIssues}\n`;
  markdown += `  - Critical: ${summary.metrics.criticalCount}\n`;
  markdown += `  - Warnings: ${summary.metrics.warningCount}\n`;
  markdown += `  - Info: ${summary.metrics.infoCount}\n\n`;

  if (summary.categoryGroups.length > 0) {
    markdown += `## Issues by Category\n`;
    summary.categoryGroups.forEach(group => {
      markdown += `### ${group.category} (${group.count})\n`;
      markdown += `**Severity**: ${group.severity} | **Est. Fix Time**: ${group.fixTime}min\n\n`;

      group.issues.slice(0, 3).forEach(issue => {
        markdown += `- **Line ${issue.line}**: ${issue.message}\n`;
        if (issue.suggestion) {
          markdown += `  - Suggestion: ${issue.suggestion}\n`;
        }
      });

      if (group.issues.length > 3) {
        markdown += `- ... and ${group.issues.length - 3} more\n`;
      }
      markdown += '\n';
    });
  }

  if (summary.actionItems.length > 0) {
    markdown += `## Action Items\n`;
    summary.actionItems.forEach(item => {
      markdown += `- ${item}\n`;
    });
    markdown += '\n';
  }

  if (summary.fixableSuggestions.length > 0) {
    markdown += `## Suggested Fixes\n`;
    summary.fixableSuggestions.forEach(fix => {
      markdown += `### Line ${fix.line}\n`;
      markdown += `\`\`\`\nCurrent: ${fix.current}\n\`\`\`\n`;
      markdown += `**Suggestion**: ${fix.suggested}\n\n`;
    });
  }

  return markdown;
}
