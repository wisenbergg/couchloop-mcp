/**
 * Tests for pre_review_code tool
 */

import { describe, it, expect } from 'vitest';
import { handlePreReviewCode } from '../../src/tools/pre-review-code.js';
import { ReviewAssistant } from '../../src/developer/scanners/review-assistant.js';
import { ReviewSummaryGenerator } from '../../src/developer/reports/review-summary.js';

describe('ReviewAssistant Scanner', () => {
  it('should detect console.log statements', () => {
    const code = `
      function getUserData(id: string) {
        console.log('Fetching user:', id);
        const user = fetchUser(id);
        return user;
      }
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'console_log')).toBe(true);
    expect(result.issuesByType.console_log).toBeGreaterThan(0);
  });

  it('should detect commented code', () => {
    const code = `
      function process() {
        // const oldFunction = () => { return 42; }
        const newResult = calculate();
        return newResult;
      }
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'commented_code')).toBe(true);
  });

  it('should detect TODO items', () => {
    const code = `
      function validateEmail(email: string) {
        // TODO: Add regex validation
        return email.includes('@');
      }
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'todo')).toBe(true);
  });

  it('should detect FIXME items', () => {
    const code = `
      async function fetchData() {
        // FIXME: This endpoint is deprecated
        return await fetch('http://old-api.com/data');
      }
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'fixme')).toBe(true);
  });

  it('should detect missing error handling on fetch', () => {
    const code = `
      fetch(url).then(res => res.json());
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'missing_error_handling')).toBe(true);
  });

  it('should detect hardcoded API keys', () => {
    const code = `
      const apiKey = 'sk-12345abcdef';
      const response = await fetch('https://api.example.com', {
        headers: { Authorization: apiKey }
      });
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'hardcoded_value')).toBe(true);
  });

  it('should detect unreachable code', () => {
    const code = `
      function example() {
        return 42;
        console.log('This is unreachable');
      }
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'unreachable_code')).toBe(true);
  });

  it('should detect nested complexity', () => {
    const code = `
      if (condition1) {
        if (condition2) {
          if (condition3) {
            if (condition4) {
              console.log('Deep nesting');
            }
          }
        }
      }
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    expect(result.issues.some(i => i.type === 'nested_complexity')).toBe(true);
  });

  it('should return clean summary for good code', () => {
    const code = `
      async function getUserData(id: string): Promise<User> {
        try {
          const response = await fetch(\`/api/users/\${id}\`);
          if (!response.ok) {
            throw new Error('Failed to fetch user');
          }
          return await response.json();
        } catch (error) {
          console.error('Error fetching user:', error);
          throw error;
        }
      }
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const result = scanner.scan();

    // Should have minimal or no critical issues
    expect(result.issuesBySeverity.high).toBeLessThanOrEqual(1); // Might flag the console.error, but that's acceptable
  });
});

describe('ReviewSummaryGenerator', () => {
  it('should generate summary with correct metrics', () => {
    const code = `
      console.log('debug');
      const API_KEY = 'sk-123456';
      fetch(url).then(res => res.json());
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const scanResult = scanner.scan();
    const generator = new ReviewSummaryGenerator(scanResult, code.split('\n').length);
    const summary = generator.generate();

    expect(summary.metrics.totalIssues).toBeGreaterThan(0);
    expect(summary.complexityScore).toBeLessThan(100);
    expect(summary.riskLevel).toBe('high');
    expect(summary.estimatedReviewTime).toBeGreaterThan(0);
  });

  it('should categorize issues properly', () => {
    const code = `
      console.log('debug');
      // const oldCode = () => {};
      fetch(url).then(res => res.json());
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const scanResult = scanner.scan();
    const generator = new ReviewSummaryGenerator(scanResult, code.split('\n').length);
    const summary = generator.generate();

    expect(summary.categoryGroups.length).toBeGreaterThan(0);
    expect(summary.categoryGroups.some(g => g.category === 'Debug Statements')).toBe(true);
  });

  it('should generate action items', () => {
    const code = `
      // TODO: Fix this
      const API_KEY = 'sk-123456';
    `;

    const scanner = new ReviewAssistant(code, 'typescript');
    const scanResult = scanner.scan();
    const generator = new ReviewSummaryGenerator(scanResult, code.split('\n').length);
    const summary = generator.generate();

    expect(summary.actionItems.length).toBeGreaterThan(0);
    expect(summary.actionItems.some(a => a.toLowerCase().includes('must') || a.toLowerCase().includes('should'))).toBe(true);
  });
});

describe('pre_review_code Tool', () => {
  it('should handle valid input', async () => {
    const input = {
      code: 'console.log("test");',
      language: 'typescript',
      strictness: 'medium',
      format: 'json'
    };

    const result = await handlePreReviewCode(input);

    expect(result).toHaveProperty('status', 'success');
    expect(result).toHaveProperty('metrics');
  });

  it('should return markdown format', async () => {
    const input = {
      code: 'console.log("test");',
      language: 'typescript',
      format: 'markdown'
    };

    const result = await handlePreReviewCode(input);

    expect(result).toHaveProperty('format', 'markdown');
    expect(result).toHaveProperty('content');
  });

  it('should return summary format', async () => {
    const input = {
      code: 'console.log("test");',
      language: 'typescript',
      format: 'summary'
    };

    const result = await handlePreReviewCode(input);

    expect(result).toHaveProperty('format', 'summary');
    expect(result).toHaveProperty('executiveSummary');
    expect(result).toHaveProperty('complexityScore');
  });

  it('should filter by strictness level', async () => {
    const code = `
      console.log('debug');
      const API_KEY = 'sk-123456';
      // const old = () => {};
    `;

    const resultLow = await handlePreReviewCode({
      code,
      language: 'typescript',
      strictness: 'low',
      format: 'json'
    }) as any;

    const resultMedium = await handlePreReviewCode({
      code,
      language: 'typescript',
      strictness: 'medium',
      format: 'json'
    }) as any;

    // 'low' strictness should have fewer or equal issues than 'medium'
    expect(resultLow.scan.totalIssues).toBeLessThanOrEqual(resultMedium.scan.totalIssues);
  });

  it('should handle validation errors', async () => {
    const input = {
      code: '', // Empty code should fail
      language: 'typescript'
    };

    const result = await handlePreReviewCode(input);

    expect(result).toHaveProperty('status', 'error');
  });

  it('should provide good code with few issues', async () => {
    const goodCode = `
      async function fetchUserData(userId: string): Promise<User> {
        try {
          const response = await fetch(\`/api/users/\${userId}\`);
          if (!response.ok) {
            throw new Error('Failed to fetch user');
          }
          return await response.json();
        } catch (error) {
          throw new Error(\`Error fetching user: \${error}\`);
        }
      }
    `;

    const result = await handlePreReviewCode({
      code: goodCode,
      language: 'typescript',
      format: 'summary'
    }) as any;

    expect(result.riskLevel).toBe('low');
    expect(result.metrics.codeQualityScore).toBeGreaterThan(70);
  });

  it('should provide comprehensive analysis for problematic code', async () => {
    const badCode = `
      console.log('Starting');
      // const config = { api: 'test' };
      const API_KEY = 'sk-1234567890';
      fetch('http://api.example.com/data').then(r => r.json());
      if (x) { if (y) { if (z) { TODO: fix this } } }
    `;

    const result = await handlePreReviewCode({
      code: badCode,
      language: 'typescript',
      format: 'summary'
    }) as any;

    expect(result.riskLevel).toBe('high');
    expect(result.metrics.criticalCount).toBeGreaterThan(0);
    expect(result.metrics.codeQualityScore).toBeLessThan(60);
  });
});
