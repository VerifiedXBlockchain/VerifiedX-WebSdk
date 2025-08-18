import axios, { AxiosRequestConfig, Method } from 'axios';
import { Network, VFX_API_BASE_URL_MAINNET, VFX_API_BASE_URL_TESTNET } from '../constants';

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

    private async _makeRequest(
        path: string,
        method: Method = 'GET',
        params: Record<string, any> = {}
    ) {
        const url = `${this.network == Network.Testnet ? VFX_API_BASE_URL_TESTNET : VFX_API_BASE_URL_MAINNET}${this.basePath}${path}`;
        let config: AxiosRequestConfig = {
            url,
            method,
        };

        if (method === 'GET') {
            config.params = params;
        } else {
            config.headers = { 'Content-Type': 'application/json' };
            config.data = params;
        }

        const response = await axios(config);


        return response;
    }

    async makeJsonRequest(
        path: string,
        method: Method = 'GET',
        params: Record<string, any> = {}
    ): Promise<any> {
        const response = await this._makeRequest(path, method, params);
        return response.data;
    }

    async makeTextRequest(
        path: string,
        method: Method = 'GET',
        params: Record<string, any> = {}
    ): Promise<string> {
        const response = await this._makeRequest(path, method, params);
        return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    }

    async makeBoolRequest(
        path: string,
        method: Method = 'GET',
        params: Record<string, any> = {}
    ): Promise<boolean> {
        const text = await this.makeTextRequest(path, method, params);
        return text.trim() === 'true';
    }

    async makeMultipartRequest(
        path: string,
        files: FormData
    ): Promise<any> {
        const url = `${this.network == Network.Testnet ? VFX_API_BASE_URL_TESTNET : VFX_API_BASE_URL_MAINNET}${this.basePath}${path}`;

        const response = await axios.post(url, files, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        return response.data;
    }
}