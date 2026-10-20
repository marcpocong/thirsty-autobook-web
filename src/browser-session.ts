import { createHash } from 'node:crypto';

/**
 * Opaque identity of one launch of a dedicated Chrome: a short hash of the CDP browser target id in
 * /json/version's webSocketDebuggerUrl, which Chrome generates anew on every launch. Evidence collected in one browser
 * process (a pre-release security check) can then be shown not to describe a later process on the same port. The raw
 * id is never stored or logged.
 */
export function browserSessionId(webSocketDebuggerUrl: unknown): string | null {
  if (typeof webSocketDebuggerUrl !== 'string') return null;
  const match = /\/devtools\/browser\/([0-9a-f-]{8,64})$/i.exec(webSocketDebuggerUrl);
  return match ? createHash('sha256').update(match[1]!.toLowerCase()).digest('hex').slice(0, 16) : null;
}

/** The session identity of the Chrome listening on this loopback debugging port, or null when none answers. */
export async function probeBrowserSessionId(port: number, timeoutMs = 1_200): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    const body = await response.json() as { webSocketDebuggerUrl?: unknown };
    return response.ok ? browserSessionId(body.webSocketDebuggerUrl) : null;
  } catch { return null; }
}
