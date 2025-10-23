import BtcClient from '../btc';
import { DOMAIN_PURCHASE_COST, Network, TxType } from '../constants';
import KeypairService from '../services/keypair-service';
import { RawTransactionService } from '../services/raw-transaction-service';
import { Keypair, PaginatedResponse, Transaction, VfxAddress } from '../types';
import { cleanBtcDomain, cleanVfxDomain, domainWithoutSuffix, isValidBtcDomain, isValidVfxDomain } from '../utils';
import { AddressApiClient } from './address-api-client';
import { AdnrApiClient } from './adnr-client';
import { TransactionApiClient } from './transaction-api.client';

export class VfxClient {
  private network: Network;
  private dryRun: boolean;
  private keypairService: KeypairService;
  private addressApiClient: AddressApiClient;
  private adnrApiClient: AdnrApiClient;
  private transactionApiClient: TransactionApiClient;

  constructor(network: Network | 'mainnet' | 'testnet', dryRun = false) {
    // Convert string literals to Network enum values
    const networkEnum = typeof network === 'string'
      ? (network === 'mainnet' ? Network.Mainnet : Network.Testnet)
      : network;

    this.network = networkEnum;
    this.dryRun = dryRun;
    this.keypairService = new KeypairService(networkEnum);
    this.addressApiClient = new AddressApiClient(networkEnum);
    this.adnrApiClient = new AdnrApiClient(networkEnum);
    this.transactionApiClient = new TransactionApiClient(networkEnum);
  }

  // Keypairs
  public generatePrivateKey = (): string => {
    return this.keypairService.generatePrivateKey();
  };

  public generateMnemonic = (words: 12 | 24 = 12): string => {
    return this.keypairService.generateMnemonic(words);
  };

  public privateKeyFromEmailPassword = (email: string, password: string, index = 0): string => {
    return this.keypairService.privateKeyFromEmailPassword(email, password, index);
  };

  public privateKeyFromMneumonic = (mnemonic: string, index: number): string => {
    return this.keypairService.privateKeyFromMneumonic(mnemonic, index);
  };

  public publicFromPrivate = (privateKey: string): string => {
    return this.keypairService.publicFromPrivate(privateKey);
  };

  public addressFromPrivate = (privateKey: string): string => {
    return this.keypairService.addressFromPrivate(privateKey);
  };

  public getSignature = (message: string, privateKey: string): string => {
    return this.keypairService.getSignature(message, privateKey);
  };

  // Explorer API
  public getAddressDetails = (address: string): Promise<VfxAddress | null> => {
    return this.addressApiClient.getAddressDetails(address);
  };

  public domainAvailable = (domain: string): Promise<boolean> => {
    return this.addressApiClient.domainAvailable(domain);
  };

  // Transactions
  public sendCoin = async (keypair: Keypair, toAddress: string, amount: number): Promise<string | null> => {
    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: toAddress,
      amount: amount,
    });
    return await txBuilder.process(this.dryRun);
  };

  public sendVbtc = async (keypair: Keypair, toAddress: string, contractUID: string, amount: number): Promise<string | null> => {
    const data = [
      {
        Function: 'TransferCoin()',
        ContractUID: contractUID,
        Amount: amount,
      }
    ];

    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: toAddress,
      amount: 0,
      txType: TxType.TokenizeTx,
      data: data,
    });

    return await txBuilder.process(this.dryRun);
  };

  public lookupDomain = async (domain: string): Promise<string | null> => {
    return this.addressApiClient.lookupDomain(domain);
  };

  public lookupBtcDomain = async (domain: string): Promise<string | null> => {
    return this.adnrApiClient.lookupBtcDomain(domain);
  };

  public lookupBtcDomainFromBtcAddress = async (address: string): Promise<string | null> => {
    return this.adnrApiClient.lookupBtcDomainFromBtcAddress(address);
  };

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
      Function: 'AdnrCreate()',
      Name: domainWithoutSuffix(domain),
    };

    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: 'Adnr_Base',
      amount: DOMAIN_PURCHASE_COST,
      txType: TxType.Adnr,
      data: data,
    });

    return await txBuilder.process(this.dryRun);
  };

  public buyBtcDomain = async (keypair: Keypair, domain: string, btcPrivateKey: string): Promise<string | null> => {
    domain = cleanBtcDomain(domain);

    if (!isValidBtcDomain(domain)) {
      throw new Error(`Invalid btc domain: ${domain}`);
    }

    //TODO: validate btc address

    const addressApiClient = new AddressApiClient(this.network);

    //TODO: do we need to check if the address already has a btc domain?
    // I don't think so because you should be able to control multiple btc domains from one vfx address


    const available = await addressApiClient.domainAvailable(domain);

    if (!available) {
      throw new Error(`Domain already exists: ${domain}`);
    }

    const message = `${Math.floor((Date.now() / 1000))}`;
    const btcClient = new BtcClient(this.network);

    const signature = btcClient.getSignature(message, btcPrivateKey);
    const btcAccount = btcClient.addressFromPrivate(btcPrivateKey);

    const data = {
      Function: 'BTCAdnrCreate()',
      Name: domainWithoutSuffix(domain),
      BTCAddress: btcAccount.address,
      Message: message,
      Signature: signature
    };


    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: 'Adnr_Base',
      amount: DOMAIN_PURCHASE_COST,
      txType: TxType.Adnr,
      data: data,
    });

    return await txBuilder.process(this.dryRun);
  };

  public listTransactionsForAddress = async (
    address: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<Transaction> | null> => {
    return this.transactionApiClient.listTransactionsForAddress(address, page, limit);
  };
}
