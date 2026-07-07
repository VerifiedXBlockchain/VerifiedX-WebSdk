import { Network } from '../constants';
import { BaseApiClient } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

export class MediaApiClient extends BaseApiClient {
    constructor(network: Network, options: IApiClientOptions = {}) {
        super({ basePath: '/media', network: network, ...options });
    }

    public uploadAsset = async (file: File, metadata?: Record<string, string>): Promise<string | null> => {
        const formData = new FormData();
        formData.append('file', file);

        if (metadata) {
            for (const key in metadata) {
                if (Object.prototype.hasOwnProperty.call(metadata, key)) {
                    formData.append(key, metadata[key]);
                }
            }
        }

        try {
            const result = await this.makeMultipartRequest('/', formData);
            return result;
        } catch (error) {
            return null;
        }
    }
}