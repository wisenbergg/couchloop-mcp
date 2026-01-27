/**
 * Complexity Calculator - Metrics for code quality analysis
 * Measures cyclomatic complexity, cognitive complexity, and code metrics
 */

export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  linesOfCode: number;
  nestingDepth: number;
  functionCount: number;
  maxFunctionLength: number;
  averageFunctionLength: number;
  score: number; // 0-100, higher is worse
  severity: 'low' | 'medium' | 'high';
}

export class ComplexityCalculator {
  /**
   * Calculate all complexity metrics for given code
   */
  calculateMetrics(code: string, language: 'javascript' | 'typescript' | 'python'): ComplexityMetrics {
    const lines = code.split('\n');
    const linesOfCode = this.countLinesOfCode(lines);
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(code, language);
    const cognitiveComplexity = this.calculateCognitiveComplexity(code, language);
    const nestingDepth = this.calculateMaxNestingDepth(code);
    const functions = this.extractFunctions(code, language);
    const functionCount = functions.length;
    const functionLengths = functions.map(f => f.length);
    const maxFunctionLength = functionLengths.length > 0 ? Math.max(...functionLengths) : 0;
    const averageFunctionLength = functionLengths.length > 0
      ? Math.round(functionLengths.reduce((a, b) => a + b, 0) / functionLengths.length)
      : 0;

    // Calculate overall score (0-100, higher is worse)
    const score = this.calculateScore(
      cyclomaticComplexity,
      cognitiveComplexity,
      nestingDepth,
      maxFunctionLength,
      linesOfCode
    );

    return {
      cyclomaticComplexity,
      cognitiveComplexity,
      linesOfCode,
      nestingDepth,
      functionCount,
      maxFunctionLength,
      averageFunctionLength,
      score,
      severity: this.getSeverity(score)
    };
  }

  /**
   * Calculate cyclomatic complexity (decision points in code)
   * Counts: if, else if, for, while, do, case, catch, ?:, ||, &&
   */
  private calculateCyclomaticComplexity(code: string, language: string): number {
    let complexity = 1; // Base complexity

    // Count decision points
    const decisionPatterns = [
      /\bif\s*\(/gm,
      /\belse\s+if\s*\(/gm,
      /\belse\b/gm,
      /\bfor\s*\(/gm,
      /\bwhile\s*\(/gm,
      /\bdo\b/gm,
      /\bcase\b/gm,
      /\bcatch\s*\(/gm,
      /\?(?!:)/gm, // Ternary operator (not part of ::)
      /\|\|/gm,
      /&&/gm
    ];

    for (const pattern of decisionPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    // For Python, also count try/except
    if (language === 'python') {
      const pyPatterns = [
        /\bif\s*:/gm,
        /\belif\s*:/gm,
        /\belse\s*:/gm,
        /\bfor\s+\w+\s+in\b/gm,
        /\bwhile\s*:/gm,
        /\btry\s*:/gm,
        /\bexcept\s*:/gm,
        /\bexcept\s+\w+\s*:/gm
      ];

      for (const pattern of pyPatterns) {
        const matches = code.match(pattern);
        if (matches) {
          complexity += matches.length;
        }
      }
    }

    return Math.max(1, complexity);
  }

  /**
   * Calculate cognitive complexity (mental burden of understanding code)
   * Similar to cyclomatic but weighs nested structures higher
   */
  private calculateCognitiveComplexity(code: string, _language: string): number {
    let complexity = 0;
    const lines = code.split('\n');
    let currentNestingLevel = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed === '') {
        continue;
      }

      // Track nesting level
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;

      const nestingDelta = openBraces - closeBraces;
      currentNestingLevel = Math.max(0, currentNestingLevel + nestingDelta);

      // Weight by nesting level
      const baseWeightPatterns = [
        { regex: /\bif\s*\(/, weight: 1 },
        { regex: /\belse\s+if\s*\(/, weight: 1 },
        { regex: /\bfor\s*\(/, weight: 1 },
        { regex: /\bwhile\s*\(/, weight: 1 },
        { regex: /\btry\s*\{/, weight: 1 },
        { regex: /\bcatch\s*\(/, weight: 1 },
        { regex: /\?(?!:)/, weight: 0.5 }, // Ternary lower weight
      ];

      for (const { regex, weight } of baseWeightPatterns) {
        const matches = trimmed.match(regex);
        if (matches) {
          // Nested decisions cost more
          const nestingMultiplier = 1 + (currentNestingLevel * 0.1);
          complexity += matches.length * weight * nestingMultiplier;
        }
      }
    }

    return Math.round(complexity);
  }

  /**
   * Calculate maximum nesting depth in code
   */
  private calculateMaxNestingDepth(code: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of code) {
      if (char === '{' || char === '[' || char === '(') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}' || char === ']' || char === ')') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }

    return maxDepth;
  }

  /**
   * Count logical lines of code (excluding comments and blank lines)
   */
  private countLinesOfCode(lines: string[]): number {
    let count = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
        continue;
      }

      count++;
    }

    return count;
  }

  /**
   * Extract function definitions from code
   */
  private extractFunctions(code: string, language: string): Array<{ name: string; length: number }> {
    const functions: Array<{ name: string; length: number }> = [];

    if (language === 'python') {
      // Python: def function_name(...)
      const pyFuncRegex = /def\s+(\w+)\s*\([^)]*\):/g;
      let match;

      while ((match = pyFuncRegex.exec(code)) !== null) {
        const funcName = match[1] || 'anonymous';
        const startPos = match.index + match[0].length;

        // Find the function body (indented code after def)
        const restOfCode = code.substring(startPos);
        const lines = restOfCode.split('\n');
        let funcLength = 0;
        const baseIndent = lines[0] ? lines[0].search(/\S/) : 0;

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const trimmed = line.trim();

          // Stop when we hit a line with same or less indentation (and not empty)
          if (trimmed && line.search(/\S/) <= baseIndent && baseIndent >= 0) {
            break;
          }

          funcLength++;
        }

        functions.push({ name: funcName, length: funcLength });
      }
    } else {
      // JavaScript/TypeScript: function name() {} or const name = () => {}
      const jsFuncRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{)/g;
      let match;

      while ((match = jsFuncRegex.exec(code)) !== null) {
        const funcName = match[1] || match[2] || match[3] || 'anonymous';
        const startPos = match.index + match[0].length;

        // Count lines until closing brace at same level
        const restOfCode = code.substring(startPos);
        let braceCount = 1;
        let funcLength = 1;

        for (const char of restOfCode) {
          if (char === '{') braceCount++;
          else if (char === '}') {
            braceCount--;
            if (braceCount === 0) break;
          }
          if (char === '\n') funcLength++;
        }

        functions.push({ name: funcName, length: funcLength });
      }
    }

    return functions;
  }

  /**
   * Calculate overall complexity score (0-100, higher is worse)
   */
  private calculateScore(
    cyclomaticComplexity: number,
    cognitiveComplexity: number,
    nestingDepth: number,
    maxFunctionLength: number,
    _linesOfCode: number
  ): number {
    let score = 0;

    // Cyclomatic complexity (0-40 points)
    // 1-5: 0 pts, 6-10: 10 pts, 11-15: 20 pts, 15+: 40 pts
    if (cyclomaticComplexity <= 5) score += 0;
    else if (cyclomaticComplexity <= 10) score += 10;
    else if (cyclomaticComplexity <= 15) score += 20;
    else score += 40;

    // Cognitive complexity (0-30 points)
    score += Math.min(30, Math.round(cognitiveComplexity * 2));

    // Nesting depth (0-20 points)
    // 1-3: 0 pts, 4-5: 5 pts, 6-7: 10 pts, 8+: 20 pts
    if (nestingDepth <= 3) score += 0;
    else if (nestingDepth <= 5) score += 5;
    else if (nestingDepth <= 7) score += 10;
    else score += 20;

    // Function length (0-10 points)
    // <50: 0 pts, 50-100: 5 pts, 100+: 10 pts
    if (maxFunctionLength >= 100) score += 10;
    else if (maxFunctionLength >= 50) score += 5;

    return Math.min(100, score);
  }

  /**
   * Determine severity level based on score
   */
  private getSeverity(score: number): 'low' | 'medium' | 'high' {
    if (score <= 30) return 'low';
    if (score <= 60) return 'medium';
    return 'high';
  }
}
