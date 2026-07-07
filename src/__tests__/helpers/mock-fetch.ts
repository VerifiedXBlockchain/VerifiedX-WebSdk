/**
 * Shared fetch mocking for unit tests.
 *
 * installFetch({'/url/substring/': handler}) replaces global.fetch with a
 * router that matches the first handler whose pattern is a substring of the
 * requested URL. Handlers may return a plain value (JSON-encoded at 200), or
 * a Response for full control. Every request is captured in `calls` for
 * assertion. Unmatched URLs throw, so tests fail loudly on unexpected
 * network activity.
 */

export type FetchHandler = (url: string, init?: RequestInit) => unknown;

export interface CapturedCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  rawBody: string | null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

function parseBody(init?: RequestInit): { parsed: Record<string, unknown> | null; raw: string | null } {
  if (!init?.body) return { parsed: null, raw: null };
  const raw = init.body as string;
  try {
    return { parsed: JSON.parse(raw), raw };
  } catch {
    return { parsed: null, raw };
  }
}

export function installFetch(handlers: Record<string, FetchHandler>): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { parsed, raw } = parseBody(init);
    calls.push({ url, method: init?.method ?? 'GET', body: parsed, rawBody: raw });

    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        const result = handler(url, init);
        if (result instanceof Response) return result;
        return jsonResponse(result);
      }
    }
    throw new Error(`No mock handler for URL: ${url}`);
  }) as unknown as typeof fetch;

  return { calls };
}
