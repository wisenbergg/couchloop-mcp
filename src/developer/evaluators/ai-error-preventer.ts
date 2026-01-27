/**
 * AI Error Preventer
 * Intercepts and prevents common AI coding errors before they cause problems
 */

import { AI_ERROR_CATALOG, AIErrorPattern, getCriticalErrors } from '../types/ai-errors.js';
import { BuildContextDetector, BuildContext } from './build-context-detector.js';
import { PackageEvaluator } from './package-evaluator.js';

export interface ErrorPreventionResult {
  code: string;
  errors: Array<{
    pattern: AIErrorPattern;
    locations: Array<{ line: number; column: number; snippet: string }>;
    fixed: boolean;
    suggestion?: string;
  }>;
  warnings: string[];
  fixed: boolean;
  fixedCode?: string;
  preventedErrors: string[];
  buildContext?: BuildContext;
}

export class AIErrorPreventer {
  private buildDetector: BuildContextDetector;
  private packageEvaluator: PackageEvaluator;

  constructor(projectRoot?: string) {
    this.buildDetector = new BuildContextDetector(projectRoot);
    this.packageEvaluator = new PackageEvaluator();
  }

  /**
   * Prevent AI errors in generated code
   */
  async preventErrors(
    code: string,
    language: string,
    options: {
      autoFix?: boolean;
      checkBuildContext?: boolean;
      patterns?: string[]; // Specific patterns to check, or all if not specified
    } = {}
  ): Promise<ErrorPreventionResult> {
    const result: ErrorPreventionResult = {
      code,
      errors: [],
      warnings: [],
      fixed: false,
      preventedErrors: []
    };

    // Step 1: Detect build context if requested
    if (options.checkBuildContext) {
      result.buildContext = await this.buildDetector.detect();

      // Apply build context fixes
      if (result.buildContext.requiresJsExtensions) {
        code = this.fixImportExtensions(code, language);
        result.preventedErrors.push('build-context-blindness');
      }
    }

    // Step 2: Check for critical error patterns
    const patternsToCheck = options.patterns
      ? AI_ERROR_CATALOG.filter(p => options.patterns?.includes(p.id) || false)
      : getCriticalErrors();

    for (const pattern of patternsToCheck) {
      const detection = await this.detectPattern(code, pattern, language);

      if (detection.found) {
        result.errors.push({
          pattern,
          locations: detection.locations,
          fixed: false,
          suggestion: detection.suggestion
        });

        if (options.autoFix === true && pattern.autoFixable) {
          const fixedCode = await this.fixPattern(code, pattern, language);
          if (fixedCode !== code) {
            code = fixedCode;
            const lastError = result.errors[result.errors.length - 1];
            if (lastError) {
              lastError.fixed = true;
            }
            result.preventedErrors.push(pattern.id);
          }
        }
      }
    }

    // Step 3: Package validation (always check)
    const languageWithTs = language as 'javascript' | 'typescript' | 'python' | 'java' | 'unknown';
    const packages = this.packageEvaluator.extractPackages(code, languageWithTs);
    if (packages.length > 0) {
      const validationResults = await this.packageEvaluator.evaluateBatch(
        packages,
        { language: languageWithTs }
      );

      const invalidPackages = validationResults.filter(r => r.blocked);
      if (invalidPackages.length > 0) {
        result.warnings.push(`Found ${invalidPackages.length} invalid packages`);
        result.preventedErrors.push('package-hallucination');

        // Auto-fix package names if possible
        if (options.autoFix === true) {
          for (const pkg of invalidPackages) {
            if (pkg.suggestions && pkg.suggestions.length === 1) {
              code = code.replace(
                new RegExp(`(['"])${pkg.package.name}(['"])`, 'g'),
                `$1${pkg.suggestions[0]}$2`
              );
            }
          }
        }
      }
    }

    // Return final result
    if (code !== result.code) {
      result.fixed = true;
      result.fixedCode = code;
    }

    return result;
  }

  /**
   * Detect a specific error pattern in code
   */
  private async detectPattern(
    code: string,
    pattern: AIErrorPattern,
    _language: string
  ): Promise<{
    found: boolean;
    locations: Array<{ line: number; column: number; snippet: string }>;
    suggestion?: string;
  }> {
    const locations: Array<{ line: number; column: number; snippet: string }> = [];

    switch (pattern.id) {
      case 'async-await-confusion': {
        // Look for Promise-returning functions without await
        const lines = code.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('fetch(') || line.includes('axios') || line.includes('query')) {
            if (!line.includes('await') && !line.includes('.then')) {
              locations.push({
                line: index + 1,
                column: line.indexOf('fetch') || line.indexOf('axios') || 0,
                snippet: line.trim()
              });
            }
          }
        });
        break;
      }

      case 'sql-injection-prone': {
        // Check for string concatenation in SQL queries
        const sqlPattern = /(?:query|execute|prepare)\s*\(\s*[`'"].*?\$\{.*?\}|(?:query|execute|prepare)\s*\(\s*.*?\+/gi;
        let match;
        while ((match = sqlPattern.exec(code)) !== null) {
          const line = code.substring(0, match.index).split('\n').length;
          locations.push({
            line,
            column: match.index,
            snippet: match[0]
          });
        }
        break;
      }

      case 'hardcoded-secrets': {
        // Detect common secret patterns
        const secretPatterns = [
          /(?:api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['"][^'"]{10,}['"]/gi,
          /sk-[a-zA-Z0-9]{20,}/g,
          /mongodb:\/\/[^:]+:[^@]+@/g
        ];

        for (const secretPattern of secretPatterns) {
          let match;
          while ((match = secretPattern.exec(code)) !== null) {
            const line = code.substring(0, match.index).split('\n').length;
            locations.push({
              line,
              column: match.index,
              snippet: match[0]
            });
          }
        }
        break;
      }

      case 'null-reference-error': {
        // Look for property access chains without null checks
        const chainPattern = /\b\w+(?:\.\w+){2,}/g;
        let chainMatch;
        while ((chainMatch = chainPattern.exec(code)) !== null) {
          const chain = chainMatch[0];
          // Check if there's optional chaining or null check nearby
          const lineStart = code.lastIndexOf('\n', chainMatch.index) + 1;
          const lineEnd = code.indexOf('\n', chainMatch.index);
          const line = code.substring(lineStart, lineEnd === -1 ? undefined : lineEnd);

          if (!line.includes('?.') && !line.includes('if (') && !line.includes('&& ')) {
            locations.push({
              line: code.substring(0, chainMatch.index).split('\n').length,
              column: chainMatch.index - lineStart,
              snippet: chain
            });
          }
        }
        break;
      }
    }

    return {
      found: locations.length > 0,
      locations,
      suggestion: pattern.prevention
    };
  }

  /**
   * Fix a specific error pattern
   */
  private async fixPattern(
    code: string,
    pattern: AIErrorPattern,
    _language: string
  ): Promise<string> {
    switch (pattern.id) {
      case 'async-await-confusion':
        // Add await to common async functions
        code = code.replace(/(\s+)(fetch\()/g, '$1await $2');
        code = code.replace(/(\s+)(axios\.\w+\()/g, '$1await $2');
        break;

      case 'sql-injection-prone':
        // Convert to parameterized queries (basic example)
        code = code.replace(
          /query\(`SELECT \* FROM (\w+) WHERE (\w+) = \$\{([^}]+)\}`\)/g,
          'query("SELECT * FROM $1 WHERE $2 = ?", [$3])'
        );
        break;

      case 'hardcoded-secrets':
        // Replace with environment variables
        code = code.replace(
          /(?:const|let|var)\s+(\w*(?:api[_-]?key|apikey|secret|password|token)\w*)\s*=\s*['"]([^'"]+)['"]/gi,
          'const $1 = process.env.$1'
        );
        break;

      case 'null-reference-error':
        // Add optional chaining
        code = code.replace(
          /(\b\w+)((?:\.\w+){2,})/g,
          (match, obj, chain) => {
            // Don't modify if it's already using optional chaining
            if (code[code.indexOf(match) - 1] === '?') return match;
            // Convert to optional chaining
            return obj + chain.replace(/\./g, '?.');
          }
        );
        break;

      case 'build-context-blindness':
        // This is handled by fixImportExtensions
        break;
    }

    return code;
  }

  /**
   * Fix import statements to add .js extensions for ESM
   */
  private fixImportExtensions(code: string, language: string): string {
    if (language !== 'javascript' && language !== 'typescript') {
      return code;
    }

    // Fix import statements
    code = code.replace(
      /from\s+['"](\.[^'"]+?)(?<!\.js|\.mjs|\.json|\.node)['"](\s|;|$)/g,
      'from "$1.js"$2'
    );

    // Fix dynamic imports
    code = code.replace(
      /import\s*\(\s*['"](\.[^'"]+?)(?<!\.js|\.mjs|\.json|\.node)['"]\s*\)/g,
      'import("$1.js")'
    );

    return code;
  }

  /**
   * Generate report of prevented errors
   */
  generateReport(result: ErrorPreventionResult): string {
    const lines: string[] = [
      '🛡️ AI Error Prevention Report',
      '=' . repeat(40),
      ''
    ];

    if (result.buildContext) {
      lines.push('📦 Build Context:');
      lines.push(`  Language: ${result.buildContext.language}`);
      lines.push(`  Module System: ${result.buildContext.moduleSystem || 'unknown'}`);
      lines.push(`  Package Manager: ${result.buildContext.packageManager || 'unknown'}`);

      if (result.buildContext.requiresJsExtensions) {
        lines.push('  ⚠️ Requires .js extensions in imports');
      }
      lines.push('');
    }

    if (result.preventedErrors.length > 0) {
      lines.push(`✅ Prevented ${result.preventedErrors.length} AI Errors:`);
      for (const errorId of result.preventedErrors) {
        const pattern = AI_ERROR_CATALOG.find(p => p.id === errorId);
        if (pattern) {
          lines.push(`  • ${pattern.name} (${pattern.impact} impact)`);
        }
      }
      lines.push('');
    }

    if (result.errors.length > 0) {
      const unfixed = result.errors.filter(e => !e.fixed);
      if (unfixed.length > 0) {
        lines.push(`⚠️ ${unfixed.length} Issues Need Manual Review:`);
        for (const error of unfixed) {
          lines.push(`  • ${error.pattern.name}`);
          if (error.suggestion) {
            lines.push(`    Fix: ${error.suggestion}`);
          }
        }
      }
    }

    if (result.warnings.length > 0) {
      lines.push('');
      lines.push('📝 Warnings:');
      result.warnings.forEach(w => lines.push(`  • ${w}`));
    }

    lines.push('');
    lines.push('-'.repeat(40));
    lines.push(`Total Errors Prevented: ${result.preventedErrors.length}`);
    lines.push(`Code Modified: ${result.fixed ? 'Yes' : 'No'}`);

    return lines.join('\n');
  }
}