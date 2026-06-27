import { describe, expect, it } from 'vitest';

import { BloatDetector } from '../../src/developer/analyzers/bloat-detector.js';

function findOverAbstractionIssue(
  code: string,
  symbolName: string
): ReturnType<BloatDetector['analyze']>['issues'][number] | undefined {
  const detector = new BloatDetector();
  const result = detector.analyze(code, 'typescript');

  return result.issues.find(
    (issue) => issue.type === 'over_abstraction' && issue.pattern.includes(`"${symbolName}"`)
  );
}

describe('BloatDetector detectOverAbstraction', () => {
  it('marks function declarations called once as used only once', () => {
    const code = `
      function helper() {
        return 1;
      }

      const value = helper();
      void value;
    `;

    const issue = findOverAbstractionIssue(code, 'helper');

    expect(issue).toBeDefined();
    expect(issue?.pattern).toContain('used only once');
  });

  it('marks arrow functions called once as used only once', () => {
    const code = `
      const normalize = (value: string) => value.trim();

      const output = normalize('  hi  ');
      void output;
    `;

    const issue = findOverAbstractionIssue(code, 'normalize');

    expect(issue).toBeDefined();
    expect(issue?.pattern).toContain('used only once');
  });

  it('marks unused functions as not used', () => {
    const code = `
      function orphan() {
        return 'x';
      }
    `;

    const issue = findOverAbstractionIssue(code, 'orphan');

    expect(issue).toBeDefined();
    expect(issue?.pattern).toContain('not used');
  });

  it('does not treat non-function const values as callable abstractions', () => {
    const code = `
      const config = { retries: 3 };

      function run() {
        return config.retries;
      }

      run();
    `;

    const configIssue = findOverAbstractionIssue(code, 'config');

    expect(configIssue).toBeUndefined();
  });
});
