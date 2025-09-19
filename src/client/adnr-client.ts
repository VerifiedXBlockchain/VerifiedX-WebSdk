import { Network } from "../constants";
import { BaseApiClient } from "./base-api-client";




export class AdnrApiClient extends BaseApiClient {
    constructor(network: Network) {
        super({ basePath: '/adnr', network: network });
    }

    public lookupBtcDomain = async (domain: string): Promise<string | null> => {
        try {
            const result = await this.makeJsonRequest(`/${domain}/`);
            return result?.btc_address || null;
        } catch (e) {
            return null;
        }
    }

}