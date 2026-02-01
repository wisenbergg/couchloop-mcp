/**
 * Review Assistant Scanner
 * Scans code for common issues to reduce human review burden
 * Detects: console logs, commented code, TODOs/FIXMEs, error handling, hardcoded values, type definitions, unreachable code
 */

export interface CodeIssue {
  line: number;
  column: number;
  type: 'console_log' | 'commented_code' | 'todo' | 'fixme' | 'missing_error_handling' | 'hardcoded_value' | 'missing_types' | 'unreachable_code' | 'nested_complexity';
  severity: 'low' | 'medium' | 'high';
  message: string;
  code: string;
  suggestion?: string;
}

export interface ScanResult {
  issues: CodeIssue[];
  totalIssues: number;
  issuesByType: Record<string, number>;
  issuesBySeverity: Record<string, number>;
}

export class ReviewAssistant {
  private lines: string[];
  private language: string;

  constructor(code: string, language: string = 'typescript') {
    this.language = language.toLowerCase();
    this.lines = code.split('\n');
  }

  scan(): ScanResult {
    const issues: CodeIssue[] = [];

    issues.push(...this.findConsoleLogs());
    issues.push(...this.findCommentedCode());
    issues.push(...this.findTodos());
    issues.push(...this.findMissingErrorHandling());
    issues.push(...this.findHardcodedValues());
    issues.push(...this.findMissingTypes());
    issues.push(...this.findUnreachableCode());
    issues.push(...this.findNestedComplexity());

    return this.compileScanResult(issues);
  }

  private findConsoleLogs(): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const consolePattern = /\bconsole\.(log|debug|info|warn|error)\s*\(/gi;

    this.lines.forEach((line, index) => {
      if (line.trim().startsWith('//')) return; // Skip comments

      let match;
      while ((match = consolePattern.exec(line)) !== null) {
        issues.push({
          line: index + 1,
          column: match.index + 1,
          type: 'console_log',
          severity: 'low',
          message: `Remove debug statement: console.${match[1]}()`,
          code: line.trim(),
          suggestion: `Remove this line before merging to production`
        });
      }
    });

    return issues;
  }

  private findCommentedCode(): CodeIssue[] {
    const issues: CodeIssue[] = [];

    this.lines.forEach((line, index) => {
      const trimmed = line.trim();

      // Skip single-line comments that are actual documentation
      if (trimmed.startsWith('//') && !trimmed.startsWith('// ')) return;

      // Check for commented out code patterns
      const commentedCodePatterns = [
        /^\/\/\s*(const|let|var|function|if|for|while|return|async|await|import|export)\b/,
        /^\/\/\s*\w+\s*[\.\[\(\{]/,
        /^\/\/\s*}\s*$/,
        /^\/\/\s*;/
      ];

      for (const pattern of commentedCodePatterns) {
        if (pattern.test(trimmed)) {
          issues.push({
            line: index + 1,
            column: 1,
            type: 'commented_code',
            severity: 'low',
            message: 'Remove commented out code',
            code: line.trim(),
            suggestion: 'Use version control to recover old code if needed'
          });
          break;
        }
      }

      // Multi-line commented code
      if (trimmed.startsWith('/*') && !trimmed.startsWith('/**')) {
        let commentContent = trimmed.slice(2);
        if (commentContent.includes('{') || commentContent.includes(';') || /\w+\s*=/i.test(commentContent)) {
          issues.push({
            line: index + 1,
            column: 1,
            type: 'commented_code',
            severity: 'low',
            message: 'Remove commented out code block',
            code: line.trim(),
            suggestion: 'Use version control instead'
          });
        }
      }
    });

    return issues;
  }

  private findTodos(): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const todoPattern = /\b(TODO|todo)\b[:\s]*(.*?)(?=\n|$)/gi;
    const fixmePattern = /\b(FIXME|fixme)\b[:\s]*(.*?)(?=\n|$)/gi;

    this.lines.forEach((line, index) => {
      let match;

      while ((match = todoPattern.exec(line)) !== null) {
        issues.push({
          line: index + 1,
          column: match.index + 1,
          type: 'todo',
          severity: 'medium',
          message: `TODO: ${match[2]?.trim() || 'Item left incomplete'}`,
          code: line.trim(),
          suggestion: 'Complete this task before merge or create an issue'
        });
      }

      while ((match = fixmePattern.exec(line)) !== null) {
        issues.push({
          line: index + 1,
          column: match.index + 1,
          type: 'fixme',
          severity: 'high',
          message: `FIXME: ${match[2]?.trim() || 'Issue needs to be fixed'}`,
          code: line.trim(),
          suggestion: 'This must be fixed before merge'
        });
      }
    });

    return issues;
  }

  private findMissingErrorHandling(): CodeIssue[] {
    const issues: CodeIssue[] = [];

    this.lines.forEach((line, index) => {
      // Check for fetch without error handling
      if (/fetch\s*\([^)]*\)\s*\.then\s*\(/.test(line) && !this.hasErrorHandling(index)) {
        issues.push({
          line: index + 1,
          column: 1,
          type: 'missing_error_handling',
          severity: 'high',
          message: 'Missing error handling on fetch call',
          code: line.trim(),
          suggestion: 'Add .catch() handler or use try/catch with await'
        });
      }

      // Check for Promise without catch
      if (/\.then\s*\(/.test(line) && !this.hasErrorHandling(index)) {
        const hasCatch = this.checkMultilinePromiseChain(index);
        if (!hasCatch) {
          issues.push({
            line: index + 1,
            column: 1,
            type: 'missing_error_handling',
            severity: 'medium',
            message: 'Promise chain may be missing .catch() error handler',
            code: line.trim(),
            suggestion: 'Add .catch() or ensure error handling in parent context'
          });
        }
      }

      // Check for try block without catch
      if (/^\s*try\s*\{/.test(line)) {
        const hasCatch = this.findMatchingCatch(index);
        if (!hasCatch) {
          issues.push({
            line: index + 1,
            column: 1,
            type: 'missing_error_handling',
            severity: 'high',
            message: 'Try block without catch handler',
            code: line.trim(),
            suggestion: 'Add catch block or finally block for cleanup'
          });
        }
      }
    });

    return issues;
  }

  private findHardcodedValues(): CodeIssue[] {
    const issues: CodeIssue[] = [];

    const patterns = [
      { regex: /['"]sk-[a-zA-Z0-9]+['"]/, type: 'API key' },
      { regex: /['"]pk_[a-zA-Z0-9]+['"]/, type: 'API key' },
      { regex: /auth[_-]?token\s*[:=]\s*['"][^'"]+['"]/, type: 'Auth token' },
      { regex: /password\s*[:=]\s*['"][^'"]*['"]/, type: 'Password' },
      { regex: /secret\s*[:=]\s*['"][^'"]+['"]/, type: 'Secret' },
      { regex: /(['"]https?:\/\/[^'"]+['"])\s*;/, type: 'Hardcoded URL' },
      { regex: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/, type: 'API key' }
    ];

    this.lines.forEach((line, index) => {
      if (line.trim().startsWith('//')) return;

      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          issues.push({
            line: index + 1,
            column: 1,
            type: 'hardcoded_value',
            severity: 'high',
            message: `Hardcoded ${pattern.type} detected`,
            code: line.trim(),
            suggestion: `Use environment variable instead (e.g., process.env.${pattern.type.replace(/[^A-Z0-9]/gi, '_').toUpperCase()})`
          });
        }
      }
    });

    return issues;
  }

  private findMissingTypes(): CodeIssue[] {
    const issues: CodeIssue[] = [];

    if (!['typescript', 'ts'].includes(this.language)) {
      return issues;
    }

    this.lines.forEach((line, index) => {
      // Check for function parameters without types
      const funcParamPattern = /function\s+\w+\s*\(\s*(\w+)\s*[,\)]/;
      const arrowFuncPattern = /(\w+)\s*=>\s*/;

      if (funcParamPattern.test(line) || arrowFuncPattern.test(line)) {
        const match = line.match(/\(([^)]*)\)/);
        if (match && match[1]) {
          const params = match[1].split(',').map(p => p.trim());
          for (const param of params) {
            if (param && !param.includes(':') && !param.includes('?') && param !== '...rest') {
              issues.push({
                line: index + 1,
                column: 1,
                type: 'missing_types',
                severity: 'medium',
                message: `Parameter "${param}" missing type annotation`,
                code: line.trim(),
                suggestion: `Add type: (${param}: ParameterType) or enable implicit any`
              });
              break;
            }
          }
        }
      }

      // Check for variables without types
      if (/^\s*(const|let|var)\s+\w+\s*=/.test(line) && !line.includes(':')) {
        const match = line.match(/^\s*(const|let|var)\s+(\w+)\s*=/);
        if (match && !this.isObviouslyTyped(line)) {
          issues.push({
            line: index + 1,
            column: 1,
            type: 'missing_types',
            severity: 'low',
            message: `Variable "${match[2]}" could have explicit type annotation`,
            code: line.trim(),
            suggestion: `Add type: const ${match[2]}: Type = ...`
          });
        }
      }
    });

    return issues;
  }

  private findUnreachableCode(): CodeIssue[] {
    const issues: CodeIssue[] = [];

    this.lines.forEach((line, index) => {
      if (line.trim() === 'return;' || line.trim().startsWith('return ')) {
        // Check if there's code after return in same block
        for (let i = index + 1; i < this.lines.length && i < index + 5; i++) {
          const nextLine = this.lines[i]?.trim();
          if (!nextLine || nextLine.startsWith('//')) continue;
          if (nextLine.startsWith('}')) break;
          if (!nextLine.startsWith('case') && !nextLine.startsWith('default:')) {
            issues.push({
              line: i + 1,
              column: 1,
              type: 'unreachable_code',
              severity: 'medium',
              message: 'Code unreachable due to return statement above',
              code: nextLine,
              suggestion: 'Remove this code or reorganize logic'
            });
            break;
          }
        }
      }
    });

    return issues;
  }

  private findNestedComplexity(): CodeIssue[] {
    const issues: CodeIssue[] = [];

    this.lines.forEach((line, index) => {
      let currentDepth = this.getCurrentBraceDepth(index);

      if (currentDepth >= 4) {
        if (/^\s*(if|for|while|switch)\s*/.test(line)) {
          issues.push({
            line: index + 1,
            column: 1,
            type: 'nested_complexity',
            severity: 'medium',
            message: `High nesting depth (${currentDepth} levels) - consider refactoring`,
            code: line.trim(),
            suggestion: 'Extract to separate function or simplify control flow'
          });
        }
      }
    });

    return issues;
  }

  private hasErrorHandling(lineIndex: number): boolean {
    const nextLines = this.lines.slice(lineIndex, Math.min(lineIndex + 5, this.lines.length));
    return nextLines.some(line => /\.catch\s*\(|\.finally\s*\(/.test(line));
  }

  private checkMultilinePromiseChain(lineIndex: number): boolean {
    for (let i = lineIndex; i < Math.min(lineIndex + 10, this.lines.length); i++) {
      const line = this.lines[i];
      if (!line) continue;
      if (/\.catch\s*\(/.test(line)) return true;
      if (/^\s*[}\);]/.test(line) && i > lineIndex) break;
    }
    return false;
  }

  private findMatchingCatch(tryLineIndex: number): boolean {
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = tryLineIndex; i < Math.min(tryLineIndex + 50, this.lines.length); i++) {
      const line = this.lines[i];
      if (!line) continue;

      // Check for catch BEFORE counting braces on this line
      if (foundOpenBrace && /\}\s*catch\s*\(/.test(line)) {
        return true;
      }

      if (!foundOpenBrace && line.includes('{')) {
        foundOpenBrace = true;
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;
      } else if (foundOpenBrace) {
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;

        if (braceCount <= 0) break;
      }
    }

    return false;
  }

  private getCurrentBraceDepth(lineIndex: number): number {
    let depth = 0;
    for (let i = 0; i <= lineIndex; i++) {
      const line = this.lines[i];
      if (!line) continue;
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
    }
    return Math.max(0, depth);
  }

  private isObviouslyTyped(line: string): boolean {
    return /= (true|false|\d+|['"]|null|undefined|\[|\{)/.test(line);
  }

  private compileScanResult(issues: CodeIssue[]): ScanResult {
    const issuesByType: Record<string, number> = {};
    const issuesBySeverity: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0
    };

    issues.forEach(issue => {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
      if (issue.severity in issuesBySeverity) {
        const severity = issuesBySeverity[issue.severity];
        if (typeof severity === 'number') {
          issuesBySeverity[issue.severity] = severity + 1;
        }
      }
    });

    return {
      issues,
      totalIssues: issues.length,
      issuesByType,
      issuesBySeverity
    };
  }
}
