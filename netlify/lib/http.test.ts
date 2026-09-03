import { describe, expect, it } from 'vitest';
import { BadRequest, optionalHttpUrl, sanitizeHttpUrl } from './http';

describe('sanitizeHttpUrl', () => {
  it('keeps http and https links', () => {
    expect(sanitizeHttpUrl('https://example.com/post')).toBe('https://example.com/post');
    expect(sanitizeHttpUrl('http://example.com')).toBe('http://example.com/');
  });

  it('drops schemes that execute when put in an href', () => {
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeHttpUrl('data:text/html,<script>')).toBeUndefined();
    expect(sanitizeHttpUrl('not a url')).toBeUndefined();
  });
});

describe('optionalHttpUrl', () => {
  it('rejects rather than silently dropping what a person typed', () => {
    expect(() => optionalHttpUrl('javascript:alert(1)', 'externalUrl')).toThrow(BadRequest);
  });

  it('treats an empty field as absent', () => {
    expect(optionalHttpUrl('', 'externalUrl')).toBeUndefined();
    expect(optionalHttpUrl(undefined, 'externalUrl')).toBeUndefined();
  });
});
