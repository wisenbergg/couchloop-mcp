import { describe, it, expect } from 'vitest';
import {
  detectCodeInResponse,
  detectPackageRecommendationsInResponse,
  detectTechnicalClaimsInResponse,
  deriveVerifyMode,
} from '../../src/policy/classifiers.js';

// ─────────────────────────────────────────────────────────────────────────────
// detectCodeInResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCodeInResponse', () => {
  it('detects a fenced code block', () => {
    const result = { message: '```typescript\nconst x = 1;\n```' };
    expect(detectCodeInResponse(result)).toBe(true);
  });

  it('detects an import statement', () => {
    const result = { text: "import { foo } from 'bar'" };
    expect(detectCodeInResponse(result)).toBe(true);
  });

  it('detects a function declaration', () => {
    const result = { text: 'function handleRequest(req) { }' };
    expect(detectCodeInResponse(result)).toBe(true);
  });

  it('detects an arrow function with block body', () => {
    const result = { text: 'const fn = (x) => { return x; }' };
    expect(detectCodeInResponse(result)).toBe(true);
  });

  it('detects an await expression', () => {
    const result = { text: 'const data = await fetchData()' };
    expect(detectCodeInResponse(result)).toBe(true);
  });

  it('returns false for plain prose', () => {
    const result = {
      message: 'The server is running on port 3000. Please check the logs.',
    };
    expect(detectCodeInResponse(result)).toBe(false);
  });

  it('returns false for null', () => {
    expect(detectCodeInResponse(null)).toBe(false);
  });

  it('scans string values nested in arrays', () => {
    const result = { steps: ["import { x } from 'y'", 'run the server'] };
    expect(detectCodeInResponse(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectPackageRecommendationsInResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('detectPackageRecommendationsInResponse', () => {
  it('detects npm install command', () => {
    expect(detectPackageRecommendationsInResponse({ cmd: 'npm install lodash' })).toBe(true);
  });

  it('detects pip install command', () => {
    expect(detectPackageRecommendationsInResponse({ cmd: 'pip install requests' })).toBe(true);
  });

  it('detects yarn add command', () => {
    expect(detectPackageRecommendationsInResponse({ text: 'yarn add react' })).toBe(true);
  });

  it('detects pnpm add command', () => {
    expect(detectPackageRecommendationsInResponse({ text: 'pnpm add vitest' })).toBe(true);
  });

  it('detects third-party import statement', () => {
    expect(
      detectPackageRecommendationsInResponse({ text: "import express from 'express'" }),
    ).toBe(true);
  });

  it('detects dependencies block', () => {
    expect(
      detectPackageRecommendationsInResponse({ text: 'add it to devDependencies' }),
    ).toBe(true);
  });

  it('returns false for relative imports', () => {
    expect(
      detectPackageRecommendationsInResponse({ text: "import { foo } from './utils'" }),
    ).toBe(false);
  });

  it('returns false for plain prose', () => {
    expect(
      detectPackageRecommendationsInResponse({ text: 'The request was successful.' }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectTechnicalClaimsInResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('detectTechnicalClaimsInResponse', () => {
  it('detects a semver version number', () => {
    expect(detectTechnicalClaimsInResponse({ text: 'Use react v18.2.0 for this.' })).toBe(true);
  });

  it('detects "as of" phrasing', () => {
    expect(
      detectTechnicalClaimsInResponse({ text: 'As of Node 20, this API is stable.' }),
    ).toBe(true);
  });

  it('detects deprecated keyword', () => {
    expect(
      detectTechnicalClaimsInResponse({ text: 'This method is deprecated since v5.' }),
    ).toBe(true);
  });

  it('detects a percentage metric', () => {
    expect(
      detectTechnicalClaimsInResponse({ text: 'This reduces bundle size by 40%.' }),
    ).toBe(true);
  });

  it('detects "always" absolute claim', () => {
    expect(
      detectTechnicalClaimsInResponse({ text: 'This will always return a string.' }),
    ).toBe(true);
  });

  it('returns false for plain prose without claims', () => {
    expect(
      detectTechnicalClaimsInResponse({ text: 'The server started successfully.' }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveVerifyMode
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveVerifyMode', () => {
  it('code_review → always "code"', () => {
    expect(deriveVerifyMode('code_review', {})).toBe('code');
  });

  it('package_audit → always "packages"', () => {
    expect(deriveVerifyMode('package_audit', {})).toBe('packages');
  });

  it('code + packages detected → "all"', () => {
    const result = {
      text: "npm install lodash\nconst x = require('lodash')",
    };
    expect(deriveVerifyMode('brainstorm', result)).toBe('all');
  });

  it('code only detected → "code"', () => {
    const result = { text: 'function handleClick() { return true; }' };
    expect(deriveVerifyMode('brainstorm', result)).toBe('code');
  });

  it('packages only detected → "packages"', () => {
    const result = { text: 'Run: npm install express' };
    expect(deriveVerifyMode('brainstorm', result)).toBe('packages');
  });

  it('technical claims only → "all"', () => {
    const result = { text: 'This API is deprecated since v4.0.0.' };
    expect(deriveVerifyMode('brainstorm', result)).toBe('all');
  });

  it('plain prose → null (skip verify)', () => {
    const result = { text: 'Everything looks good. The server is running.' };
    expect(deriveVerifyMode('brainstorm', result)).toBe(null);
  });

  it('null result → null', () => {
    expect(deriveVerifyMode('brainstorm', null)).toBe(null);
  });
});
