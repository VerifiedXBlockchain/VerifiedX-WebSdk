import { DOMAIN_PURCHASE_COST, Network, TxType } from "../constants";
import { RawTransactionService } from "../services/raw-transaction-service";
import { Keypair } from "../types";
import { cleanVfxDomain, domainWithoutSuffix, isValidVfxDomain } from "../utils";
import { AddressApiClient } from "./address-api-client";



export class VfxClient {

    private network: Network;
    private dryRun: boolean;

    constructor(network: Network, dryRun = false) {
        this.network = network
        this.dryRun = dryRun;
    }

    public sendCoin = async (keypair: Keypair, toAddress: string, amount: number): Promise<string | null> => {
        const txBuilder = new RawTransactionService({ network: this.network, keypair: keypair, toAddress: toAddress, amount: amount })
        return await txBuilder.process(this.dryRun);
    }

    public buyVfxDomain = async (keypair: Keypair, domain: string): Promise<string | null> => {

        domain = cleanVfxDomain(domain);

        if (!isValidVfxDomain(domain)) {
            throw new Error(`Invalid vfx domain: ${domain}`);
        }

        const addressApiClient = new AddressApiClient(this.network);

        const addressDetails = await addressApiClient.getAddressDetails(keypair.address);
        if (addressDetails && addressDetails.adnr != null) {
            throw new Error(`Address already has a domain: ${addressDetails.adnr}`);
        }

        const available = await addressApiClient.domainAvailable(domain);

        if (!available) {
            throw new Error(`Domain already exists: ${domain}`);
        }

        const data = {
            "Function": "AdnrCreate()",
            "Name": domainWithoutSuffix(domain),
        }

        const txBuilder = new RawTransactionService({
            network: this.network,
            keypair: keypair,
            toAddress: "Adnr_Base",
            amount: DOMAIN_PURCHASE_COST,
            txType: TxType.Adnr,
            data: data,
        });

        return await txBuilder.process(this.dryRun);
    }

}