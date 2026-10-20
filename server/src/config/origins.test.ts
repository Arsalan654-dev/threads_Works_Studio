import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from './origins.js';

describe('CORS origin matching', () => {
  it('always allows a loopback page, on any port', () => {
    expect(isOriginAllowed('http://127.0.0.1:5173', [])).toBe(true);
    expect(isOriginAllowed('http://localhost:4173', [])).toBe(true);
    expect(isOriginAllowed('https://localhost', [])).toBe(true);
  });

  it('refuses an origin that is not configured', () => {
    expect(isOriginAllowed('https://evil.example.com', ['https://studio.vercel.app'])).toBe(false);
    expect(isOriginAllowed('https://evil.example.com', [])).toBe(false);
  });

  it('allows an exact configured origin, with or without a trailing slash', () => {
    const allowed = ['https://studio.vercel.app'];
    expect(isOriginAllowed('https://studio.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://studio.vercel.app/', ['https://studio.vercel.app/'])).toBe(
      true,
    );
    expect(isOriginAllowed('http://studio.vercel.app', allowed)).toBe(false);
    expect(isOriginAllowed('https://studio.vercel.app:8443', allowed)).toBe(false);
  });

  it('allows a wildcard subdomain but not a lookalike suffix', () => {
    const allowed = ['https://*.vercel.app'];
    expect(isOriginAllowed('https://threadworks.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://team-threadworks.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil-vercel.app', allowed)).toBe(false);
    expect(isOriginAllowed('http://threadworks.vercel.app', allowed)).toBe(false);
  });

  it('rejects a malformed or non-http origin', () => {
    expect(isOriginAllowed('not a url', ['https://studio.vercel.app'])).toBe(false);
    expect(isOriginAllowed('file:///tmp/index.html', [])).toBe(false);
  });
});
