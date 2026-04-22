import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildNotifier } from '../src/notify.js';

const report = {
  id: '20260422T120650Z_markets',
  url: 'http://t/report/20260422T120650Z_markets',
  slug: 'markets',
  title: 'Markets close 22 Apr — RBI focus ₹',
  summary: 'Nifty closed 24,250, down 0.8% — governor flagged food inflation.',
  word_count: 1234,
};

afterEach(() => vi.restoreAllMocks());

describe('buildNotifier', () => {
  it('is a no-op when url is not set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const n = buildNotifier({});
    expect(n.enabled).toBe(false);
    await n.notify(report);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ntfy: sanitizes non-ASCII in Title header, preserves unicode in body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
    const n = buildNotifier({ url: 'http://x/topic', type: 'ntfy' });
    await n.notify(report);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://x/topic');
    expect(opts.method).toBe('POST');
    // Title header must be pure ASCII
    expect(opts.headers.Title.trim()).toBe('markets: Markets close 22 Apr - RBI focus INR');
    expect(opts.headers.Title).toMatch(/^[\x20-\x7E]*$/);
    // Click header → report URL for deep-linking from the push
    expect(opts.headers.Click).toBe(report.url);
    // Body preserves unicode
    expect(opts.body).toContain('—');
  });

  it('discord: JSON embed with title, description, URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
    const n = buildNotifier({ url: 'http://x/discord', type: 'discord' });
    await n.notify(report);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe(report.title);
    expect(body.embeds[0].url).toBe(report.url);
    expect(body.embeds[0].description).toBe(report.summary);
  });

  it('slack: text body with link to report', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
    const n = buildNotifier({ url: 'http://x/slack', type: 'slack' });
    await n.notify(report);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.text).toContain(report.url);
    expect(body.text).toContain(report.title);
  });

  it('generic: full JSON of report metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
    const n = buildNotifier({ url: 'http://x/hook', type: 'generic' });
    await n.notify(report);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({
      id: report.id, url: report.url, slug: report.slug,
      title: report.title, summary: report.summary, word_count: report.word_count,
    });
  });

  it('merges extra headers from NOTIFY_WEBHOOK_HEADERS JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
    const n = buildNotifier({
      url: 'http://x/hook', type: 'generic',
      headersJson: '{"Authorization":"Bearer abc","X-Tag":"dispatch"}',
    });
    await n.notify(report);
    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer abc');
    expect(headers['X-Tag']).toBe('dispatch');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('swallows fetch errors — save flow must not break on notify failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const n = buildNotifier({ url: 'http://x/hook' });
    await expect(n.notify(report)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
