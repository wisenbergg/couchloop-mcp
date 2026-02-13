import { describe, it, expect } from 'vitest';
import {
  stripHtml,
  escapeHtml,
  stripNullBytes,
  sanitizeText,
  sanitizeCode,
  validateRedirectUri,
} from '../../src/utils/inputSanitize.js';

describe('stripHtml', () => {
  it('removes simple HTML tags', () => {
    expect(stripHtml('<b>bold</b>')).toBe('bold');
  });

  it('removes script tags and content markers', () => {
    expect(stripHtml('<script>alert("xss")</script>')).toBe('alert("xss")');
  });

  it('removes nested tags', () => {
    expect(stripHtml('<div><p>text</p></div>')).toBe('text');
  });

  it('preserves text without tags', () => {
    expect(stripHtml('plain text')).toBe('plain text');
  });

  it('handles self-closing tags', () => {
    expect(stripHtml('before<br/>after')).toBe('beforeafter');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello" \'world\'')).toBe('&quot;hello&quot; &#x27;world&#x27;');
  });

  it('handles combined entities', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('stripNullBytes', () => {
  it('removes null bytes', () => {
    expect(stripNullBytes('hello\0world')).toBe('helloworld');
  });

  it('removes multiple null bytes', () => {
    expect(stripNullBytes('\0\0abc\0')).toBe('abc');
  });

  it('returns clean strings unchanged', () => {
    expect(stripNullBytes('clean')).toBe('clean');
  });
});

describe('sanitizeText', () => {
  it('strips null bytes and HTML', () => {
    expect(sanitizeText('hello\0<b>world</b>')).toBe('helloworld');
  });

  it('enforces default max length (10000)', () => {
    const long = 'a'.repeat(20000);
    expect(sanitizeText(long).length).toBe(10000);
  });

  it('enforces custom max length', () => {
    expect(sanitizeText('abcdefgh', 5)).toBe('abcde');
  });

  it('preserves normal text under limit', () => {
    expect(sanitizeText('hello world')).toBe('hello world');
  });

  it('handles XSS payloads', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)>')).toBe('');
  });
});

describe('sanitizeCode', () => {
  it('strips null bytes but preserves HTML-like syntax', () => {
    expect(sanitizeCode('<div>\0</div>')).toBe('<div></div>');
  });

  it('enforces default max length (100000)', () => {
    const long = 'x'.repeat(200000);
    expect(sanitizeCode(long).length).toBe(100000);
  });

  it('preserves code with angle brackets', () => {
    const code = 'const x = a < b ? c : d;';
    expect(sanitizeCode(code)).toBe(code);
  });
});

describe('validateRedirectUri', () => {
  const allowedUris = [
    'https://app.example.com/callback',
    'http://localhost:3000/auth',
  ];

  it('accepts a URI in the allow-list', () => {
    expect(validateRedirectUri('https://app.example.com/callback', allowedUris))
      .toBe('https://app.example.com/callback');
  });

  it('accepts localhost URIs if allowed', () => {
    expect(validateRedirectUri('http://localhost:3000/auth', allowedUris))
      .toBe('http://localhost:3000/auth');
  });

  it('rejects URIs not in the allow-list', () => {
    expect(validateRedirectUri('https://evil.com/steal', allowedUris)).toBeNull();
  });

  it('rejects non-http(s) schemes', () => {
    expect(validateRedirectUri('javascript:alert(1)', allowedUris)).toBeNull();
    expect(validateRedirectUri('ftp://example.com', allowedUris)).toBeNull();
  });

  it('rejects malformed URIs', () => {
    expect(validateRedirectUri('not-a-url', allowedUris)).toBeNull();
  });

  it('rejects open redirect via path manipulation', () => {
    expect(validateRedirectUri('https://app.example.com/callback/../evil', allowedUris)).toBeNull();
  });

  it('rejects when allowed list is empty', () => {
    expect(validateRedirectUri('https://app.example.com/callback', [])).toBeNull();
  });
});
