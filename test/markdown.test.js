import { describe, it, expect } from 'vitest';
import { validate, extractTitle, extractTldr, extractSources, wordCount } from '../src/markdown.js';

const sample = `# Indian equity markets close — 22 April

**Date:** 2026-04-22
**TL;DR:** Nifty closed at 24,250, down 0.8% on weaker IT earnings and
broad-based selling in midcaps.

## Key Findings

- Nifty 24,250 (-0.8%), Sensex 79,980 (-0.9%). Breadth negative.
- TCS Q4 miss: revenue $7.4B vs $7.6B consensus. See https://example.com/tcs-q4.
- FII net outflow ₹3,200 cr; DII absorbed ₹2,100 cr.

## Sources

1. https://www.bseindia.com — exchange close data
2. https://example.com/tcs-q4 — TCS Q4 release
`;

describe('validate', () => {
  it('accepts a well-formed briefing', () => {
    expect(validate(sample).ok).toBe(true);
  });
  it('rejects empty body', () => {
    expect(validate('').ok).toBe(false);
  });
  it('rejects missing # title', () => {
    expect(validate('No heading here\n**TL;DR:** x').ok).toBe(false);
  });
  it('rejects missing TL;DR marker', () => {
    expect(validate('# Title\n\nbody').ok).toBe(false);
  });
  it('accepts unicode titles', () => {
    const md = '# 市场收盘 — 日报\n\n**TL;DR:** ok.\n';
    expect(validate(md).ok).toBe(true);
  });
});

describe('extractTitle', () => {
  it('returns the # line text', () => {
    expect(extractTitle(sample)).toBe('Indian equity markets close — 22 April');
  });
  it('returns null when absent', () => {
    expect(extractTitle('no title')).toBeNull();
  });
});

describe('extractTldr', () => {
  it('captures multi-line TL;DR up to blank line', () => {
    const out = extractTldr(sample);
    expect(out).toMatch(/^Nifty closed at 24,250/);
    expect(out).toMatch(/broad-based selling in midcaps\.$/);
  });
  it('returns null when marker missing', () => {
    expect(extractTldr('# Title\nbody')).toBeNull();
  });
});

describe('extractSources', () => {
  it('dedupes URLs found in body', () => {
    const urls = extractSources(sample);
    expect(urls).toContain('https://www.bseindia.com');
    expect(urls).toContain('https://example.com/tcs-q4');
    expect(urls.length).toBe(2);
  });
});

describe('wordCount', () => {
  it('ignores fenced code and punctuation', () => {
    const md = '# Hi\n\n**TL;DR:** one two three.\n\n```\nignored ignored\n```\n';
    expect(wordCount(md)).toBeGreaterThanOrEqual(5);
    expect(wordCount(md)).toBeLessThan(10);
  });
});
