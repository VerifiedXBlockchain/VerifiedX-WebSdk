import { Network } from '../constants';
import { BaseApiClient } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

/** What the media endpoint returns for a stored file. */
export interface MediaUploadResult {
  url: string;
}

export class MediaApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/media', network: network, ...options });
  }

  /** Upload a file. Resolves to `{ url }` of the stored asset, or null on any failure. */
  public uploadAsset = async (file: File, metadata?: Record<string, string>): Promise<MediaUploadResult | null> => {
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
      const result: MediaUploadResult = await this.makeMultipartRequest('/', formData);
      return result;
    } catch (error) {
      return null;
    }
  };
}
