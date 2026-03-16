import { describe, it, expect } from 'vitest';
import { sanitizeUniversalResponse } from '../../src/policy/sanitize.js';

describe('sanitizeUniversalResponse', () => {
  it('returns error sentinel for null', () => {
    const result = sanitizeUniversalResponse(null);
    expect(result).toEqual({ success: false, error: 'Empty response from tool handler' });
  });

  it('returns error sentinel for undefined', () => {
    const result = sanitizeUniversalResponse(undefined);
    expect(result).toEqual({ success: false, error: 'Empty response from tool handler' });
  });

  it('wraps a primitive string', () => {
    const result = sanitizeUniversalResponse('hello');
    expect(result).toHaveProperty('value', 'hello');
  });

  it('wraps a primitive number', () => {
    const result = sanitizeUniversalResponse(42);
    expect(result).toHaveProperty('value', 42);
  });

  it('wraps a boolean', () => {
    const result = sanitizeUniversalResponse(true);
    expect(result).toHaveProperty('value', true);
  });

  it('sanitizes a plain object and returns its fields', () => {
    const input = { success: true, message: 'ok' };
    const result = sanitizeUniversalResponse(input);
    expect(result.success).toBe(true);
    expect(result.message).toBe('ok');
  });

  it('strips sessionId from object (sensitive field)', () => {
    const input = { success: true, sessionId: 'abc123', message: 'ok' };
    const result = sanitizeUniversalResponse(input);
    expect(result).not.toHaveProperty('sessionId');
    expect(result.message).toBe('ok');
  });

  it('strips userId from object (sensitive field)', () => {
    const input = { userId: 'u_99', data: 'safe' };
    const result = sanitizeUniversalResponse(input);
    expect(result).not.toHaveProperty('userId');
    expect(result.data).toBe('safe');
  });

  it('returns array as { items: [...] }', () => {
    const input = ['a', 'b', 'c'];
    const result = sanitizeUniversalResponse(input);
    expect(result).toHaveProperty('items');
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('recursively sanitizes object elements inside arrays', () => {
    const input = [{ sessionId: 'x', value: 1 }, { sessionId: 'y', value: 2 }];
    const result = sanitizeUniversalResponse(input);
    const items = result.items as Array<Record<string, unknown>>;
    expect(items[0]).not.toHaveProperty('sessionId');
    expect(items[0]).toHaveProperty('value', 1);
    expect(items[1]).not.toHaveProperty('sessionId');
  });

  it('passes through non-object array elements unchanged', () => {
    const input = [1, 'two', true];
    const result = sanitizeUniversalResponse(input);
    const items = result.items as unknown[];
    expect(items).toEqual([1, 'two', true]);
  });

  it('strips stack traces in non-development environments', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const input = { success: false, error: 'boom', stack: 'Error\n  at foo.ts:1' };
      const result = sanitizeUniversalResponse(input);
      expect(result).not.toHaveProperty('stack');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('preserves stack traces in development environments', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const input = { success: false, error: 'boom', stack: 'Error\n  at foo.ts:1' };
      const result = sanitizeUniversalResponse(input);
      expect(result).toHaveProperty('stack');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('strips details containing originalError in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const input = {
        success: false,
        details: { originalError: 'DB connection failed', stack: 'at pg.ts:10' },
      };
      const result = sanitizeUniversalResponse(input);
      expect(result).not.toHaveProperty('details');
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
