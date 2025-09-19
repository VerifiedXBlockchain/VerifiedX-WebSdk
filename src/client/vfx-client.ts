import { DOMAIN_PURCHASE_COST, Network, TxType } from "../constants";
import KeypairService from "../services/keypair-service";
import { RawTransactionService } from "../services/raw-transaction-service";
import { Keypair, PaginatedResponse, Transaction, VfxAddress } from "../types";
import { cleanVfxDomain, domainWithoutSuffix, isValidVfxDomain } from "../utils";
import { AddressApiClient } from "./address-api-client";
import { AdnrApiClient } from "./adnr-client";
import { TransactionApiClient } from "./transaction-api.client";



export class VfxClient {

    private network: Network;
    private dryRun: boolean;
    private keypairService: KeypairService;
    private addressApiClient: AddressApiClient;
    private adnrApiClient: AdnrApiClient;
    private transactionApiClient: TransactionApiClient;

    constructor(network: Network, dryRun = false) {
        this.network = network
        this.dryRun = dryRun;
        this.keypairService = new KeypairService(this.network);
        this.addressApiClient = new AddressApiClient(this.network);
        this.adnrApiClient = new AdnrApiClient(this.network);
        this.transactionApiClient = new TransactionApiClient(this.network);
    }


    // Keypairs
    public generatePrivateKey = (): string => {
        return this.keypairService.generatePrivateKey()
    }

    public generateMnemonic = (words: 12 | 24 = 12): string => {
        return this.keypairService.generateMnemonic(words);
    }

    public privateKeyFromMneumonic = (mnemonic: string, index: number): string => {
        return this.keypairService.privateKeyFromMneumonic(mnemonic, index);
    }

    public publicFromPrivate = (privateKey: string): string => {
        return this.keypairService.publicFromPrivate(privateKey);
    }

    public addressFromPrivate = (privateKey: string): string => {
        return this.keypairService.addressFromPrivate(privateKey);
    }

    public getSignature = (message: string, privateKey: string): string => {
        return this.keypairService.getSignature(message, privateKey);
    }

    // Explorer API
    public getAddressDetails = (address: string): Promise<VfxAddress | null> => {
        return this.addressApiClient.getAddressDetails(address);
    }

    public domainAvailable = (domain: string): Promise<boolean> => {
        return this.addressApiClient.domainAvailable(domain);
    }

    // Transactions
    public sendCoin = async (keypair: Keypair, toAddress: string, amount: number): Promise<string | null> => {
        const txBuilder = new RawTransactionService({ network: this.network, keypair: keypair, toAddress: toAddress, amount: amount })
        return await txBuilder.process(this.dryRun);
    }

    public lookupDomain = async (domain: string): Promise<string | null> => {
        return this.addressApiClient.lookupDomain(domain);
    }

    public lookupBtcDomain = async (domain: string): Promise<string | null> => {
        return this.adnrApiClient.lookupBtcDomain(domain);
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

    public listTransactionsForAddress = async (address: string, page = 1, limit = 10,): Promise<PaginatedResponse<Transaction> | null> => {
        return this.transactionApiClient.listTransactionsForAddress(address, page, limit);
    }

}