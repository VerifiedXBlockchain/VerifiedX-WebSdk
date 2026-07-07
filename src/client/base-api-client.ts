import { Network, VFX_API_BASE_URL_MAINNET, VFX_API_BASE_URL_TESTNET } from '../constants';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Error thrown for non-2xx API responses (and surfaced for request
 * failures). `status` is the HTTP status when one was received, undefined
 * for transport-level failures. The message keeps the historical
 * "HTTP error! status: X" prefix so existing string matching keeps working.
 */
export class VfxApiError extends Error {
  readonly status: number | undefined;
  readonly url: string;
  readonly body: string | undefined;

  constructor(options: { status?: number; url: string; body?: string }) {
    const bodySnippet = options.body ? ` — ${options.body.slice(0, 300)}` : '';
    super(`HTTP error! status: ${options.status ?? 'network failure'} (${options.url})${bodySnippet}`);
    this.name = 'VfxApiError';
    this.status = options.status;
    this.url = options.url;
    this.body = options.body;
  }
}

export interface IBaseApiClientOptions {
  network: Network;
  basePath?: string;
  /** Override the network-derived API origin, e.g. a self-hosted data node. */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to 30s; pass 0 to disable. */
  timeoutMs?: number;
}

export class BaseApiClient {
  private network: Network;
  private basePath: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: IBaseApiClientOptions) {
    this.network = options.network;
    this.basePath = options?.basePath || '/';
    this.baseUrl =
      options.baseUrl ?? (this.network == Network.Testnet ? VFX_API_BASE_URL_TESTNET : VFX_API_BASE_URL_MAINNET);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private timeoutSignal(): AbortSignal | undefined {
    if (!this.timeoutMs) return undefined;
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
    return AbortSignal.timeout(this.timeoutMs);
  }

  private async _makeRequest(path: string, method: HttpMethod = 'GET', params: Record<string, unknown> = {}) {
    let url = `${this.baseUrl}${this.basePath}${path}`;

    const init: RequestInit = {
      method,
    };
    const signal = this.timeoutSignal();
    if (signal) {
      init.signal = signal;
    }

    if (method === 'GET') {
      // Add query parameters to URL for GET requests
      if (Object.keys(params).length > 0) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          searchParams.append(key, String(value));
        });
        url = `${url}?${searchParams.toString()}`;
      }
    } else {
      // Set body and headers for other methods
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(params);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      let body: string | undefined;
      try {
        body = await response.text();
      } catch {
        body = undefined;
      }
      throw new VfxApiError({ status: response.status, url, body });
    }

    return response;
  }

  async makeJsonRequest<T = any>(path: string, method: HttpMethod = 'GET', params: Record<string, unknown> = {}): Promise<T> {
    const response = await this._makeRequest(path, method, params);
    return response.json();
  }

  async makeTextRequest(path: string, method: HttpMethod = 'GET', params: Record<string, unknown> = {}): Promise<string> {
    const response = await this._makeRequest(path, method, params);
    const text = await response.text();
    // Try to parse as JSON and stringify if successful, otherwise return as-is
    try {
      const json = JSON.parse(text);
      return JSON.stringify(json);
    } catch {
      return text;
    }
  }

  async makeBoolRequest(path: string, method: HttpMethod = 'GET', params: Record<string, unknown> = {}): Promise<boolean> {
    const text = await this.makeTextRequest(path, method, params);
    return text.trim() === 'true';
  }

  async makeMultipartRequest(path: string, files: FormData): Promise<any> {
    const url = `${this.baseUrl}${this.basePath}${path}`;

    // No default timeout here: large uploads on slow links can legitimately
    // exceed the JSON-request budget.
    const response = await fetch(url, {
      method: 'POST',
      body: files,
      // Don't set Content-Type header for FormData - browser will set it with boundary
    });

    if (!response.ok) {
      let body: string | undefined;
      try {
        body = await response.text();
      } catch {
        body = undefined;
      }
      throw new VfxApiError({ status: response.status, url, body });
    }

    return response.json();
  }
}
