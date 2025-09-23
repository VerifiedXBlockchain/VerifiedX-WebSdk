import { Network } from '../constants';
import { VfxAddress } from '../types';
import { addressWithoutActivity } from '../utils';
import { BaseApiClient } from './base-api-client';

export class MediaApiClient extends BaseApiClient {
    constructor(network: Network) {
        super({ basePath: '/media', network: network });
    }

    public uploadAsset = async (file: File, metadata?: Record<string, string>): Promise<string | null> => {
        const formData = new FormData();
        formData.append('file', file);

        if (metadata) {
            for (const key in metadata) {
                if (metadata.hasOwnProperty(key)) {
                    formData.append(key, metadata[key]);
                }
            }
        }

        try {
            const result = await this.makeMultipartRequest('/', formData);
            return result;
        } catch (error) {
            console.error('Upload failed:', error);
            return null;
        }
    }
}