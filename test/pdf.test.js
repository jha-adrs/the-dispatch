import { describe, it, expect } from 'vitest';
import { renderMarkdownToPdf } from '../src/pdf.js';

const fixture = `# Sample Dispatch

**Date:** 2026-04-22
**TL;DR:** This is a short summary to verify the PDF renders without throwing.

## Section One

Paragraph body with **bold** and _italic_ and a [link](https://example.com).

- bullet one
- bullet two with a longer trailing clause that should wrap across the page
  width because the PDF renderer has a hard maximum text width of MAX_W

### Subsection

Another paragraph.

> A blockquote line in italic muted color.

\`\`\`
const code = 'monospace block';
\`\`\`

## Sources

1. https://example.com — example
`;

describe('renderMarkdownToPdf', () => {
  it('produces a non-empty PDF byte array', async () => {
    const bytes = await renderMarkdownToPdf(fixture, { title: 'Sample Dispatch' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('handles empty-ish input without throwing', async () => {
    const bytes = await renderMarkdownToPdf('# Just a title\n\nbody.', { title: 'x' });
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('renders unicode characters (₹, em-dash, arrows) without throwing', async () => {
    const unicode = `# Markets — 22 April

**TL;DR:** FII outflow ₹3,200 cr; DII inflow ₹2,100 cr. Nifty → 24,250.

## Key Findings

- Breadth: ~150 advances ← 300 declines. Sectoral leaders: auto, pharma.
- RBI flagged inflation risks; "food inflation remains sticky" — governor.
- Indian rupee traded around ₹83.5/USD; crude ≈ \$87.
`;
    const bytes = await renderMarkdownToPdf(unicode, { title: 'Markets — 22 April' });
    expect(bytes.length).toBeGreaterThan(500);
  });
});
