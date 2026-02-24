/**
 * Code Bloat Detector - Identifies verbose and over-engineered patterns
 * Detects patterns that create technical debt and suggests simplifications
 */

import { ComplexityCalculator, ComplexityMetrics } from '../metrics/complexity-calculator.js';

export interface CodeSmellWarning {
  type: string;
  severity: 'low' | 'medium' | 'high';
  line?: number;
  pattern: string;
  suggestion: string;
  example?: {
    bad: string;
    good: string;
  };
}

export interface BloatDetectionResult {
  issues: CodeSmellWarning[];
  metrics: ComplexityMetrics;
  summary: {
    totalIssues: number;
    criticalIssues: number;
    warningCount: number;
    score: number;
    recommendation: string;
  };
  refactoringPriority: string[];
}

export class BloatDetector {
  private complexityCalculator: ComplexityCalculator;
  constructor(threshold: number = 50) {
    this.complexityCalculator = new ComplexityCalculator();
    // Threshold reserved for future use
    void threshold;
  }

  /**
   * Analyze code for bloat patterns
   */
  analyze(code: string, language: 'javascript' | 'typescript' | 'python'): BloatDetectionResult {
    const issues: CodeSmellWarning[] = [];
    const metrics = this.complexityCalculator.calculateMetrics(code, language);

    // Detect specific patterns
    this.detectExcessiveNesting(code, language, issues);
    this.detectUnnecessaryTryCatch(code, language, issues);
    this.detectOverAbstraction(code, language, issues);
    this.detectDuplicatePatterns(code, language, issues);
    this.detectVerboseConditionals(code, language, issues);
    this.detectLongFunctions(code, language, issues);
    this.detectChainedConditionals(code, language, issues);
    this.detectRedundantNullChecks(code, language, issues);
    this.detectComplexLogic(code, language, issues);

    // Sort by severity
    issues.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    const criticalIssues = issues.filter(i => i.severity === 'high').length;
    const warningCount = issues.filter(i => i.severity !== 'high').length;

    return {
      issues,
      metrics,
      summary: {
        totalIssues: issues.length,
        criticalIssues,
        warningCount,
        score: metrics.score,
        recommendation: this.generateRecommendation(issues, metrics)
      },
      refactoringPriority: this.prioritizeRefactoring(issues, metrics)
    };
  }

  /**
   * Detect excessive nesting (>3 levels)
   */
  private detectExcessiveNesting(code: string, _language: string, issues: CodeSmellWarning[]): void {
    const lines = code.split('\n');
    let maxNesting = 0;
    let nestingStack: { level: number; lineNumber: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;

      for (let j = 0; j < openBraces; j++) {
        nestingStack.push({ level: nestingStack.length + 1, lineNumber: i + 1 });
      }

      for (let j = 0; j < closeBraces; j++) {
        nestingStack.pop();
      }

      const currentNesting = nestingStack.length;
      if (currentNesting > 3 && currentNesting > maxNesting) {
        maxNesting = currentNesting;

        issues.push({
          type: 'excessive_nesting',
          severity: currentNesting > 5 ? 'high' : 'medium',
          line: i + 1,
          pattern: line.trim().substring(0, 50),
          suggestion: `Reduce nesting depth from ${currentNesting} to 3 or less. Extract nested logic into separate functions.`,
          example: {
            bad: `if (user) {
  if (user.email) {
    if (user.email.includes('@')) {
      if (user.verified) {
        return true;
      }
    }
  }
}`,
            good: `const isValidUser = (user) =>
  user?.email?.includes('@') && user?.verified;
return isValidUser(user) ? true : false;`
          }
        });
      }
    }
  }

  /**
   * Detect unnecessary try-catch blocks
   */
  private detectUnnecessaryTryCatch(code: string, _language: string, issues: CodeSmellWarning[]): void {
    // Pattern: try block with no operations that can fail
    const tryBlockRegex = /try\s*\{([^}]+)\}\s*catch\s*\(/gm;
    let match;

    while ((match = tryBlockRegex.exec(code)) !== null) {
      const blockContent = match[1];
      const lineNumber = code.substring(0, match.index).split('\n').length;

      // Check if try block only contains safe operations
      const hasDangerousOps = /(\.\w+\(|fetch|async|await|JSON\.parse|throw)/i.test(blockContent || '');

      if (!hasDangerousOps) {
        issues.push({
          type: 'unnecessary_try_catch',
          severity: 'low',
          line: lineNumber,
          pattern: `try { ... } catch (e) { ... }`,
          suggestion: 'This try-catch wraps safe operations. Remove unnecessary error handling.',
          example: {
            bad: `try {
  if (x) {
    console.log('safe');
  }
} catch (e) {
  return false;
}`,
            good: `if (x) {
  console.log('safe');
}`
          }
        });
      }

      // Also detect swallowing errors with no logging/handling
      const catchContent = code.substring(match.index + match[0].length);
      const catchEndIndex = catchContent.indexOf('\n');
      const catchLine = catchContent.substring(0, catchEndIndex);

      if (/catch\s*\([^)]*\)\s*\{\s*(?:return|;|})/i.test(catchLine)) {
        issues.push({
          type: 'swallowed_errors',
          severity: 'high',
          line: lineNumber,
          pattern: `catch (e) { return/; }`,
          suggestion: 'Error is silently swallowed. Add logging or meaningful error handling.',
          example: {
            bad: `try {
  return risky();
} catch (e) {
  return false;
}`,
            good: `try {
  return risky();
} catch (e) {
  logger.error('Operation failed:', e);
  throw new Error('Failed to complete operation');
}`
          }
        });
      }
    }
  }

  /**
   * Detect over-abstraction (single-use abstractions)
   */
  private detectOverAbstraction(code: string, _language: string, issues: CodeSmellWarning[]): void {
    // Pattern: functions/classes used only once
    const functionMatches = code.matchAll(/(?:function|const)\s+(\w+)\s*(?:\(|=)/g);
    const functionNames = new Map<string, number>();

    for (const match of functionMatches) {
      const name = match[1];
      if (!name) continue;
      functionNames.set(name, (functionNames.get(name) || 0) + 1);
    }

    // Find functions that are defined but only called once (or not at all)
    for (const [name, _count] of functionNames.entries()) {
      const callPattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
      const calls = code.match(callPattern);
      const callCount = calls ? calls.length - 1 : 0; // -1 for the definition

      if (callCount === 1) {
        const defIndex = code.indexOf(`${name}\s*(`);
        const lineNumber = code.substring(0, defIndex).split('\n').length;

        issues.push({
          type: 'over_abstraction',
          severity: 'low',
          line: lineNumber,
          pattern: `Function "${name}" defined but used only once`,
          suggestion: `Inline function "${name}" where it's called. Single-use abstractions add complexity without benefit.`
        });
      }
    }
  }

  /**
   * Detect duplicated code patterns
   */
  private detectDuplicatePatterns(code: string, _language: string, issues: CodeSmellWarning[]): void {
    const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));

    // Look for repeated line patterns (3+ occurrences)
    const linePatterns = new Map<string, number[]>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const normalized = this.normalizeLine(line);
      if (normalized.length > 20) { // Only check substantial lines
        if (!linePatterns.has(normalized)) {
          linePatterns.set(normalized, []);
        }
        linePatterns.get(normalized)!.push(i + 1);
      }
    }

    for (const [pattern, occurrences] of linePatterns.entries()) {
      if (occurrences.length >= 3) {
        issues.push({
          type: 'code_duplication',
          severity: occurrences.length >= 5 ? 'high' : 'medium',
          line: occurrences[0],
          pattern: pattern.substring(0, 60),
          suggestion: `This pattern appears ${occurrences.length} times (lines ${occurrences.join(', ')}). Extract to a utility function.`
        });
      }
    }
  }

  /**
   * Detect verbose conditionals that could be simplified
   */
  private detectVerboseConditionals(code: string, _language: string, issues: CodeSmellWarning[]): void {
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Pattern: if (x === true) or if (x === false)
      if (/if\s*\(\s*\w+\s*===\s*(true|false)\s*\)/.test(line)) {
        issues.push({
          type: 'verbose_boolean_check',
          severity: 'low',
          line: i + 1,
          pattern: line.trim().substring(0, 50),
          suggestion: 'Simplify boolean comparisons. Use "if (x)" instead of "if (x === true)".',
          example: {
            bad: 'if (isActive === true) { ... }',
            good: 'if (isActive) { ... }'
          }
        });
      }

      // Pattern: if (x !== null && x !== undefined)
      if (/if\s*\(\s*\w+\s*!==\s*null\s*&&\s*\w+\s*!==\s*undefined\s*\)/.test(line)) {
        issues.push({
          type: 'verbose_null_check',
          severity: 'low',
          line: i + 1,
          pattern: line.trim().substring(0, 60),
          suggestion: 'Use optional chaining or nullish coalescing. Replace with "if (x ?? false)".',
          example: {
            bad: 'if (user !== null && user !== undefined) { ... }',
            good: 'if (user) { ... }'
          }
        });
      }

      // Pattern: if (condition) { return true; } else { return false; }
      if (/if\s*\([^)]+\)\s*\{\s*return\s+(true|false)\s*;\s*\}\s*else\s*\{\s*return\s+(true|false)/i.test(line)) {
        issues.push({
          type: 'unnecessary_conditional_return',
          severity: 'low',
          line: i + 1,
          pattern: 'if (...) { return true; } else { return false; }',
          suggestion: 'Return the condition directly instead of conditional return statements.',
          example: {
            bad: `if (isValid(data)) {
  return true;
} else {
  return false;
}`,
            good: 'return isValid(data);'
          }
        });
      }
    }
  }

  /**
   * Detect functions longer than 50 lines
   */
  private detectLongFunctions(code: string, _language: string, issues: CodeSmellWarning[]): void {
    const functions = this.extractFunctionBlocks(code, _language);

    for (const func of functions) {
      if (func.length > 75) {
        issues.push({
          type: 'function_too_long',
          severity: func.length > 150 ? 'high' : 'medium',
          line: func.startLine,
          pattern: `Function "${func.name}" is ${func.length} lines long`,
          suggestion: `Consider breaking "${func.name}" into smaller functions. Functions over 75 lines are harder to follow.`
        });
      }
    }
  }

  /**
   * Detect chained conditionals that could use switch
   */
  private detectChainedConditionals(code: string, _language: string, issues: CodeSmellWarning[]): void {
    // Pattern: if (x === 'a') ... else if (x === 'b') ... else if (x === 'c') ...
    const chainRegex = /(if|else\s+if)\s*\(\s*\w+\s*===\s*['"][^'"]+['"]\s*\)/g;
    let lastMatch: RegExpExecArray | null = null;
    let chainCount = 0;
    let chainStart = 0;

    for (const match of code.matchAll(chainRegex)) {
      if (lastMatch && match.index - lastMatch.index < 100) {
        chainCount++;
        if (chainCount === 2) {
          chainStart = lastMatch.index;
        }
      } else {
        chainCount = 0;
      }

      if (chainCount >= 3) {
        const lineNumber = code.substring(0, chainStart).split('\n').length;

        issues.push({
          type: 'chain_of_conditionals',
          severity: 'medium',
          line: lineNumber,
          pattern: `Multiple if/else if with equality checks`,
          suggestion: 'Consider using a switch statement or object map for multiple equality comparisons.',
          example: {
            bad: `if (status === 'pending') {
  handlePending();
} else if (status === 'active') {
  handleActive();
} else if (status === 'completed') {
  handleCompleted();
}`,
            good: `const handlers = {
  pending: handlePending,
  active: handleActive,
  completed: handleCompleted
};
handlers[status]?.();`
          }
        });

        chainCount = 0;
      }

      lastMatch = match;
    }
  }

  /**
   * Detect redundant null/undefined checks
   */
  private detectRedundantNullChecks(code: string, _language: string, issues: CodeSmellWarning[]): void {
    // Pattern: multiple checks for same variable
    const lines = code.split('\n');

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];

      if (!line || !nextLine) continue;

      // Pattern: if (x) { ... if (x) { ... } }
      const xMatches = line.match(/if\s*\(\s*(\w+)\s*\)/);
      if (xMatches && xMatches[1]) {
        const varName = xMatches[1];
        if (nextLine.includes(`if`) && nextLine.includes(varName)) {
          issues.push({
            type: 'redundant_null_check',
            severity: 'low',
            line: i + 2,
            pattern: `Redundant check for ${varName}`,
            suggestion: `Variable "${varName}" is already checked. Combine conditions instead.`,
            example: {
              bad: `if (user) {
  if (user.email) {
    // ...
  }
}`,
              good: `if (user?.email) {
  // ...
}`
            }
          });
        }
      }
    }
  }

  /**
   * Detect overly complex logic that should be extracted
   */
  private detectComplexLogic(code: string, _language: string, issues: CodeSmellWarning[]): void {
    // Pattern: assignments with complex expressions
    const complexRegex = /\w+\s*=\s*[^;]*(\?|&&|\|\|)[^;]*(\?|&&|\|\|)[^;]*(\?|&&|\|\|)[^;]*;/g;
    let match;

    while ((match = complexRegex.exec(code)) !== null) {
      const lineNumber = code.substring(0, match.index).split('\n').length;

      issues.push({
        type: 'complex_assignment',
        severity: 'medium',
        line: lineNumber,
        pattern: match[0].substring(0, 60),
        suggestion: 'Complex expression assignment. Break into multiple statements for clarity.',
        example: {
          bad: 'const result = x > 5 && y < 10 ? a ? b : c : d ? e : f;',
          good: `const isXInRange = x > 5 && y < 10;
const result = isXInRange ? (a ? b : c) : (d ? e : f);`
        }
      });
    }
  }

  /**
   * Extract function blocks with metadata
   */
  private extractFunctionBlocks(code: string, _language: string): Array<{ name: string; startLine: number; length: number }> {
    const functions: Array<{ name: string; startLine: number; length: number }> = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // JavaScript/TypeScript function
      if (/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\()/.test(line)) {
        const nameMatch = line.match(/(?:function\s+(\w+)|const\s+(\w+)|(?:async\s+)?(\w+)\s*\()/);
        const name = nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || 'anonymous';

        // Count lines until matching closing brace
        let braceCount = 1;
        let length = 1;

        for (let j = i + 1; j < lines.length && braceCount > 0; j++) {
          const jLine = lines[j];
          if (!jLine) continue;
          braceCount += (jLine.match(/\{/g) || []).length;
          braceCount -= (jLine.match(/\}/g) || []).length;
          length++;
        }

        functions.push({ name, startLine: i + 1, length });
      }
    }

    return functions;
  }

  /**
   * Normalize line for duplicate detection
   */
  private normalizeLine(line: string): string {
    return line
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[0-9]+/g, 'N')
      .replace(/['"][^'"]*['"]/g, 'S');
  }

  /**
   * Generate recommendation based on issues and metrics
   */
  private generateRecommendation(issues: CodeSmellWarning[], metrics: ComplexityMetrics): string {
    const criticalCount = issues.filter(i => i.severity === 'high').length;

    if (criticalCount >= 5) {
      return 'Multiple code quality issues detected. Refactoring would improve maintainability.';
    }

    if (metrics.score > 75) {
      return 'High complexity. Consider extracting functions and reducing nesting depth.';
    }

    if (metrics.score > 50) {
      return 'Moderate complexity. Some areas could be simplified.';
    }

    if (issues.length > 0) {
      return 'Minor issues found. Address low-severity items to improve code quality.';
    }

    return 'Code quality is good. Continue monitoring for emerging complexity.';
  }

  /**
   * Prioritize refactoring tasks by impact
   */
  private prioritizeRefactoring(issues: CodeSmellWarning[], metrics: ComplexityMetrics): string[] {
    const priority: string[] = [];

    if (metrics.cyclomaticComplexity > 15) {
      priority.push('Reduce cyclomatic complexity - extract conditional logic');
    }

    if (metrics.nestingDepth > 5) {
      priority.push('Reduce nesting depth - use early returns and extract nested blocks');
    }

    if (metrics.maxFunctionLength > 100) {
      priority.push('Break down oversized functions into smaller, focused units');
    }

    const highSeverityIssues = issues.filter(i => i.severity === 'high');
    if (highSeverityIssues.length > 0) {
      priority.push(`Fix ${highSeverityIssues.length} critical issues: ${highSeverityIssues.map(i => i.type).join(', ')}`);
    }

    if (priority.length === 0) {
      priority.push('Code is well-structured - maintain current quality standards');
    }

    return priority;
  }
}
