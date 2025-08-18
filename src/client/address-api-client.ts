import { Network } from "../constants";
import { VfxAddress } from "../types";
import { BaseApiClient } from "./base-api-client";


export class AddressApiClient extends BaseApiClient {
    constructor(network: Network) {
        super({ basePath: '/addresses', network: network });
    }

    public getAddressDetails = async (address: string): Promise<VfxAddress | null> => {

        try {
            const result = await this.makeJsonRequest(`/${address}`);

            if (result) {

                const address: VfxAddress = {
                    address: result.address,
                    balance: result.balance,
                    balanceTotal: result.balance_total,
                    balanceLocked: result.balance_locked,
                    adnr: result.adnr,
                    activated: result.activated
                }

                return address;
            }

            return null;
        } catch (e) {
            return null;
        }

    }

    public domainAvailable = async (domain: string): Promise<boolean> => {
        try {
            await this.makeJsonRequest(`/adnr/${domain}/`);
            return false;
        } catch (e) {
            return true;
        }
    }

    public lookupDomain = async (domain: string): Promise<string | null> => {
        try {
            const result = await this.makeJsonRequest(`/adnr/${domain}/`);
            return result?.address || null;
        } catch (e) {
            return null;
        }
    }

}