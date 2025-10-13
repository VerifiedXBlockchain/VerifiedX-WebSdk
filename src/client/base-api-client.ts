import { Network, VFX_API_BASE_URL_MAINNET, VFX_API_BASE_URL_TESTNET } from '../constants';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface IBaseApiClientOptions {
  network: Network;
  basePath?: string;
}

export class BaseApiClient {
  private network: Network;
  private basePath: string;

  constructor(options: IBaseApiClientOptions) {
    this.network = options.network;
    this.basePath = options?.basePath || '/';
  }

  private async _makeRequest(path: string, method: HttpMethod = 'GET', params: Record<string, unknown> = {}) {
    let url = `${this.network == Network.Testnet ? VFX_API_BASE_URL_TESTNET : VFX_API_BASE_URL_MAINNET}${
      this.basePath
    }${path}`;

    const init: RequestInit = {
      method,
    };

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
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  async makeJsonRequest(path: string, method: HttpMethod = 'GET', params: Record<string, unknown> = {}): Promise<any> {
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
    const url = `${this.network == Network.Testnet ? VFX_API_BASE_URL_TESTNET : VFX_API_BASE_URL_MAINNET}${
      this.basePath
    }${path}`;

    const response = await fetch(url, {
      method: 'POST',
      body: files,
      // Don't set Content-Type header for FormData - browser will set it with boundary
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
}
