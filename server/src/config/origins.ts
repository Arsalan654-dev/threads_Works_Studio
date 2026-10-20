/**
 * Which browser origins may call the API.
 *
 * Locally the answer is "loopback, any port" - the editor and API are two
 * processes on the same machine. Hosted, the editor lives on Vercel while the
 * API lives on Railway, so the Vercel origin has to be named in
 * `CORS_ORIGINS`. A `*.` entry allows any subdomain, which is useful for
 * Vercel's per-deployment preview URLs.
 *
 * This is CORS, not authentication: it stops another web page from quietly
 * writing to the API with the visitor's browser, but a command-line client can
 * still reach a public server. Keep the design data itself non-sensitive or
 * put the API behind a private network/token.
 */

/** True for a browser page served from this machine. */
function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** Strip a trailing slash so `https://x.dev/` and `https://x.dev` agree. */
function normalize(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/**
 * Does `origin` match one of the configured entries?
 *
 * Entries are exact origins (`https://studio.vercel.app`) or scheme + wildcard
 * host (`https://*.vercel.app`). A wildcard matches the base host and any
 * subdomain, never a different suffix - `https://evil-vercel.app` does not
 * match `https://*.vercel.app`.
 */
export function isOriginAllowed(origin: string, allowed: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (isLoopbackHostname(parsed.hostname)) return true;

  const candidate = normalize(origin);

  for (const raw of allowed) {
    const entry = raw.trim();
    if (entry.length === 0) continue;

    if (normalize(entry) === candidate) return true;

    const wildcard = /^(https?):\/\/\*\.([^/:]+)(?::(\d+))?$/.exec(entry);
    if (!wildcard) continue;

    const scheme = wildcard[1];
    const baseHost = wildcard[2]!.toLowerCase();
    const port = wildcard[3];
    if (parsed.protocol !== `${scheme}:`) continue;
    if ((parsed.port || '') !== (port ?? '')) continue;
    const host = parsed.hostname.toLowerCase();
    if (host === baseHost || host.endsWith(`.${baseHost}`)) return true;
  }

  return false;
}
